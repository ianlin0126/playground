import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  initDb,
  insertTurn,
  getRecentTurns,
  flagTurn,
  upsertSummary,
  getLatestSummary,
} from "./db";

let testDir: string;
beforeEach(() => {
  testDir = join(tmpdir(), `db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  initDb(testDir);
});
afterEach(() => rmSync(testDir, { recursive: true, force: true }));

describe("turns", () => {
  it("inserts and retrieves messages in reverse-chronological order", () => {
    insertTurn("kid", "hello");
    insertTurn("guardian", "hi there");
    insertTurn("kid", "another");

    const turns = getRecentTurns(10);
    expect(turns).toHaveLength(3);
    // getRecentTurns returns most-recent first
    expect(turns[0].message).toBe("another");
    expect(turns[2].message).toBe("hello");
  });

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) insertTurn("kid", `msg-${i}`);
    expect(getRecentTurns(2)).toHaveLength(2);
  });

  it("defaults flagged=0 and persists flagged=1 on insert", () => {
    insertTurn("kid", "ordinary");
    insertTurn("kid", "danger", true);
    const turns = getRecentTurns(10);
    expect(turns.find(t => t.message === "ordinary")?.flagged).toBe(0);
    expect(turns.find(t => t.message === "danger")?.flagged).toBe(1);
  });

  it("flagTurn updates an existing row", () => {
    insertTurn("kid", "review me");
    const [row] = getRecentTurns(1);
    expect(row.flagged).toBe(0);
    flagTurn(row.id);
    const [after] = getRecentTurns(1);
    expect(after.flagged).toBe(1);
  });

  it("stores ISO timestamps", () => {
    insertTurn("kid", "now");
    const [row] = getRecentTurns(1);
    expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Should round-trip through Date
    expect(new Date(row.ts).toString()).not.toBe("Invalid Date");
  });
});

describe("summaries", () => {
  it("returns null when no summary has been written", () => {
    expect(getLatestSummary()).toBeNull();
  });

  it("upsertSummary appends and getLatestSummary returns the most recent", () => {
    upsertSummary("first summary");
    upsertSummary("second summary");
    const latest = getLatestSummary();
    expect(latest?.content).toBe("second summary");
  });

  it("summary rows include ts and id", () => {
    upsertSummary("hello");
    const latest = getLatestSummary();
    expect(latest?.id).toBeGreaterThan(0);
    expect(latest?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("schema persistence", () => {
  it("re-initialising on the same dir preserves data", () => {
    insertTurn("kid", "persist me");
    upsertSummary("persist this too");
    initDb(testDir);
    expect(getRecentTurns(5)[0].message).toBe("persist me");
    expect(getLatestSummary()?.content).toBe("persist this too");
  });
});
