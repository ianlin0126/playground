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
    parts.push("LAZY BACKFILL — no prior spec exists. Reverse-engineer Concept/Goal/Controls/Game elements/Look & feel from the existing index.html below. Mark every line you derived from the code with (_inferred-from-code_). The first change-log entry must say 'spec backfilled from existing game'.");
    parts.push("EXISTING INDEX.HTML:");
    parts.push(args.existingIndexHtml);
  }

  parts.push("");
  parts.push("Produce the full new spec.md now. Output only the markdown, starting with '# '.");
  return parts.join("\n");
}

export async function synthesizeSpec(
  args: SynthesizeArgs,
  deps: SynthesizeDeps
): Promise<string> {
  const system = getPmSynthesizerSystemPrompt();
  const userMessage = buildUserMessage(args);
  return deps.callApi(system, userMessage);
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
