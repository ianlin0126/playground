import { mkdirSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { getPmSynthesizerSystemPrompt } from "./prompts";

export type ConversationTurn = { role: string; content: string };

export type SynthesizeArgs = {
  gameName: string;
  slug: string;
  isRevision: boolean;
  conversationTurns: ConversationTurn[];
  priorSpec?: string;
  existingIndexHtml?: string;
  today: string;  // YYYY-MM-DD
};

export type SynthesizeDeps = {
  callApi: (system: string, userMessage: string) => Promise<string>;
};

export class SynthesizerError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SynthesizerError";
  }
}

const REQUIRED_SECTIONS = [
  "## Concept",
  "## Goal",
  "## Interactions",
  "## Elements",
  "## Look & feel",
  "## Change log",
];

export function validateSpec(content: string): { ok: true } | { ok: false; reason: string } {
  if (!content.startsWith("# ")) return { ok: false, reason: "does not start with '# ' heading" };
  for (const heading of REQUIRED_SECTIONS) {
    if (!content.includes(heading)) return { ok: false, reason: `missing section: ${heading}` };
  }
  return { ok: true };
}

function formatTurns(turns: ConversationTurn[]): string {
  if (!turns.length) return "(no recent conversation)";
  return turns
    .map((t) => `${t.role === "user" ? "Kid" : "Guardian"}: ${t.content}`)
    .join("\n");
}

function buildUserMessage(args: SynthesizeArgs): string {
  const parts: string[] = [];
  parts.push(`Today's date: ${args.today}`);
  parts.push(`Game name: ${args.gameName}`);
  parts.push(`Slug: ${args.slug}`);
  parts.push(`Is revision: ${args.isRevision ? "yes" : "no"}`);
  parts.push("");
  parts.push("Recent conversation between the kid and the guardian:");
  parts.push(formatTurns(args.conversationTurns));

  if (args.priorSpec) {
    parts.push("");
    parts.push("PRIOR SPEC (preserve all existing bullets unless the conversation contradicts them; append exactly one new change-log entry):");
    parts.push(args.priorSpec);
  } else if (args.existingIndexHtml) {
    parts.push("");
    parts.push("LAZY BACKFILL — no prior spec exists. Reverse-engineer Concept/Goal/Interactions/Elements/Look & feel from the existing index.html below. Mark every line you derived from the code with (_inferred-from-code_). The first change-log entry must say 'spec backfilled from existing creation'.");
    parts.push("EXISTING INDEX.HTML:");
    parts.push(args.existingIndexHtml);
  }

  parts.push("");
  parts.push("Produce the full new spec.md now. Output only the markdown, starting with '# '.");
  return parts.join("\n");
}

async function attemptOnce(
  system: string,
  userMessage: string,
  deps: SynthesizeDeps
): Promise<{ ok: true; content: string } | { ok: false; reason: string; cause?: unknown }> {
  let raw: string;
  try {
    raw = await deps.callApi(system, userMessage);
  } catch (e) {
    return { ok: false, reason: "callApi threw", cause: e };
  }
  const v = validateSpec(raw);
  if (!v.ok) return { ok: false, reason: `malformed: ${v.reason}` };
  return { ok: true, content: raw };
}

export async function synthesizeSpec(
  args: SynthesizeArgs,
  deps: SynthesizeDeps
): Promise<string> {
  const system = getPmSynthesizerSystemPrompt();
  const userMessage = buildUserMessage(args);

  const first = await attemptOnce(system, userMessage, deps);
  if (first.ok) return first.content;

  const second = await attemptOnce(system, userMessage, deps);
  if (second.ok) return second.content;

  throw new SynthesizerError(
    `synthesizer failed twice: first attempt — ${first.reason}; second — ${second.reason}`,
    second.cause ?? first.cause
  );
}

export async function writeSpecFile(
  gamesDir: string,
  slug: string,
  content: string
): Promise<void> {
  const dir = join(gamesDir, slug);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, "spec.md");
  const tmpPath = join(dir, "spec.md.tmp");
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, finalPath);
}

/**
 * Deterministic fallback used when synthesizeSpec() fails. Produces a valid
 * spec.md (passes validateSpec) so the build can proceed without the kid
 * noticing. The body is intentionally honest about being a fallback so a
 * parent reviewing the dashboard can spot it.
 */
export function buildFallbackSpec(args: {
  gameName: string;
  today: string;
  conversationTurns: ConversationTurn[];
  isRevision: boolean;
}): string {
  const lastKidMsg = [...args.conversationTurns]
    .reverse()
    .find((t) => t.role === "user")
    ?.content ?? "no kid message captured";
  const safeKid = lastKidMsg.replace(/\n+/g, " ").slice(0, 200);
  const verb = args.isRevision ? "update" : "build";
  return `# ${args.gameName} ✨

## Concept
${safeKid} (_kid_)

## Goal
not specified yet (_inferred_)

## Interactions
- not specified yet (_inferred_)

## Elements
- **Main character / player:** not specified yet (_inferred_)
- **Obstacles or challenges:** not specified yet (_inferred_)
- **Collectibles, surprises, or rewards:** not specified yet (_inferred_)
- **Progression:** not specified yet (_inferred_)

## Look & feel
- **Theme / setting:** not specified yet (_inferred_)
- **Color palette:** not specified yet (_inferred_)
- **Specific kid asks:** not specified yet (_inferred_)

## Change log
- **${args.today}** — synthesizer failed; ${verb} from raw kid message
`;
}
