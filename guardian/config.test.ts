import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Each test gets a fresh temp dir
let testDir: string;
beforeEach(() => {
  testDir = join(tmpdir(), `cfg-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});
afterEach(() => rmSync(testDir, { recursive: true, force: true }));

// Import after setting up — config.ts reads playgroundDir from import.meta
// We'll test the helpers by importing them with a custom dir arg
import { readEnvFile, writeEnvAll, getMissingFields } from "./config";

describe("readEnvFile", () => {
  it("returns empty object when file does not exist", () => {
    expect(readEnvFile(testDir)).toEqual({});
  });

  it("parses key=value pairs", () => {
    writeFileSync(join(testDir, ".env"), "FOO=bar\nBAZ=qux\n");
    expect(readEnvFile(testDir)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comment lines", () => {
    writeFileSync(join(testDir, ".env"), "# comment\nFOO=bar\n");
    expect(readEnvFile(testDir)).toEqual({ FOO: "bar" });
  });
});

describe("writeEnvAll", () => {
  it("writes new file with all fields", () => {
    writeEnvAll(testDir, { A: "1", B: "2" });
    expect(readEnvFile(testDir)).toEqual({ A: "1", B: "2" });
  });

  it("merges with existing fields", () => {
    writeFileSync(join(testDir, ".env"), "A=old\n");
    writeEnvAll(testDir, { B: "new" });
    const result = readEnvFile(testDir);
    expect(result.A).toBe("old");
    expect(result.B).toBe("new");
  });
});

describe("getMissingFields", () => {
  it("returns all required keys when env is empty", () => {
    const missing = getMissingFields(testDir);
    expect(missing).toContain("KID_BOT_TOKEN");
    expect(missing).toContain("ANTHROPIC_API_KEY");
    expect(missing).toContain("SON_NAME");
    expect(missing).toContain("SON_TELEGRAM_ID");
  });

  it("returns empty array when all keys present", () => {
    writeFileSync(join(testDir, ".env"),
      "KID_BOT_TOKEN=tok\nANTHROPIC_API_KEY=key\nSON_NAME=Clive\nSON_TELEGRAM_ID=123\n");
    expect(getMissingFields(testDir)).toEqual([]);
  });
});
