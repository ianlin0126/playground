import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  setCustomPrompt,
  isUsingCustomPrompt,
  loadCustomPromptFromDisk,
  getGuardianSystemPrompt,
  getDefaultGuardianSystemPrompt,
  getWorkerSystemPrompt,
  getPmSynthesizerSystemPrompt,
  STARTER_GAMES,
} from "./prompts";

let testDir: string;
beforeEach(() => {
  testDir = join(tmpdir(), `prompts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  setCustomPrompt(null);  // reset module-level state between tests
});
afterEach(() => {
  setCustomPrompt(null);
  rmSync(testDir, { recursive: true, force: true });
});

describe("custom prompt state", () => {
  it("starts in default mode", () => {
    expect(isUsingCustomPrompt()).toBe(false);
  });

  it("setCustomPrompt(text) flips the flag", () => {
    setCustomPrompt("Be a pirate.");
    expect(isUsingCustomPrompt()).toBe(true);
  });

  it("setCustomPrompt(null) clears the override", () => {
    setCustomPrompt("Be a pirate.");
    setCustomPrompt(null);
    expect(isUsingCustomPrompt()).toBe(false);
  });
});

describe("loadCustomPromptFromDisk", () => {
  it("does nothing when the file is absent", () => {
    loadCustomPromptFromDisk(testDir);
    expect(isUsingCustomPrompt()).toBe(false);
  });

  it("loads the override file when present", () => {
    mkdirSync(join(testDir, ".guardian"), { recursive: true });
    writeFileSync(join(testDir, ".guardian", "custom-prompt.txt"), "You are a robot.");
    loadCustomPromptFromDisk(testDir);
    expect(isUsingCustomPrompt()).toBe(true);
    expect(getGuardianSystemPrompt("Test")).toBe("You are a robot.");
  });
});

describe("getGuardianSystemPrompt", () => {
  it("returns the custom prompt when set", () => {
    setCustomPrompt("Custom override");
    expect(getGuardianSystemPrompt("Anyone")).toBe("Custom override");
  });

  it("interpolates the kid's name", () => {
    const prompt = getGuardianSystemPrompt("Clive");
    expect(prompt).toContain("Clive");
  });

  it("includes the starter games list", () => {
    const prompt = getGuardianSystemPrompt("Clive");
    for (const game of STARTER_GAMES) {
      expect(prompt).toContain(game.name);
    }
  });

  it("lists existing games when provided", () => {
    const prompt = getGuardianSystemPrompt("Clive", [
      { id: "abc123", name: "Star Game" },
      { id: "def456", name: "Maze Game" },
    ]);
    expect(prompt).toContain("[abc123] Star Game");
    expect(prompt).toContain("[def456] Maze Game");
  });

  it("omits the existing-games block when list is empty", () => {
    const prompt = getGuardianSystemPrompt("Clive");
    expect(prompt).not.toContain("existing games");
  });
});

describe("getDefaultGuardianSystemPrompt", () => {
  it("ignores the custom override", () => {
    setCustomPrompt("Custom");
    const def = getDefaultGuardianSystemPrompt("Clive");
    expect(def).not.toBe("Custom");
    expect(def).toContain("Clive");
  });
});

describe("getWorkerSystemPrompt", () => {
  it("includes the playground directory and port", () => {
    const prompt = getWorkerSystemPrompt("/tmp/playground", 3000);
    expect(prompt).toContain("/tmp/playground");
    expect(prompt).toContain("3000");
  });

  it("ends with a GAME_READY marker spec", () => {
    const prompt = getWorkerSystemPrompt("/tmp/x", 3000);
    expect(prompt).toContain("GAME_READY: games/<slug>/index.html");
  });
});

describe("getPmSynthesizerSystemPrompt", () => {
  it("identifies the role as a kids' game studio PM", () => {
    const p = getPmSynthesizerSystemPrompt();
    expect(p).toMatch(/product manager/i);
    expect(p).toMatch(/kids/i);
  });

  it("includes the spec.md template with all 6 sections", () => {
    const p = getPmSynthesizerSystemPrompt();
    expect(p).toContain("## Concept");
    expect(p).toContain("## Goal");
    expect(p).toContain("## Controls");
    expect(p).toContain("## Game elements");
    expect(p).toContain("## Look & feel");
    expect(p).toContain("## Change log");
  });

  it("documents the three marker variants", () => {
    const p = getPmSynthesizerSystemPrompt();
    expect(p).toContain("(_kid_)");
    expect(p).toContain("(_inferred_)");
    expect(p).toContain("(_inferred-from-code_)");
  });

  it("states the preservation rule for revisions", () => {
    const p = getPmSynthesizerSystemPrompt();
    expect(p).toMatch(/preserve/i);
  });

  it("states change log is append-only", () => {
    const p = getPmSynthesizerSystemPrompt();
    expect(p).toMatch(/append/i);
  });

  it("forbids implementation language", () => {
    const p = getPmSynthesizerSystemPrompt();
    expect(p).toMatch(/no implementation/i);
  });

  it("requires markdown-only output (no preamble)", () => {
    const p = getPmSynthesizerSystemPrompt();
    expect(p).toMatch(/only.*markdown/i);
    expect(p).toMatch(/no prose/i);
  });
});

describe("getGuardianSystemPrompt — slimmed for PM synthesizer", () => {
  it("does not ask the guardian to write a complete summary before building", () => {
    const p = getGuardianSystemPrompt("Clive");
    expect(p).not.toMatch(/write a complete summary/i);
    expect(p).not.toMatch(/whole game plan/i);
    expect(p).not.toMatch(/summarize the whole plan/i);
  });

  it("keeps the short-confirmation pattern", () => {
    const p = getGuardianSystemPrompt("Clive");
    expect(p).toMatch(/should i make it now/i);
  });

  it("still tells the guardian to confirm and use GAME_NAME tokens", () => {
    const p = getGuardianSystemPrompt("Clive");
    expect(p).toContain("GAME_NAME:");
  });
});
