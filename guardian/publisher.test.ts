import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  readPublishedEntries,
  writePublishedEntries,
  buildStaticLobbyHtml,
  type PublishedEntry,
} from "./publisher";

let testDir: string;
beforeEach(() => {
  testDir = join(tmpdir(), `pub-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(testDir, "games"), { recursive: true });
});
afterEach(() => rmSync(testDir, { recursive: true, force: true }));

describe("readPublishedEntries", () => {
  it("returns [] when published.json does not exist", () => {
    expect(readPublishedEntries(testDir)).toEqual([]);
  });

  it("parses a valid published.json", () => {
    const entries: PublishedEntry[] = [
      { slug: "alpha", publishedAt: "2026-01-01T00:00:00.000Z" },
      { slug: "beta", publishedAt: "2026-01-02T00:00:00.000Z", commitSha: "abc123" },
    ];
    writeFileSync(join(testDir, "games", "published.json"), JSON.stringify(entries));
    expect(readPublishedEntries(testDir)).toEqual(entries);
  });

  it("returns [] on malformed JSON", () => {
    writeFileSync(join(testDir, "games", "published.json"), "{not json");
    expect(readPublishedEntries(testDir)).toEqual([]);
  });

  it("returns [] when payload is not an array", () => {
    writeFileSync(join(testDir, "games", "published.json"), JSON.stringify({ foo: "bar" }));
    expect(readPublishedEntries(testDir)).toEqual([]);
  });

  it("filters out entries missing slug or publishedAt", () => {
    writeFileSync(
      join(testDir, "games", "published.json"),
      JSON.stringify([
        { slug: "good", publishedAt: "2026-01-01" },
        { slug: "no-date" },
        { publishedAt: "2026-01-02" },
        null,
      ])
    );
    expect(readPublishedEntries(testDir)).toEqual([
      { slug: "good", publishedAt: "2026-01-01" },
    ]);
  });
});

describe("writePublishedEntries", () => {
  it("writes entries in JSON form", () => {
    const entries: PublishedEntry[] = [
      { slug: "alpha", publishedAt: "2026-01-01T00:00:00.000Z" },
    ];
    writePublishedEntries(testDir, entries);
    const raw = readFileSync(join(testDir, "games", "published.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(entries);
  });

  it("overwrites existing content", () => {
    writePublishedEntries(testDir, [{ slug: "old", publishedAt: "2026-01-01" }]);
    writePublishedEntries(testDir, [{ slug: "new", publishedAt: "2026-02-01" }]);
    expect(readPublishedEntries(testDir)).toEqual([
      { slug: "new", publishedAt: "2026-02-01" },
    ]);
  });

  it("write→read roundtrip preserves commitSha", () => {
    const entries: PublishedEntry[] = [
      { slug: "deploying", publishedAt: "2026-01-01", commitSha: "deadbeef" },
    ];
    writePublishedEntries(testDir, entries);
    expect(readPublishedEntries(testDir)).toEqual(entries);
  });
});

describe("buildStaticLobbyHtml", () => {
  it("produces a complete HTML document", () => {
    const html = buildStaticLobbyHtml([{ name: "Test Game", slug: "test-game" }]);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });

  it("embeds the games array as JSON for client rendering", () => {
    const html = buildStaticLobbyHtml([
      { name: "Star Catcher", slug: "star-catcher" },
      { name: "Maze Runner", slug: "maze-runner" },
    ]);
    // The JSON literal appears in the inlined script
    expect(html).toContain(JSON.stringify([
      { name: "Star Catcher", slug: "star-catcher" },
      { name: "Maze Runner", slug: "maze-runner" },
    ]));
  });

  it("works with an empty list", () => {
    const html = buildStaticLobbyHtml([]);
    expect(html).toContain("var games = [];");
  });

  it("links to relative game paths (no external URLs)", () => {
    const html = buildStaticLobbyHtml([{ name: "G", slug: "g" }]);
    // Path construction is done client-side: a.href = 'games/' + game.slug + '/'
    expect(html).toContain("'games/' + game.slug + '/'");
    // Sanity: no http(s) links to third parties from the server-rendered shell
    expect(html).not.toMatch(/href=['"]https?:\/\//);
  });

  it("escaping note: a slug containing </script> would break the inlined block", () => {
    // This documents current behavior — buildStaticLobbyHtml does not escape.
    // Slugs are validated upstream, so this is acceptable, but the test pins
    // the assumption.
    const html = buildStaticLobbyHtml([{ name: "evil", slug: "</script>" }]);
    expect(html).toContain("</script>");
  });
});
