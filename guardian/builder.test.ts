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

import { buildPromptForTest, pollJobToCompletion, cleanupOrphanPendingJobs, BuildNotPickedUpError, PICKUP_TIMEOUT_MS } from "./builder";

// ── pollJobToCompletion: pickup-timeout marks job failed (Fix 2) ────────────

describe("pollJobToCompletion: pickup timeout", () => {
  let savedDir: string;
  let jobsDir: string;
  let origSleep: typeof Bun.sleep;

  beforeEach(() => {
    savedDir = config.playgroundDir;
    config.playgroundDir = testDir;
    jobsDir = join(testDir, ".guardian", "jobs");
    mkdirSync(jobsDir, { recursive: true });
    // Stub Bun.sleep so the poll loop doesn't actually wait 4 s per tick
    origSleep = Bun.sleep;
    (Bun as { sleep: unknown }).sleep = () => Promise.resolve();
  });

  afterEach(() => {
    config.playgroundDir = savedDir;
    (Bun as { sleep: unknown }).sleep = origSleep;
  });

  it("throws BuildNotPickedUpError and writes status:failed when pickup deadline exceeded", async () => {
    const jobId = `old-${Date.now()}`;
    const jobPath = join(jobsDir, `${jobId}.json`);
    const job = {
      id: jobId,
      slug: "test-game",
      status: "pending",
      createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    };
    writeFileSync(jobPath, JSON.stringify(job, null, 2));

    // startMs 21 minutes ago → immediately past the 20-min pickup deadline
    const startMs = Date.now() - 21 * 60 * 1000;

    await expect(pollJobToCompletion(jobPath, "test-game", startMs)).rejects.toBeInstanceOf(BuildNotPickedUpError);

    const updated = JSON.parse(readFileSync(jobPath, "utf8"));
    expect(updated.status).toBe("failed");
    expect(updated.error).toContain("pickup timeout");
    expect(updated.completedAt).toBeDefined();
  });
});

// ── cleanupOrphanPendingJobs: orphan cleanup (Fix 3) ──────────────────────

