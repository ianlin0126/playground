import { describe, it, expect } from "bun:test";
import { isConfirmation } from "./telegram";

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

describe("isConfirmation", () => {
  it("matches common yes-phrases", () => {
    expect(isConfirmation("yes")).toBe(true);
    expect(isConfirmation("yeah")).toBe(true);
    expect(isConfirmation("ok")).toBe(true);
    expect(isConfirmation("sure!")).toBe(true);
    expect(isConfirmation("let's go")).toBe(true);
    expect(isConfirmation("Build it!")).toBe(true);
  });

  it("matches phrase followed by additional words", () => {
    expect(isConfirmation("yes please")).toBe(true);
    expect(isConfirmation("yeah do it")).toBe(true);
    expect(isConfirmation("ok let's go")).toBe(true);
    expect(isConfirmation("Build it now")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(isConfirmation("   yes   ")).toBe(true);
  });

  it("returns false on plain refusals", () => {
    expect(isConfirmation("no")).toBe(false);
    expect(isConfirmation("not yet")).toBe(false);
    expect(isConfirmation("maybe later")).toBe(false);
  });

  it("does NOT match phrases that only embed a confirmation as substring", () => {
    // The previous substring match treated these as confirmations.
    expect(isConfirmation("don't make it scary")).toBe(false);
    expect(isConfirmation("can you build it taller?")).toBe(false);
    expect(isConfirmation("I said no, do it differently")).toBe(false);
  });

  it("does not match longer words that begin with a confirmation token", () => {
    expect(isConfirmation("yesterday")).toBe(false);
    expect(isConfirmation("okayyy")).toBe(false); // strict: kid must use a normal confirmation
    expect(isConfirmation("surely not")).toBe(false);
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
    expect(BUILD_HALLUCINATION_RE.test("Should I make it now? 🎮")).toBe(false);
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
