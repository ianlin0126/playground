import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { config } from "./config";

// ── Helpers ────────────────────────────────────────────────────────────────

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

function updateManifest(gamesDir: string, gameName: string, slug: string): void {
  const manifest = readManifest(gamesDir);
  const idx = manifest.findIndex((e) => e.slug === slug);
  const entry = { name: gameName, slug, builtAt: new Date().toISOString() };
  if (idx >= 0) manifest[idx] = entry; else manifest.push(entry);
  writeManifest(gamesDir, manifest);
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
2. Read the written file and check:
   a. It ends with </html> — confirm it is not truncated
   b. Any onclick="foo()" attributes — confirm foo is declared at TOP-LEVEL scope, not inside an IIFE or nested function. If not, fix it: either move functions to top-level or replace onclick with addEventListener inside the closure.
   c. No undeclared function references in inline event handlers
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

// ── Primary path: file-based job queue processed by Ian's Claude Code session ──

const JOBS_DIR = join(config.playgroundDir, ".guardian", "jobs");
const POLL_MS = 4_000;
const PICKUP_TIMEOUT_MS = 3 * 60 * 1000;
const TOTAL_TIMEOUT_MS = 12 * 60 * 1000;

async function buildGameViaJobQueue(
  gameName: string,
  slug: string,
  isRevision: boolean,
  existingHtml: string | undefined,
  revisionRequest: string | undefined,
  onProgress?: (msg: string) => void
): Promise<{ slug: string; url: string }> {
  mkdirSync(JOBS_DIR, { recursive: true });

  const id = `${Date.now()}-${slug}`;
  const jobPath = join(JOBS_DIR, `${id}.json`);
  const prompt = buildPrompt(gameName, slug, isRevision, existingHtml, revisionRequest);

  writeFileSync(jobPath, JSON.stringify({
    id, gameName, slug, isRevision,
    revisionRequest: revisionRequest ?? null,
    prompt, status: "pending",
    createdAt: new Date().toISOString(),
    port: config.port, lanIp: config.lanIp,
    playgroundDir: config.playgroundDir,
    pickedUpAt: null, completedAt: null, url: null, error: null,
  }, null, 2));

  console.log(`[builder] Job queued for Claude Code session: ${jobPath}`);

  const startMs = Date.now();
  let prog60 = false, prog120 = false;

  while (true) {
    await Bun.sleep(POLL_MS);
    const elapsed = Date.now() - startMs;

    if (!prog60 && elapsed >= 60_000) { prog60 = true; onProgress?.("Still working on it... 🔨 Almost there!"); }
    if (!prog120 && elapsed >= 120_000) { prog120 = true; onProgress?.("Making it extra special! ✨ Just a bit longer..."); }

    let job: Record<string, unknown>;
    try { job = JSON.parse(readFileSync(jobPath, "utf8")); }
    catch { continue; } // file mid-write — retry next tick

    if (job.status === "done" && job.url) {
      console.log(`[builder] Job completed by Claude Code session: ${job.url}`);
      updateManifest(join(config.playgroundDir, "games"), gameName, slug);
      return { slug, url: job.url as string };
    }

    if (job.status === "failed") {
      throw new Error((job.error as string) ?? "Claude Code session reported build failed");
    }

    // No pickup within 3 minutes → fall back to subprocess
    if (job.status === "pending" && elapsed >= PICKUP_TIMEOUT_MS) {
      console.log(`[builder] No Claude Code session picked up job after ${PICKUP_TIMEOUT_MS / 1000}s — falling back to subprocess`);
      try { unlinkSync(jobPath); } catch {}
      throw new Error("PICKUP_TIMEOUT");
    }

    if (elapsed >= TOTAL_TIMEOUT_MS) {
      throw new Error("Build timed out");
    }
  }
}

// ── Fallback: claude -p subprocess ────────────────────────────────────────

async function buildGameSubprocess(
  gameName: string,
  slug: string,
  isRevision: boolean,
  existingHtml: string | undefined,
  revisionRequest: string | undefined,
  onProgress?: (msg: string) => void
): Promise<{ slug: string; url: string }> {
  const gamesDir = join(config.playgroundDir, "games");
  const gameDir = join(gamesDir, slug);
  const prompt = buildPrompt(gameName, slug, isRevision, existingHtml, revisionRequest);

  const proc = Bun.spawn(["claude", "--dangerously-skip-permissions", "-p", prompt], {
    cwd: config.playgroundDir,
    stdout: "pipe",
    stderr: "inherit", // must not pipe-and-ignore — fills buffer and deadlocks
    stdin: "ignore",
  });

  const TIMEOUT_MS = 10 * 60 * 1000;
  let timedOut = false;
  const timer60 = setTimeout(() => onProgress?.("Still working on it... 🔨 Almost there!"), 60_000);
  const timer120 = setTimeout(() => onProgress?.("Making it extra special! ✨ Just a bit longer..."), 120_000);
  const killTimer = setTimeout(() => { timedOut = true; proc.kill(); }, TIMEOUT_MS);

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

  if (timedOut) throw new Error(`Game build timed out after ${TIMEOUT_MS / 1000}s`);

  const tokenMatch = stdout.match(/^GAME_READY:\s*.+$/m);
  if (!tokenMatch && !existsSync(join(gameDir, "index.html"))) {
    throw new Error(`Build did not produce games/${slug}/index.html`);
  }

  updateManifest(gamesDir, gameName, slug);
  return { slug, url: `http://${config.lanIp}:${config.port}/games/${slug}/?v=${Date.now()}` };
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function buildGame(
  gameName: string,
  revisionRequest?: string,
  onProgress?: (msg: string) => void
): Promise<{ slug: string; url: string }> {
  const gamesDir = join(config.playgroundDir, "games");
  const slug = toSlug(gameName);
  mkdirSync(gamesDir, { recursive: true });

  const isRevision = existsSync(join(gamesDir, slug, "index.html"));
  const existingHtml = isRevision ? readFileSync(join(gamesDir, slug, "index.html"), "utf8") : undefined;

  try {
    return await buildGameViaJobQueue(gameName, slug, isRevision, existingHtml, revisionRequest, onProgress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "PICKUP_TIMEOUT" || msg.startsWith("Build timed out")) {
      console.log("[builder] Falling back to subprocess build");
      onProgress?.("Still building... ⚙️");
      return buildGameSubprocess(gameName, slug, isRevision, existingHtml, revisionRequest, onProgress);
    }
    throw err;
  }
}
