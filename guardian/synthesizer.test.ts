import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readdirSync } from "fs";

import { synthesizeSpec, writeSpecFile, SynthesizerError } from "./synthesizer";

let testDir: string;
beforeEach(() => {
  testDir = join(tmpdir(), `synth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});
afterEach(() => rmSync(testDir, { recursive: true, force: true }));

const goodSpec = `# Bouncy Frog 🐸

## Concept
A frog jumps from log to log across a pond. (_kid_)

## Goal
Jump as many logs as you can without falling in. (_inferred_)

## Controls
- tap to jump (_kid_)

## Game elements
- **Player:** a green frog (_kid_)
- **Obstacles / enemies:** logs that drift apart (_inferred_)
- **Collectibles / power-ups:** not specified yet (_inferred_)
- **Levels / progression:** logs drift faster over time (_inferred_)

## Look & feel
- **Theme / setting:** pond at sunset (_inferred_)
- **Color palette:** orange and green (_inferred_)
- **Specific kid asks:** the frog says "ribbit" when it jumps (_kid_)

## Change log
- **2026-05-02** — initial build: a frog jumps log to log across a pond
`;

describe("synthesizeSpec — new game success path", () => {
  it("returns the spec body returned by callApi", async () => {
    const calls: Array<{ system: string; userMessage: string }> = [];
    const result = await synthesizeSpec(
      {
        gameName: "Bouncy Frog",
        slug: "bouncy-frog",
        isRevision: false,
        conversationTurns: [
          { role: "user", content: "I want a frog jumping game" },
          { role: "assistant", content: "Cool! What does the frog jump on?" },
          { role: "user", content: "logs in a pond" },
        ],
        today: "2026-05-02",
      },
      {
        callApi: async (system, userMessage) => {
          calls.push({ system, userMessage });
          return goodSpec;
        },
      }
    );
    expect(result).toBe(goodSpec);
    expect(calls).toHaveLength(1);
  });

  it("passes the conversation turns into the user message", async () => {
    let captured = "";
    await synthesizeSpec(
      {
        gameName: "Bouncy Frog",
        slug: "bouncy-frog",
        isRevision: false,
        conversationTurns: [
          { role: "user", content: "make a frog game" },
          { role: "assistant", content: "ok!" },
        ],
        today: "2026-05-02",
      },
      {
        callApi: async (_, userMessage) => {
          captured = userMessage;
          return goodSpec;
        },
      }
    );
    expect(captured).toContain("make a frog game");
    expect(captured).toContain("Bouncy Frog");
    expect(captured).toContain("2026-05-02");
  });

  it("passes the system prompt produced by getPmSynthesizerSystemPrompt", async () => {
    let capturedSystem = "";
    await synthesizeSpec(
      {
        gameName: "X",
        slug: "x",
        isRevision: false,
        conversationTurns: [],
        today: "2026-05-02",
      },
      {
        callApi: async (system) => {
          capturedSystem = system;
          return goodSpec;
        },
      }
    );
    // System prompt should mention the PM role and the template
    expect(capturedSystem).toMatch(/product manager/i);
    expect(capturedSystem).toContain("## Concept");
  });
});

describe("writeSpecFile", () => {
  it("writes the content to games/<slug>/spec.md", async () => {
    mkdirSync(join(testDir, "bouncy-frog"), { recursive: true });
    await writeSpecFile(testDir, "bouncy-frog", goodSpec);
    const written = readFileSync(join(testDir, "bouncy-frog", "spec.md"), "utf8");
    expect(written).toBe(goodSpec);
  });

  it("creates the game directory if it doesn't exist yet", async () => {
    await writeSpecFile(testDir, "fresh-game", goodSpec);
    expect(existsSync(join(testDir, "fresh-game", "spec.md"))).toBe(true);
  });

  it("writes atomically via a tmp file + rename (no .tmp left behind)", async () => {
    await writeSpecFile(testDir, "atomic", goodSpec);
    const files = readdirSync(join(testDir, "atomic"));
    expect(files).not.toContain("spec.md.tmp");
    expect(files).toContain("spec.md");
  });
});

describe("synthesizeSpec — revisions with prior spec", () => {
  const priorSpec = `# Bouncy Frog 🐸

## Concept
A frog jumps from log to log. (_kid_)

## Change log
- **2026-05-01** — initial build
`;

  it("includes the prior spec in the user message", async () => {
    let captured = "";
    await synthesizeSpec(
      {
        gameName: "Bouncy Frog",
        slug: "bouncy-frog",
        isRevision: true,
        conversationTurns: [
          { role: "user", content: "give the frog a sword" },
        ],
        priorSpec,
        today: "2026-05-04",
      },
      {
        callApi: async (_, userMessage) => {
          captured = userMessage;
          return goodSpec;
        },
      }
    );
    expect(captured).toContain("PRIOR SPEC");
    expect(captured).toContain("A frog jumps from log to log.");
  });

  it("does NOT include lazy-backfill instructions when a prior spec exists", async () => {
    let captured = "";
    await synthesizeSpec(
      {
        gameName: "Bouncy Frog",
        slug: "bouncy-frog",
        isRevision: true,
        conversationTurns: [],
        priorSpec,
        existingIndexHtml: "<html><body>...</body></html>",  // even if both passed, prior spec wins
        today: "2026-05-04",
      },
      {
        callApi: async (_, userMessage) => {
          captured = userMessage;
          return goodSpec;
        },
      }
    );
    expect(captured).toContain("PRIOR SPEC");
    expect(captured).not.toContain("LAZY BACKFILL");
    expect(captured).not.toContain("EXISTING INDEX.HTML");
  });
});

describe("synthesizeSpec — lazy backfill (no prior spec, has existing index.html)", () => {
  const existingHtml = `<!DOCTYPE html>
<html><head><title>Maze Runner</title></head>
<body><canvas id="game"></canvas><script>
// player moves with arrow keys through a maze
</script></body></html>`;

  it("includes lazy-backfill instructions and the existing index.html", async () => {
    let captured = "";
    await synthesizeSpec(
      {
        gameName: "Maze Runner",
        slug: "maze-runner",
        isRevision: true,
        conversationTurns: [
          { role: "user", content: "add a finish line that sparkles" },
        ],
        existingIndexHtml: existingHtml,
        today: "2026-05-02",
      },
      {
        callApi: async (_, userMessage) => {
          captured = userMessage;
          return `# Maze Runner 🌀\n\n## Concept\nA player moves through a maze (_inferred-from-code_).\n\n## Goal\nReach the end (_inferred-from-code_).\n\n## Controls\n- arrow keys (_inferred-from-code_)\n\n## Game elements\n- **Player:** a runner (_inferred-from-code_)\n\n## Look & feel\n- **Theme / setting:** maze (_inferred-from-code_)\n\n## Change log\n- **2026-05-02** — spec backfilled from existing game; added a sparkly finish line\n`;
        },
      }
    );
    expect(captured).toContain("LAZY BACKFILL");
    expect(captured).toContain("EXISTING INDEX.HTML");
    expect(captured).toContain("player moves with arrow keys");
    expect(captured).toContain("inferred-from-code");
  });

  it("does NOT include lazy-backfill instructions when no existing html provided (truly new game)", async () => {
    let captured = "";
    await synthesizeSpec(
      {
        gameName: "Brand New Game",
        slug: "brand-new",
        isRevision: false,
        conversationTurns: [],
        today: "2026-05-02",
      },
      {
        callApi: async (_, userMessage) => {
          captured = userMessage;
          return `# Brand New Game\n\n## Concept\nx (_inferred_)\n\n## Goal\ny (_inferred_)\n\n## Controls\n- tap (_inferred_)\n\n## Game elements\n- **Player:** z (_inferred_)\n\n## Look & feel\n- **Theme / setting:** space (_inferred_)\n\n## Change log\n- **2026-05-02** — initial build\n`;
        },
      }
    );
    expect(captured).not.toContain("LAZY BACKFILL");
    expect(captured).not.toContain("PRIOR SPEC");
  });
});

