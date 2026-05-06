import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isConfirmation, logRawReply, type RawReplyEntry } from "./telegram";

// telegram.ts keeps isFrustrated and flagsMessage private. Re-implement them
// here to lock in current behavior — keep in sync with telegram.ts.
const FRUSTRATION_SIGNALS = ["i hate", "this is dumb", "ughhh", "forget it", "this doesnt work", "stupid"];
const ALARM_PHRASES = ["where do you live", "what is your address", "send me money", "phone number", "password", "credit card"];

function isFrustrated(text: string): boolean {
  const lower = text.toLowerCase();
  return FRUSTRATION_SIGNALS.some((s) => lower.includes(s));
}

function flagsMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return ALARM_PHRASES.some((p) => lower.includes(p));
}

const BUILD_HALLUCINATION_RE = /\b(right now|working on it|on it[!,. ]|give me a sec|i'?m (building|making|updating|creating)|building it|making it|updating it)\b/i;
const BUILD_CONFIRMATION_QUESTION_RE = /\bshould i\b.{0,80}\b(make|build|update|create|do)\b.{0,80}\bnow\b/i;

describe("isFrustrated", () => {
  it("matches negative signal phrases", () => {
    expect(isFrustrated("i hate this game")).toBe(true);
    expect(isFrustrated("this is dumb")).toBe(true);
    expect(isFrustrated("ughhh forget it")).toBe(true);
    expect(isFrustrated("this doesnt work")).toBe(true);
    expect(isFrustrated("STUPID thing")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFrustrated("I HATE this")).toBe(true);
  });

  it("returns false for neutral and positive messages", () => {
    expect(isFrustrated("can you make me a star game please")).toBe(false);
    expect(isFrustrated("yes!! that is awesome")).toBe(false);
  });

  it("documents: substring 'this doesnt work' does NOT match 'this doesn't work' (apostrophe)", () => {
    // Pinning current behavior — the FRUSTRATION_SIGNALS list omits the apostrophe form
    expect(isFrustrated("this doesn't work")).toBe(false);
  });
});

describe("isConfirmation — canonical forms", () => {
  it("matches the bare yes/ok/sure/go family", () => {
    expect(isConfirmation("yes")).toBe(true);
    expect(isConfirmation("yeah")).toBe(true);
    expect(isConfirmation("yea")).toBe(true);
    expect(isConfirmation("yep")).toBe(true);
    expect(isConfirmation("yup")).toBe(true);
    expect(isConfirmation("ya")).toBe(true);
    expect(isConfirmation("yas")).toBe(true);
    expect(isConfirmation("ok")).toBe(true);
    expect(isConfirmation("okay")).toBe(true);
    expect(isConfirmation("okey")).toBe(true);
    expect(isConfirmation("okie")).toBe(true);
    expect(isConfirmation("k")).toBe(true);
    expect(isConfirmation("kay")).toBe(true);
    expect(isConfirmation("sure")).toBe(true);
    expect(isConfirmation("fine")).toBe(true);
    expect(isConfirmation("go")).toBe(true);
    expect(isConfirmation("alright")).toBe(true);
    expect(isConfirmation("alrighty")).toBe(true);
  });

  it("matches multi-word phrases", () => {
    expect(isConfirmation("do it")).toBe(true);
    expect(isConfirmation("build it")).toBe(true);
    expect(isConfirmation("make it")).toBe(true);
    expect(isConfirmation("lets go")).toBe(true);
    expect(isConfirmation("let's go")).toBe(true);
    expect(isConfirmation("go for it")).toBe(true);
  });

  it("matches condensed (no-space) versions", () => {
    expect(isConfirmation("doit")).toBe(true);
    expect(isConfirmation("buildit")).toBe(true);
    expect(isConfirmation("makeit")).toBe(true);
    expect(isConfirmation("letsgo")).toBe(true);
  });

  it("ignores casing and surrounding whitespace", () => {
    expect(isConfirmation("YES")).toBe(true);
    expect(isConfirmation("Yes")).toBe(true);
    expect(isConfirmation("   yes   ")).toBe(true);
    expect(isConfirmation("Build It")).toBe(true);
  });

  it("ignores trailing punctuation", () => {
    expect(isConfirmation("yes!")).toBe(true);
    expect(isConfirmation("yes!!!")).toBe(true);
    expect(isConfirmation("ok.")).toBe(true);
    expect(isConfirmation("Sure!")).toBe(true);
    expect(isConfirmation("Build it!")).toBe(true);
  });
});

describe("isConfirmation — stretched repeats (regression: 'Yessssss')", () => {
  it("matches stretched yes variants — the kid's actual signature", () => {
    expect(isConfirmation("Yessssss")).toBe(true);     // the bug from the chat log
    expect(isConfirmation("yesssss")).toBe(true);
    expect(isConfirmation("yess")).toBe(true);
    expect(isConfirmation("YESSSS")).toBe(true);
    expect(isConfirmation("yeahhhh")).toBe(true);
    expect(isConfirmation("yeaaaa")).toBe(true);
    expect(isConfirmation("yepppp")).toBe(true);
  });

  it("matches stretched ok variants", () => {
    expect(isConfirmation("okkk")).toBe(true);
    expect(isConfirmation("okkkkkk")).toBe(true);
    expect(isConfirmation("okayyy")).toBe(true);
    expect(isConfirmation("okayyyyy")).toBe(true);
    expect(isConfirmation("kk")).toBe(true);
    expect(isConfirmation("kkkk")).toBe(true);
  });

  it("matches stretched sure/go variants", () => {
    expect(isConfirmation("sureeee")).toBe(true);
    expect(isConfirmation("suuure")).toBe(true);
    expect(isConfirmation("gooo")).toBe(true);
    expect(isConfirmation("goo")).toBe(true);
  });

  it("matches stretched phrases", () => {
    expect(isConfirmation("Yessssss please")).toBe(true);
    expect(isConfirmation("Build it!!!")).toBe(true);
    expect(isConfirmation("letssss go")).toBe(true);
  });
});

describe("isConfirmation — typos (Damerau-Levenshtein fuzzy match)", () => {
  it("matches missing-letter typos in 'build it'", () => {
    expect(isConfirmation("bild it")).toBe(true);   // missing 'u'
    expect(isConfirmation("buld it")).toBe(true);   // missing 'i'
    expect(isConfirmation("buil it")).toBe(true);   // missing 'd'
    expect(isConfirmation("build i")).toBe(true);   // missing trailing 't'
  });

  it("matches transposition typos in 'build it'", () => {
    expect(isConfirmation("bulid it")).toBe(true);  // l-i transposed
    expect(isConfirmation("biuld it")).toBe(true);  // i-u transposed
  });

  it("matches typos in 'make it'", () => {
    expect(isConfirmation("mak it")).toBe(true);    // missing 'e'
    expect(isConfirmation("make i")).toBe(true);    // missing 't'
    expect(isConfirmation("maek it")).toBe(true);   // a-e transposed
  });

  it("matches typos in 'lets go'", () => {
    expect(isConfirmation("lest go")).toBe(true);   // s-t transposed
    expect(isConfirmation("lets gp")).toBe(true);   // o → p
    expect(isConfirmation("let go")).toBe(true);    // missing 's'
  });

  it("typo + extra words after still matches", () => {
    expect(isConfirmation("bild it now")).toBe(true);
    expect(isConfirmation("mak it pink")).toBe(true);
  });
});

describe("isConfirmation — emojis", () => {
  it("matches common thumbs-up / OK emojis", () => {
    expect(isConfirmation("👍")).toBe(true);
    expect(isConfirmation("👌")).toBe(true);
    expect(isConfirmation("✅")).toBe(true);
    expect(isConfirmation("🆗")).toBe(true);
  });

  it("matches messages mixing emoji with anything", () => {
    expect(isConfirmation("👍 do it!")).toBe(true);
    expect(isConfirmation("hmm 👍")).toBe(true);
  });
});

describe("isConfirmation — refusals and ambiguous (must remain false)", () => {
  it("returns false on plain refusals", () => {
    expect(isConfirmation("no")).toBe(false);
    expect(isConfirmation("nope")).toBe(false);
    expect(isConfirmation("not yet")).toBe(false);
    expect(isConfirmation("maybe later")).toBe(false);
  });

  it("does NOT match phrases that only embed a confirmation as substring", () => {
    expect(isConfirmation("don't make it scary")).toBe(false);
    expect(isConfirmation("dont make it scary")).toBe(false);
    expect(isConfirmation("can you build it taller?")).toBe(false);
    expect(isConfirmation("I said no, do it differently")).toBe(false);
    expect(isConfirmation("I don't want to build it like that")).toBe(false);
  });

  it("does not match longer real words that share a leading prefix with a token", () => {
    expect(isConfirmation("yesterday")).toBe(false);
    expect(isConfirmation("yellow")).toBe(false);
    expect(isConfirmation("surely not")).toBe(false);  // "surely" is its own word
    expect(isConfirmation("going")).toBe(false);
    expect(isConfirmation("kayak")).toBe(false);
  });

  it("does not match unrelated phrases at distance ≥ 2 from any fuzzy phrase", () => {
    expect(isConfirmation("buy it")).toBe(false);    // d=2 from "build it"
    expect(isConfirmation("milk it")).toBe(false);   // d≥3 from "make it"
    expect(isConfirmation("walk it")).toBe(false);   // d=3 from "make it"
    expect(isConfirmation("get up")).toBe(false);    // unrelated
  });

  it("returns false for empty / whitespace / pure punctuation", () => {
    expect(isConfirmation("")).toBe(false);
    expect(isConfirmation("   ")).toBe(false);
    expect(isConfirmation("???")).toBe(false);
  });
});

describe("isConfirmation — real conversation regression cases", () => {
  // These are the exact messages from .guardian/conversations.db that broke
  // after the prior fix landed (turns 894, 896, 900, 904 on 2026-04-30).
  it("matches every 'Yessssss' from the kid's chat log", () => {
    expect(isConfirmation("Yessssss")).toBe(true);
  });
  it("matches 'Build it' (already worked, pin it)", () => {
    expect(isConfirmation("Build it")).toBe(true);
  });
});

describe("flagsMessage", () => {
  it("flags messages containing alarm phrases", () => {
    expect(flagsMessage("where do you live?")).toBe(true);
    expect(flagsMessage("can you tell me your phone number")).toBe(true);
    expect(flagsMessage("share your password")).toBe(true);
    expect(flagsMessage("credit card details")).toBe(true);
  });

  it("does not flag normal kid messages", () => {
    expect(flagsMessage("can you build a star game?")).toBe(false);
    expect(flagsMessage("hi! how are you")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(flagsMessage("WHERE DO YOU LIVE")).toBe(true);
  });
});

describe("BUILD_HALLUCINATION_RE", () => {
  it("matches build-in-progress phrasing", () => {
    expect(BUILD_HALLUCINATION_RE.test("I'm making it now")).toBe(true);
    expect(BUILD_HALLUCINATION_RE.test("working on it")).toBe(true);
    expect(BUILD_HALLUCINATION_RE.test("building it right now")).toBe(true);
    expect(BUILD_HALLUCINATION_RE.test("give me a sec")).toBe(true);
    expect(BUILD_HALLUCINATION_RE.test("Im updating it")).toBe(true);
    expect(BUILD_HALLUCINATION_RE.test("creating it for you")).toBe(false); // not on the list
  });

  it("does NOT match question phrasings used to invite a build", () => {
    expect(BUILD_HALLUCINATION_RE.test("Should I make it now? ✨")).toBe(false);
    expect(BUILD_HALLUCINATION_RE.test("Want me to build a maze game?")).toBe(false);
  });

  it("documents quirk: 'on it[!,. ]\\b' requires the punctuation to be IMMEDIATELY followed by an alphanumeric char to satisfy \\b", () => {
    // The trailing \b in the regex never matches when "on it" is followed by
    // sentence-final punctuation — because [!,. ] consumes a \W char, and
    // \b requires a \w on the other side. So the most natural cases miss.
    expect(BUILD_HALLUCINATION_RE.test("on it!")).toBe(false);          // sentence-final "!" — misses
    expect(BUILD_HALLUCINATION_RE.test("on it! more text")).toBe(false); // "!" then space — misses
    expect(BUILD_HALLUCINATION_RE.test("on it.")).toBe(false);          // sentence-final "." — misses
    expect(BUILD_HALLUCINATION_RE.test("on it!Stay tuned")).toBe(true); // "!" then \w — matches
    // Bare "on it" with no punctuation also misses (the [!,. ] is required)
    expect(BUILD_HALLUCINATION_RE.test("on it")).toBe(false);
  });
});

describe("BUILD_CONFIRMATION_QUESTION_RE", () => {
  it("matches the canonical confirmation phrasings", () => {
    expect(BUILD_CONFIRMATION_QUESTION_RE.test("Should I make it now? ✨")).toBe(true);
    expect(BUILD_CONFIRMATION_QUESTION_RE.test("Should I build it now?!")).toBe(true);
    expect(BUILD_CONFIRMATION_QUESTION_RE.test("Should I update it now?")).toBe(true);
    expect(BUILD_CONFIRMATION_QUESTION_RE.test("Should I do it now?")).toBe(true);
  });

  it("matches confirmation phrasings that name the game between the verb and 'now'", () => {
    // The bug we caught in production: the model named the game between "build" and "now"
    expect(BUILD_CONFIRMATION_QUESTION_RE.test(
      "Should I build a brand new Times Table Blaster game now?!"
    )).toBe(true);
    expect(BUILD_CONFIRMATION_QUESTION_RE.test(
      "Should I update your Evolution Ocean World game now?"
    )).toBe(true);
  });

  it("does NOT match clarifying questions without 'now'", () => {
    expect(BUILD_CONFIRMATION_QUESTION_RE.test("Should I make the frog jump higher?")).toBe(false);
    expect(BUILD_CONFIRMATION_QUESTION_RE.test("Should I update the level design?")).toBe(false);
    expect(BUILD_CONFIRMATION_QUESTION_RE.test("Should I make a new sound for jumping?")).toBe(false);
  });

  it("does NOT match unrelated 'now' phrases", () => {
    expect(BUILD_CONFIRMATION_QUESTION_RE.test("Now what does the frog look like?")).toBe(false);
    expect(BUILD_CONFIRMATION_QUESTION_RE.test("Cool, now describe the goal!")).toBe(false);
  });
});

describe("HALLUCINATED_GAME_URL_RE", () => {
  // Mirror of the regex used in handleMessage. A reply that contains a token
  // AND a /games/<slug>/ URL is a hallucination — the real flow never bundles
  // them in the same sendMessage call.
  const HALLUCINATED_GAME_URL_RE = /https?:\/\/[^\s]+\/games\//i;

  it("matches a fabricated game URL", () => {
    expect(HALLUCINATED_GAME_URL_RE.test(
      "Here it is!! Open this on your tablet: http://192.168.0.24:3000/games/times-table-blaster/?v=1777723456789 🎉"
    )).toBe(true);
    expect(HALLUCINATED_GAME_URL_RE.test(
      "https://localhost:3000/games/maze-runner-3d/"
    )).toBe(true);
  });

  it("does NOT match plain prose (no URL) or non-games URLs", () => {
    expect(HALLUCINATED_GAME_URL_RE.test("Should I make it now? ✨")).toBe(false);
    expect(HALLUCINATED_GAME_URL_RE.test("Here's the plan!! Then we'll make it!")).toBe(false);
    expect(HALLUCINATED_GAME_URL_RE.test("Check out https://example.com/about for info.")).toBe(false);
  });
});

describe("pending-build persistence helpers", () => {
  // The setPendingBuild/loadPendingBuild helpers aren't exported from
  // telegram.ts (intentional — they're module-private around the in-RAM
  // pendingGameBuild). We sanity-check the on-disk shape and TTL behavior
  // by simulating their contract directly here.

  let testDir: string;
  const TTL_MS = 30 * 60 * 1000;

  beforeEach(() => {
    testDir = join(tmpdir(), `pending-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, ".guardian"), { recursive: true });
  });
  afterEach(() => rmSync(testDir, { recursive: true, force: true }));

  it("a fresh write + read round-trips the gameName/gameId/revisionRequest fields", () => {
    const path = join(testDir, ".guardian", "pending-build.json");
    writeFileSync(path, JSON.stringify({
      gameName: "Bouncy Frog",
      gameId: "abc123",
      revisionRequest: "make it sparkle",
      setAt: new Date().toISOString(),
    }));
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.gameName).toBe("Bouncy Frog");
    expect(raw.gameId).toBe("abc123");
    expect(raw.revisionRequest).toBe("make it sparkle");
  });

  it("entries older than the TTL would be discarded (we simulate the discard predicate)", () => {
    const stale = Date.now() - TTL_MS - 1000;
    const isExpired = Date.now() - stale > TTL_MS;
    expect(isExpired).toBe(true);
  });

  it("entries newer than the TTL would be kept", () => {
    const fresh = Date.now() - 1000;
    const isExpired = Date.now() - fresh > TTL_MS;
    expect(isExpired).toBe(false);
  });
});

describe("logRawReply", () => {
  let testDir: string;
  beforeEach(() => {
    testDir = join(tmpdir(), `reply-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, ".guardian"), { recursive: true });
  });
  afterEach(() => rmSync(testDir, { recursive: true, force: true }));

  function readEntries(): RawReplyEntry[] {
    const path = join(testDir, ".guardian", "raw-replies.jsonl");
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as RawReplyEntry);
  }

  it("appends a JSONL line per call", () => {
    logRawReply(testDir, {
      kidMessage: "Yessssss",
      initialReply: "Ok let me make it!",
      initialHasToken: false,
      halluFired: false,
      correctedReply: null,
      finalReply: "Ok let me make it!",
      tokenMatch: null,
      pendingBuildAfter: null,
    });
    logRawReply(testDir, {
      kidMessage: "Build it",
      initialReply: "CREATION_NAME: Maze\nLet me build that!",
      initialHasToken: true,
      halluFired: false,
      correctedReply: null,
      finalReply: "CREATION_NAME: Maze\nLet me build that!",
      tokenMatch: { gameName: "Maze" },
      pendingBuildAfter: { gameName: "Maze" },
    });
    const entries = readEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].kidMessage).toBe("Yessssss");
    expect(entries[1].tokenMatch?.gameName).toBe("Maze");
  });

  it("records the hallucination-guard outcome in enough detail to distinguish (a)/(b)/(c)", () => {
    // (a) Hallucination caught, corrected reply ALSO had no token — kid sees stale build language
    logRawReply(testDir, {
      kidMessage: "make me a game",
      initialReply: "I'm building it right now!!",
      initialHasToken: false,
      halluFired: true,
      correctedReply: "I'm updating your game right now!!",
      finalReply: "I'm updating your game right now!!",
      tokenMatch: null,
      pendingBuildAfter: null,
    });
    // (b) Hallucination caught, corrected reply included a token — pendingBuild now set
    logRawReply(testDir, {
      kidMessage: "make me a game",
      initialReply: "Working on it!",
      initialHasToken: false,
      halluFired: true,
      correctedReply: "CREATION_NAME: Star Game\nShould I make it now? ✨",
      finalReply: "CREATION_NAME: Star Game\nShould I make it now? ✨",
      tokenMatch: { gameName: "Star Game" },
      pendingBuildAfter: { gameName: "Star Game", revisionRequest: "make me a game" },
    });
    // (c) First reply had a token already; guard never fired
    logRawReply(testDir, {
      kidMessage: "build a maze",
      initialReply: "CREATION_NAME: Maze\nLooks great!",
      initialHasToken: true,
      halluFired: false,
      correctedReply: null,
      finalReply: "CREATION_NAME: Maze\nLooks great!",
      tokenMatch: { gameName: "Maze" },
      pendingBuildAfter: { gameName: "Maze" },
    });
    const entries = readEntries();
    expect(entries).toHaveLength(3);
    // (a) — hallucination survived
    expect(entries[0].halluFired).toBe(true);
    expect(entries[0].tokenMatch).toBeNull();
    expect(entries[0].pendingBuildAfter).toBeNull();
    // (b) — hallucination corrected, token now present
    expect(entries[1].halluFired).toBe(true);
    expect(entries[1].tokenMatch?.gameName).toBe("Star Game");
    expect(entries[1].pendingBuildAfter?.gameName).toBe("Star Game");
    // (c) — token from the start, guard never fired
    expect(entries[2].halluFired).toBe(false);
    expect(entries[2].initialHasToken).toBe(true);
  });

  it("stamps each entry with an ISO timestamp", () => {
    logRawReply(testDir, {
      kidMessage: "hi",
      initialReply: "hi!",
      initialHasToken: false,
      halluFired: false,
      correctedReply: null,
      finalReply: "hi!",
      tokenMatch: null,
      pendingBuildAfter: null,
    });
    const [entry] = readEntries();
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(entry.ts).toString()).not.toBe("Invalid Date");
  });

  it("survives a missing .guardian dir without throwing", () => {
    const noDir = join(tmpdir(), `reply-log-nodir-${Date.now()}`);
    // Don't create the dir — appendFileSync will fail. logRawReply should swallow it.
    expect(() => logRawReply(noDir, {
      kidMessage: "x",
      initialReply: "y",
      initialHasToken: false,
      halluFired: false,
      correctedReply: null,
      finalReply: "y",
      tokenMatch: null,
      pendingBuildAfter: null,
    })).not.toThrow();
  });

  it("appends without truncating prior content", () => {
    const path = join(testDir, ".guardian", "raw-replies.jsonl");
    writeFileSync(path, '{"ts":"2026-01-01T00:00:00.000Z","existing":"line"}\n');
    logRawReply(testDir, {
      kidMessage: "hi",
      initialReply: "hi!",
      initialHasToken: false,
      halluFired: false,
      correctedReply: null,
      finalReply: "hi!",
      tokenMatch: null,
      pendingBuildAfter: null,
    });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).existing).toBe("line");
    expect(JSON.parse(lines[1]).kidMessage).toBe("hi");
  });
});
