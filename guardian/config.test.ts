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
import { readEnvFile, writeEnvAll, getMissingFields, parsePort } from "./config";

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
    expect(missing).toContain("KID_NAME");
    expect(missing).toContain("KID_TELEGRAM_ID");
  });

  it("returns empty array when all keys present", () => {
    writeFileSync(join(testDir, ".env"),
      "KID_BOT_TOKEN=tok\nANTHROPIC_API_KEY=key\nKID_NAME=Clive\nKID_TELEGRAM_ID=123\n");
    expect(getMissingFields(testDir)).toEqual([]);
  });
});

describe("parsePort", () => {
  it("returns the parsed integer for valid port strings", () => {
    expect(parsePort("3000")).toBe(3000);
    expect(parsePort("3001")).toBe(3001);
    expect(parsePort("8080")).toBe(8080);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort("1")).toBe(1);
  });

  it("defaults to 3000 when value is empty / undefined", () => {
    expect(parsePort(undefined)).toBe(3000);
    expect(parsePort("")).toBe(3000);
  });

  it("defaults to 3000 for non-numeric input", () => {
    expect(parsePort("abc")).toBe(3000);
    expect(parsePort("3000a")).toBe(3000);
    expect(parsePort("  ")).toBe(3000);
  });

  it("defaults to 3000 for out-of-range integers", () => {
    expect(parsePort("0")).toBe(3000);          // port 0 is reserved
    expect(parsePort("-1")).toBe(3000);
    expect(parsePort("65536")).toBe(3000);
    expect(parsePort("999999")).toBe(3000);
  });

  it("defaults to 3000 for non-integer numbers", () => {
    expect(parsePort("3000.5")).toBe(3000);
  });
});
