import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { toSlug } from "./builder";

// genId is still private — re-implementation mirrors builder.ts.
function genId(builtAt?: string): string {
  const ts = builtAt ? new Date(builtAt).getTime() : NaN;
  return (isNaN(ts) ? Date.now() : ts).toString(36);
}

let testDir: string;
beforeEach(() => {
  testDir = join(tmpdir(), `builder-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});
afterEach(() => rmSync(testDir, { recursive: true, force: true }));

describe("toSlug", () => {
  it("lowercases letters", () => {
    expect(toSlug("Hello")).toBe("hello");
  });

  it("replaces spaces with hyphens", () => {
    expect(toSlug("Catch the Stars")).toBe("catch-the-stars");
  });

  it("strips emojis and special punctuation", () => {
    expect(toSlug("Catch the Stars ⭐")).toBe("catch-the-stars");
    expect(toSlug("Hello, World!")).toBe("hello-world");
  });

  it("trims surrounding whitespace before slugifying", () => {
    expect(toSlug("  spaced out  ")).toBe("spaced-out");
  });

  it("preserves existing hyphens", () => {
    expect(toSlug("snake-case")).toBe("snake-case");
  });

  it("collapses runs of whitespace into a single hyphen", () => {
    expect(toSlug("a    b")).toBe("a-b");
  });

  it("preserves accented letters (Unicode-aware)", () => {
    expect(toSlug("Pokémon Trainer")).toBe("pokémon-trainer");
    expect(toSlug("Café Game")).toBe("café-game");
  });

  it("preserves non-Latin scripts", () => {
    // CJK and Cyrillic letters are kept; only non-letter/non-digit chars are stripped.
    expect(toSlug("ゲーム 大冒険")).toBe("ゲーム-大冒険");
    expect(toSlug("игра")).toBe("игра");
  });

  it("strips underscores (not a letter or digit under \\p{L}\\p{N})", () => {
    expect(toSlug("foo_bar")).toBe("foobar");
  });

  it("falls back to a unique slug when input has no letters or digits", () => {
    const slug = toSlug("⭐⭐⭐");
    expect(slug).toMatch(/^game-[0-9a-z]+$/);
  });

  it("falls back when input is empty", () => {
    expect(toSlug("")).toMatch(/^game-[0-9a-z]+$/);
  });
});

describe("genId", () => {
  it("returns a base-36 string", () => {
    const id = genId("2026-01-01T00:00:00.000Z");
    expect(id).toMatch(/^[0-9a-z]+$/);
  });

  it("encodes the same timestamp deterministically", () => {
    expect(genId("2026-01-01T00:00:00.000Z")).toBe(genId("2026-01-01T00:00:00.000Z"));
  });

  it("falls back to Date.now() for invalid input", () => {
    const before = Date.now();
    const id = genId("not-a-date");
    const after = Date.now();
    const decoded = parseInt(id, 36);
    expect(decoded).toBeGreaterThanOrEqual(before);
    expect(decoded).toBeLessThanOrEqual(after);
  });

  it("falls back to Date.now() when no arg is given", () => {
    const before = Date.now();
    const id = genId();
    const after = Date.now();
    const decoded = parseInt(id, 36);
    expect(decoded).toBeGreaterThanOrEqual(before);
    expect(decoded).toBeLessThanOrEqual(after);
  });
});

// ── Manifest read/write/update via the public-ish surface ──
// We exercise updateManifest through a temp games dir, since builder.ts ties
// it to config.playgroundDir. We also verify the backfill behavior of the
// internal readManifest by writing legacy entries and re-reading them.

import { updateManifest, getExistingGames } from "./builder";
import { config } from "./config";

describe("updateManifest", () => {
  it("creates manifest.json on first call and assigns an id", () => {
    const id = updateManifest(testDir, "Star Catcher", "star-catcher");
    expect(id).toMatch(/^[0-9a-z]+$/);
    const raw = JSON.parse(readFileSync(join(testDir, "manifest.json"), "utf8"));
    expect(raw).toEqual([
      { id, name: "Star Catcher", slug: "star-catcher", builtAt: expect.any(String) },
    ]);
  });

  it("appends a new entry without disturbing earlier ones", () => {
    updateManifest(testDir, "First", "first");
    updateManifest(testDir, "Second", "second");
    const entries = JSON.parse(readFileSync(join(testDir, "manifest.json"), "utf8"));
    expect(entries.map((e: { slug: string }) => e.slug)).toEqual(["first", "second"]);
  });

  it("updates the matching slug in place when no gameId is given", () => {
    const firstId = updateManifest(testDir, "Star Catcher", "star-catcher");
    const secondId = updateManifest(testDir, "Star Catcher v2", "star-catcher");
    expect(firstId).toBe(secondId);
    const entries = JSON.parse(readFileSync(join(testDir, "manifest.json"), "utf8"));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Star Catcher v2");
  });

  it("updates by gameId even if slug differs", () => {
    const id = updateManifest(testDir, "Old Name", "old-slug");
    const sameId = updateManifest(testDir, "New Name", "new-slug", id);
    expect(sameId).toBe(id);
    const entries = JSON.parse(readFileSync(join(testDir, "manifest.json"), "utf8"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id, name: "New Name", slug: "new-slug" });
  });

  it("backfills ids for legacy entries that lack them", () => {
    writeFileSync(
      join(testDir, "manifest.json"),
      JSON.stringify([
        { name: "Legacy Game", slug: "legacy", builtAt: "2026-01-01T00:00:00.000Z" },
      ])
    );
    // Trigger backfill via a no-op update that touches the manifest
    updateManifest(testDir, "New Game", "new-game");
    const entries = JSON.parse(readFileSync(join(testDir, "manifest.json"), "utf8"));
    expect(entries.find((e: { slug: string }) => e.slug === "legacy").id).toBeDefined();
    expect(entries.find((e: { slug: string }) => e.slug === "new-game").id).toBeDefined();
  });
});

describe("getExistingGames", () => {
  let savedDir: string;
  beforeEach(() => {
    savedDir = config.playgroundDir;
    config.playgroundDir = testDir;
    mkdirSync(join(testDir, "games"), { recursive: true });
  });
  afterEach(() => {
    config.playgroundDir = savedDir;
  });

  it("returns [] when no manifest exists", () => {
    expect(getExistingGames()).toEqual([]);
  });

  it("returns id+name pairs from the manifest", () => {
    updateManifest(join(testDir, "games"), "Alpha", "alpha");
    updateManifest(join(testDir, "games"), "Beta", "beta");
    const games = getExistingGames();
    expect(games).toHaveLength(2);
    expect(games.map(g => g.name).sort()).toEqual(["Alpha", "Beta"]);
    for (const g of games) expect(g.id).toMatch(/^[0-9a-z]+$/);
  });

  it("survives a corrupt manifest (returns empty)", () => {
    writeFileSync(join(testDir, "games", "manifest.json"), "{ not json");
    expect(getExistingGames()).toEqual([]);
  });
});

describe("BuildNotPickedUpError", () => {
  it("has the expected name and message", async () => {
    const { BuildNotPickedUpError } = await import("./builder");
    const err = new BuildNotPickedUpError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("BuildNotPickedUpError");
    expect(err.message).toContain("not picked up");
  });
});

import { buildPromptForTest } from "./builder";

describe("buildPrompt with SPEC", () => {
  const sampleSpec = `# Star Catcher 🌟\n\n## Concept\nCatch falling stars (_kid_)\n\n## Goal\nGet 10 stars (_kid_)\n\n## Controls\n- tap (_kid_)\n\n## Game elements\n- **Player:** basket (_kid_)\n\n## Look & feel\n- **Theme / setting:** night sky (_kid_)\n\n## Change log\n- **2026-05-02** — initial build\n`;

  it("embeds the SPEC under a SPEC: heading for new builds", () => {
    const prompt = buildPromptForTest({
      slug: "star-catcher",
      isRevision: false,
      specContent: sampleSpec,
      port: 3000,
    });
    expect(prompt).toContain("SPEC:");
    expect(prompt).toContain("# Star Catcher 🌟");
    expect(prompt).toContain("## Change log");
  });

  it("embeds the SPEC and the existing index.html for revisions", () => {
    const prompt = buildPromptForTest({
      slug: "star-catcher",
      isRevision: true,
      specContent: sampleSpec,
      existingHtml: "<!DOCTYPE html><html><body>old game</body></html>",
      port: 3000,
    });
    expect(prompt).toContain("SPEC:");
    expect(prompt).toContain("CURRENT INDEX:");
    expect(prompt).toContain("old game");
  });

  it("does not embed raw conversation turns", () => {
    const prompt = buildPromptForTest({
      slug: "star-catcher",
      isRevision: false,
      specContent: sampleSpec,
      port: 3000,
    });
    expect(prompt).not.toMatch(/Recent conversation/i);
  });

  it("includes the verification checklist and GAME_READY marker", () => {
    const prompt = buildPromptForTest({
      slug: "star-catcher",
      isRevision: false,
      specContent: sampleSpec,
      port: 3000,
    });
    expect(prompt).toContain("GAME_READY: games/star-catcher/index.html");
    expect(prompt).toMatch(/onclick/);  // verification step still mentions IIFE/onclick check
  });
});
