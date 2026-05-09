import { describe, it, expect } from "bun:test";
import { classifyPendingResponse } from "./telegram";
import type { PendingIntent } from "./telegram";

// ── Mock helpers ─────────────────────────────────────────────────────────────

type FakeAnthropic = {
  messages: { create: (...args: unknown[]) => Promise<unknown> };
  callCount: number;
};

function mockAnthropicReturning(label: string): FakeAnthropic {
  const fake: FakeAnthropic = {
    callCount: 0,
    messages: {
      create: async () => {
        fake.callCount++;
        return { content: [{ type: "text", text: label }] };
      },
    },
  };
  return fake;
}

function mockAnthropicNeverCalled(): FakeAnthropic {
  const fake: FakeAnthropic = {
    callCount: 0,
    messages: {
      create: async () => {
        fake.callCount++;
        throw new Error("Anthropic should not have been called");
      },
    },
  };
  return fake;
}

function mockAnthropicThrowing(): FakeAnthropic {
  const fake: FakeAnthropic = {
    callCount: 0,
    messages: {
      create: async () => {
        fake.callCount++;
        throw new Error("Simulated API failure");
      },
    },
  };
  return fake;
}

const samplePending = {
  gameName: "Red Ball",
  revisionRequest: "fix how the game detects hits",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("pending-build classifier — CLARIFY path", () => {
  it("returns CLARIFY when kid sends a sentence-length refinement", async () => {
    const fakeAnthropic = mockAnthropicReturning("CLARIFY");
    const intent = await classifyPendingResponse(
      "It's more like the game is confused that I was attacked by the minion next to the one I hit",
      { gameName: "Red Ball", revisionRequest: "fix how attacks are detected" },
      fakeAnthropic as never
    );
    expect(intent).toBe("CLARIFY");
  });

  it("returns CONFIRM via fast heuristic on 'yes' — no API call", async () => {
    const fakeAnthropic = mockAnthropicNeverCalled();
    const intent = await classifyPendingResponse("yes", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CONFIRM");
    expect(fakeAnthropic.callCount).toBe(0);
  });

  it("returns CONFIRM via fast heuristic on 'yeah'", async () => {
    const fakeAnthropic = mockAnthropicNeverCalled();
    const intent = await classifyPendingResponse("yeah", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CONFIRM");
    expect(fakeAnthropic.callCount).toBe(0);
  });

  it("returns CONFIRM via fast heuristic on 'sure'", async () => {
    const fakeAnthropic = mockAnthropicNeverCalled();
    const intent = await classifyPendingResponse("sure", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CONFIRM");
    expect(fakeAnthropic.callCount).toBe(0);
  });

  it("returns CANCEL via fast heuristic on 'no'", async () => {
    const fakeAnthropic = mockAnthropicNeverCalled();
    const intent = await classifyPendingResponse("no", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CANCEL");
    expect(fakeAnthropic.callCount).toBe(0);
  });

  it("returns CANCEL via fast heuristic on 'nope'", async () => {
    const fakeAnthropic = mockAnthropicNeverCalled();
    const intent = await classifyPendingResponse("nope", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CANCEL");
    expect(fakeAnthropic.callCount).toBe(0);
  });

  it("returns CANCEL via fast heuristic on 'cancel'", async () => {
    const fakeAnthropic = mockAnthropicNeverCalled();
    const intent = await classifyPendingResponse("cancel", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CANCEL");
    expect(fakeAnthropic.callCount).toBe(0);
  });

  it("returns CANCEL via fast heuristic on 'nevermind'", async () => {
    const fakeAnthropic = mockAnthropicNeverCalled();
    const intent = await classifyPendingResponse("nevermind", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CANCEL");
    expect(fakeAnthropic.callCount).toBe(0);
  });

  it("does NOT call Anthropic when fast heuristic decides (CANCEL case)", async () => {
    const fakeAnthropic = mockAnthropicNeverCalled();
    await classifyPendingResponse("nope", samplePending, fakeAnthropic as never);
    expect(fakeAnthropic.callCount).toBe(0);
  });

  it("defaults to CLARIFY on Anthropic API failure — preserves pending context", async () => {
    const fakeAnthropic = mockAnthropicThrowing();
    const intent = await classifyPendingResponse("hmm", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CLARIFY");
  });

  it("calls Anthropic for ambiguous messages that aren't fast-path", async () => {
    const fakeAnthropic = mockAnthropicReturning("CLARIFY");
    await classifyPendingResponse("actually it's more of a collision problem", samplePending, fakeAnthropic as never);
    expect(fakeAnthropic.callCount).toBe(1);
  });

  it("returns CANCEL when Anthropic says CANCEL", async () => {
    const fakeAnthropic = mockAnthropicReturning("CANCEL");
    const intent = await classifyPendingResponse("actually never mind", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CANCEL");
  });

  it("returns CONFIRM when Anthropic says CONFIRM", async () => {
    const fakeAnthropic = mockAnthropicReturning("CONFIRM");
    const intent = await classifyPendingResponse("absolutely", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CONFIRM");
  });

  it("accepts CONFIRM even with extra whitespace in Anthropic response", async () => {
    const fakeAnthropic = mockAnthropicReturning("  CONFIRM  ");
    const intent = await classifyPendingResponse("absolutely", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CONFIRM");
  });

  it("treats unexpected Anthropic output as CLARIFY", async () => {
    const fakeAnthropic = mockAnthropicReturning("UNKNOWN_LABEL");
    const intent = await classifyPendingResponse("maybe later idk", samplePending, fakeAnthropic as never);
    expect(intent).toBe("CLARIFY");
  });

  // Regression test for the exact bug reported
  it("regression: kid clarification 'It's more like X' is NOT classified as cancel", async () => {
    const fakeAnthropic = mockAnthropicReturning("CLARIFY");
    const intent = await classifyPendingResponse(
      "It's more like the game is confused that I was attacked by a minion next to the one I just hit",
      { gameName: "Red Ball", revisionRequest: "fix how the game detects hits" },
      fakeAnthropic as never
    );
    expect(intent).not.toBe("CANCEL");
  });

  it("regression: kid clarification is not CONFIRM either — preserves the pending request", async () => {
    const fakeAnthropic = mockAnthropicReturning("CLARIFY");
    const intent: PendingIntent = await classifyPendingResponse(
      "It's more like the game is confused that I was attacked by a minion next to the one I just hit",
      { gameName: "Red Ball", revisionRequest: "fix how the game detects hits" },
      fakeAnthropic as never
    );
    expect(intent).toBe("CLARIFY");
  });

  it("handles pending build with no revisionRequest (new game scenario)", async () => {
    const fakeAnthropic = mockAnthropicReturning("CLARIFY");
    const intent = await classifyPendingResponse(
      "actually I want a space theme instead of a ball",
      { gameName: "Red Ball" },
      fakeAnthropic as never
    );
    expect(intent).toBe("CLARIFY");
  });
});
