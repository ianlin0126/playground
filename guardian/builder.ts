import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "./config";

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

function buildPrompt(gameName: string, slug: string, isRevision: boolean, existingHtml?: string, revisionRequest?: string): string {
  const requirements = `Requirements:
- Single self-contained index.html — all CSS and JS inline, zero external dependencies
- Mobile-first: tap targets >= 44px, text >= 24px, bright cheerful colors
- Positive-only feedback — never say "Wrong", "Failed", "Game Over", "Loser"
- Must work on iOS Safari (no experimental APIs)
- No violence, no scary content, no external links, no data collection
- Immediately playable — jump straight into the game, no instructions screen needed`;

  const verifySteps = `After writing the file, verify it works:
1. Fetch http://localhost:${config.port}/games/${slug}/ and confirm you get HTML back
2. Check the HTML for obvious JS errors or missing game logic
3. If anything looks wrong, fix it and verify again
4. Keep iterating until the game is solid and fun

When you are satisfied the game works, output exactly this line as your final output:
GAME_READY: games/${slug}/index.html`;

  if (isRevision && existingHtml) {
    return `Here is the current game at games/${slug}/index.html:

${existingHtml}

Revision request: ${revisionRequest ?? "Make it better and more fun!"}

Apply the change to games/${slug}/index.html.

${requirements}

${verifySteps}`;
  }

  return `Build a browser game called "${gameName}" for a 7–8 year old child.

Write the complete game to: games/${slug}/index.html

${requirements}

${verifySteps}`;
}

export async function buildGame(
  gameName: string,
  revisionRequest?: string,
  onProgress?: (msg: string) => void
): Promise<{ slug: string; url: string }> {
  const gamesDir = join(config.playgroundDir, "games");
  const slug = toSlug(gameName);
  const gameDir = join(gamesDir, slug);

  mkdirSync(gamesDir, { recursive: true });

  const isRevision = existsSync(join(gameDir, "index.html"));
  const existingHtml = isRevision ? readFileSync(join(gameDir, "index.html"), "utf8") : undefined;
  const prompt = buildPrompt(gameName, slug, isRevision, existingHtml, revisionRequest);

  const proc = Bun.spawn(["claude", "--dangerously-skip-permissions", "-p", prompt], {
    cwd: config.playgroundDir,
    stdout: "pipe",
    stderr: "inherit", // must not pipe-and-ignore — fills buffer and deadlocks
    stdin: "ignore",
  });

  const TIMEOUT_MS = 5 * 60 * 1000;
  let timedOut = false;
  const timer60 = setTimeout(() => onProgress?.("Still working on it... 🔨 Almost there!"), 60_000);
  const timer120 = setTimeout(() => onProgress?.("Making it extra special! ✨ Just a bit longer..."), 120_000);
  const killTimer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, TIMEOUT_MS);

  let stdout = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  await proc.exited;
  clearTimeout(timer60);
  clearTimeout(timer120);
  clearTimeout(killTimer);

  if (timedOut) {
    throw new Error(`Game build timed out after ${TIMEOUT_MS / 1000}s`);
  }

  // Prefer GAME_READY token; fall back to checking file existence
  const tokenMatch = stdout.match(/^GAME_READY:\s*.+$/m);
  if (!tokenMatch && !existsSync(join(gameDir, "index.html"))) {
    throw new Error(`Build did not produce games/${slug}/index.html`);
  }

  // Update manifest
  const manifest = readManifest(gamesDir);
  const existingIndex = manifest.findIndex((e) => e.slug === slug);
  const entry = { name: gameName, slug, builtAt: new Date().toISOString() };
  if (existingIndex >= 0) {
    manifest[existingIndex] = entry;
  } else {
    manifest.push(entry);
  }
  writeManifest(gamesDir, manifest);

  return { slug, url: `http://${config.lanIp}:${config.port}/games/${slug}/` };
}