describe("cleanupOrphanPendingJobs", () => {
  let savedDir: string;
  let jobsDirPath: string;

  beforeEach(() => {
    savedDir = config.playgroundDir;
    config.playgroundDir = testDir;
    jobsDirPath = join(testDir, ".guardian", "jobs");
    mkdirSync(jobsDirPath, { recursive: true });
  });

  afterEach(() => {
    config.playgroundDir = savedDir;
  });

  it("marks orphan-pending job as superseded when older than PICKUP_TIMEOUT_MS", () => {
    // Pre-write an orphan: same slug, pending, created 21+ min ago (past PICKUP_TIMEOUT_MS)
    const orphanId = `orphan-${Date.now()}`;
    const orphanPath = join(jobsDirPath, `${orphanId}.json`);
    writeFileSync(orphanPath, JSON.stringify({
      id: orphanId,
      slug: "test-game",
      status: "pending",
      createdAt: new Date(Date.now() - 21 * 60 * 1000).toISOString(),
    }, null, 2));

    cleanupOrphanPendingJobs("test-game");

    const orphan = JSON.parse(readFileSync(orphanPath, "utf8"));
    expect(orphan.status).toBe("failed");
    expect(orphan.error).toContain("superseded by newer build request");
    expect(orphan.completedAt).toBeDefined();
  });

  it("cleanup-then-dedup: orphan for slug X is marked failed; in-window job for slug Y is untouched", () => {
    // Orphan pending for slug X (21 min old — past PICKUP_TIMEOUT_MS)
    const xOrphanId = `orphan-x-${Date.now()}`;
    const xOrphanPath = join(jobsDirPath, `${xOrphanId}.json`);
    writeFileSync(xOrphanPath, JSON.stringify({
      id: xOrphanId,
      slug: "slug-x",
      status: "pending",
      createdAt: new Date(Date.now() - 21 * 60 * 1000).toISOString(),
    }, null, 2));

    // In-window pending for slug Y (5 min old — well within PICKUP_TIMEOUT_MS)
    const yInWindowId = `in-window-y-${Date.now()}`;
    const yInWindowPath = join(jobsDirPath, `${yInWindowId}.json`);
    writeFileSync(yInWindowPath, JSON.stringify({
      id: yInWindowId,
      slug: "slug-y",
      status: "pending",
      createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }, null, 2));

    // Cleanup only targets slug-x
    cleanupOrphanPendingJobs("slug-x");

    // (a) Slug X orphan must be marked failed
    const xOrphan = JSON.parse(readFileSync(xOrphanPath, "utf8"));
    expect(xOrphan.status).toBe("failed");
    expect(xOrphan.error).toContain("superseded by newer build request");

    // (b) Slug Y in-window job must be completely untouched
    const yInWindow = JSON.parse(readFileSync(yInWindowPath, "utf8"));
    expect(yInWindow.status).toBe("pending");
    expect(yInWindow.error).toBeUndefined();
  });

  it("slug-isolation: orphan for slug B is untouched when cleaning up slug A", () => {
    // Two orphan-pending jobs, both >20 min old, different slugs
    const aOrphanId = `orphan-a-${Date.now()}`;
    const aOrphanPath = join(jobsDirPath, `${aOrphanId}.json`);
    writeFileSync(aOrphanPath, JSON.stringify({
      id: aOrphanId,
      slug: "slug-a",
      status: "pending",
      createdAt: new Date(Date.now() - 21 * 60 * 1000).toISOString(),
    }, null, 2));

    const bOrphanId = `orphan-b-${Date.now()}`;
    const bOrphanPath = join(jobsDirPath, `${bOrphanId}.json`);
    writeFileSync(bOrphanPath, JSON.stringify({
      id: bOrphanId,
      slug: "slug-b",
      status: "pending",
      createdAt: new Date(Date.now() - 21 * 60 * 1000).toISOString(),
    }, null, 2));

    cleanupOrphanPendingJobs("slug-a");

    // Slug A orphan is cleaned up
    const aOrphan = JSON.parse(readFileSync(aOrphanPath, "utf8"));
    expect(aOrphan.status).toBe("failed");

    // Slug B orphan is left alone — not cleaned up, still pending
    const bOrphan = JSON.parse(readFileSync(bOrphanPath, "utf8"));
    expect(bOrphan.status).toBe("pending");
    expect(bOrphan.error).toBeUndefined();
  });

  it("in_progress immunity: zombie in_progress job is NOT touched by cleanup", () => {
    // in_progress job for slug X, pickedUpAt 25 min ago
    const zombieId = `zombie-${Date.now()}`;
    const zombiePath = join(jobsDirPath, `${zombieId}.json`);
    writeFileSync(zombiePath, JSON.stringify({
      id: zombieId,
      slug: "slug-x",
      status: "in_progress",
      pickedUpAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    }, null, 2));

    cleanupOrphanPendingJobs("slug-x");

    // Must not be touched — cleanup only targets pending jobs
    const zombie = JSON.parse(readFileSync(zombiePath, "utf8"));
    expect(zombie.status).toBe("in_progress");
    expect(zombie.error).toBeUndefined();
  });

  it("boundary: 19.5-min-old job is NOT cleaned up (just under threshold)", () => {
    const id = `boundary-under-${Date.now()}`;
    const jobPath = join(jobsDirPath, `${id}.json`);
    writeFileSync(jobPath, JSON.stringify({
      id,
      slug: "slug-x",
      status: "pending",
      createdAt: new Date(Date.now() - 19.5 * 60 * 1000).toISOString(),
    }, null, 2));

    cleanupOrphanPendingJobs("slug-x");

    const job = JSON.parse(readFileSync(jobPath, "utf8"));
    expect(job.status).toBe("pending");
    expect(job.error).toBeUndefined();
  });

  it("boundary: 20.5-min-old job IS cleaned up (just over threshold)", () => {
    const id = `boundary-over-${Date.now()}`;
    const jobPath = join(jobsDirPath, `${id}.json`);
    writeFileSync(jobPath, JSON.stringify({
      id,
      slug: "slug-x",
      status: "pending",
      createdAt: new Date(Date.now() - 20.5 * 60 * 1000).toISOString(),
    }, null, 2));

    cleanupOrphanPendingJobs("slug-x");

    const job = JSON.parse(readFileSync(jobPath, "utf8"));
    expect(job.status).toBe("failed");
    expect(job.error).toContain("superseded by newer build request");
  });

  it("regression — does NOT mark a pending job within PICKUP_TIMEOUT_MS as failed", () => {
    // Pre-write a pending job created 5 minutes ago (well within 20-min PICKUP_TIMEOUT_MS)
    const inWindowId = `in-window-${Date.now()}`;
    const inWindowPath = join(jobsDirPath, `${inWindowId}.json`);
    writeFileSync(inWindowPath, JSON.stringify({
      id: inWindowId,
      slug: "test-game",
      status: "pending",
      createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    }, null, 2));

    cleanupOrphanPendingJobs("test-game");

    // In-window job must NOT be touched
    const inWindow = JSON.parse(readFileSync(inWindowPath, "utf8"));
    expect(inWindow.status).toBe("pending");
    expect(inWindow.error).toBeUndefined();
  });
});

describe("buildPrompt with SPEC", () => {
  const sampleSpec = `# Star Catcher 🌟\n\n## Concept\nCatch falling stars (_kid_)\n\n## Goal\nGet 10 stars (_kid_)\n\n## Interactions\n- tap (_kid_)\n\n## Elements\n- **Main character / player:** basket (_kid_)\n\n## Look & feel\n- **Theme / setting:** night sky (_kid_)\n\n## Change log\n- **2026-05-02** — initial build\n`;

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

  it("includes the verification checklist and CREATION_READY marker", () => {
    const prompt = buildPromptForTest({
      slug: "star-catcher",
      isRevision: false,
      specContent: sampleSpec,
      port: 3000,
    });
    expect(prompt).toContain("CREATION_READY: games/star-catcher/index.html");
    expect(prompt).toMatch(/onclick/);  // verification step still mentions IIFE/onclick check
  });
});
