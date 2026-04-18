import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "./config";
import { getGameBuilderSystemPrompt } from "./prompts";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function readManifest(gamesDir: string): Array<{ name: string; slug: string; builtAt: string }> {
  const manifestPath = join(gamesDir, "manifest.json");
  if (!existsSync(manifestPath)) return [];
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return [];
  }
}

function writeManifest(gamesDir: string, entries: Array<{ name: string; slug: string; builtAt: string }>): void {
  writeFileSync(join(gamesDir, "manifest.json"), JSON.stringify(entries, null, 2));
}

export async function buildGame(gameName: string): Promise<{ slug: string; url: string }> {
  const gamesDir = join(config.playgroundDir, "games");
  const slug = toSlug(gameName);
  const gameDir = join(gamesDir, slug);

  const isRevision = existsSync(join(gameDir, "index.html"));
  let userMessage: string;

  if (isRevision) {
    const existing = readFileSync(join(gameDir, "index.html"), "utf8");
    userMessage = `Here is the current game HTML:\n\n${existing}\n\nPlease revise it as requested.`;
  } else {
    userMessage = `Build the game: ${gameName}`;
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: getGameBuilderSystemPrompt(gameName),
    messages: [{ role: "user", content: userMessage }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type from Claude API");

  // Extract HTML — strip any accidental markdown code fences
  let html = content.text.trim();
  if (html.startsWith("```")) {
    html = html.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
  }

  mkdirSync(gameDir, { recursive: true });
  writeFileSync(join(gameDir, "index.html"), html);

  // Update manifest
  const manifest = readManifest(gamesDir);
  const existing = manifest.findIndex((e) => e.slug === slug);
  const entry = { name: gameName, slug, builtAt: new Date().toISOString() };
  if (existing >= 0) {
    manifest[existing] = entry;
  } else {
    manifest.push(entry);
  }
  writeManifest(gamesDir, manifest);

  return { slug, url: `http://${config.lanIp}:${config.port}/games/${slug}/` };
}