describe("synthesizeSpec — validation + retry", () => {
  const baseArgs = {
    gameName: "X",
    slug: "x",
    isRevision: false,
    conversationTurns: [],
    today: "2026-05-02",
  };

  function specWithAllSections(): string {
    return `# X 🎮

## Concept
foo (_inferred_)

## Goal
bar (_inferred_)

## Controls
- tap (_inferred_)

## Game elements
- **Player:** y (_inferred_)

## Look & feel
- **Theme / setting:** z (_inferred_)

## Change log
- **2026-05-02** — initial build
`;
  }

  it("retries once on a transient API error and succeeds", async () => {
    let attempts = 0;
    const result = await synthesizeSpec(baseArgs, {
      callApi: async () => {
        attempts++;
        if (attempts === 1) throw new Error("rate_limit");
        return specWithAllSections();
      },
    });
    expect(attempts).toBe(2);
    expect(result).toContain("# X");
  });

  it("throws SynthesizerError after a second failure", async () => {
    let attempts = 0;
    await expect(
      synthesizeSpec(baseArgs, {
        callApi: async () => {
          attempts++;
          throw new Error("network_down");
        },
      })
    ).rejects.toBeInstanceOf(SynthesizerError);
    expect(attempts).toBe(2);
  });

  it("retries once on malformed output (missing # heading)", async () => {
    let attempts = 0;
    const result = await synthesizeSpec(baseArgs, {
      callApi: async () => {
        attempts++;
        if (attempts === 1) return "Here is the spec:\n## Concept\n...";
        return specWithAllSections();
      },
    });
    expect(attempts).toBe(2);
    expect(result).toContain("# X");
  });

  it("retries once on malformed output (missing required section)", async () => {
    let attempts = 0;
    const result = await synthesizeSpec(baseArgs, {
      callApi: async () => {
        attempts++;
        if (attempts === 1) {
          // Missing ## Change log
          return `# X\n## Concept\nfoo (_inferred_)\n## Goal\nbar (_inferred_)\n## Controls\n- tap (_inferred_)\n## Game elements\n- **Player:** y (_inferred_)\n## Look & feel\n- **Theme / setting:** z (_inferred_)\n`;
        }
        return specWithAllSections();
      },
    });
    expect(attempts).toBe(2);
  });

  it("throws SynthesizerError after a second malformed output", async () => {
    let attempts = 0;
    await expect(
      synthesizeSpec(baseArgs, {
        callApi: async () => {
          attempts++;
          return "garbage with no heading";
        },
      })
    ).rejects.toBeInstanceOf(SynthesizerError);
    expect(attempts).toBe(2);
  });
});
