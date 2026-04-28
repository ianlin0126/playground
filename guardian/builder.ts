import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { config } from "./config";

export class BuildNotPickedUpError extends Error {
  constructor() {
    super("Build job not picked up — Claude Code session is not running or the monitor is not active");
    this.name = "BuildNotPickedUpError";
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

type ManifestEntry = { id: string; name: string; slug: string; builtAt: string };

function genId(builtAt?: string): string {
  const ts = builtAt ? new Date(builtAt).getTime() : NaN;
  return (isNaN(ts) ? Date.now() : ts).toString(36);
}

function readManifest(gamesDir: string): ManifestEntry[] {
  const manifestPath = join(gamesDir, "manifest.json");
  if (!existsSync(manifestPath)) return [];
  try {
    const raw: Array<{ id?: string; name: string; slug: string; builtAt: string }> =
      JSON.parse(readFileSync(manifestPath, "utf8"));
    let changed = false;
    const entries: ManifestEntry[] = raw.map((e) => {
      if (e.id) return e as ManifestEntry;
      changed = true;
      return { id: genId(e.builtAt), name: e.name, slug: e.slug, builtAt: e.builtAt };
    });
    if (changed) writeFileSync(manifestPath, JSON.stringify(entries, null, 2));
    return entries;
  } catch {
    return [];
  }
}

function writeManifest(gamesDir: string, entries: ManifestEntry[]): void {
  writeFileSync(join(gamesDir, "manifest.json"), JSON.stringify(entries, null, 2));
}

export function updateManifest(gamesDir: string, gameName: string, slug: string, gameId?: string): string {
  const manifest = readManifest(gamesDir);
  const idx = gameId
    ? manifest.findIndex((e) => e.id === gameId)
    : manifest.findIndex((e) => e.slug === slug);
  const id = idx >= 0 ? manifest[idx].id : (gameId ?? genId());
  const entry: ManifestEntry = { id, name: gameName, slug, builtAt: new Date().toISOString() };
  if (idx >= 0) manifest[idx] = entry; else manifest.push(entry);
  writeManifest(gamesDir, manifest);
  return id;
}

export function getExistingGames(): Array<{ id: string; name: string }> {
  const gamesDir = join(config.playgroundDir, "games");
  return readManifest(gamesDir).map(({ id, name }) => ({ id, name }));
}

type ConversationTurn = { role: string; content: string };

function formatConversationContext(turns: ConversationTurn[]): string {
  if (!turns.length) return "";
  const lines = turns.map((t) => {
    const speaker = t.role === "user" ? `${config.sonName} (kid)` : "Guardian";
    return `${speaker}: ${typeof t.content === "string" ? t.content : "[image/media]"}`;
  });
  return `\nRecent conversation (for context):\n${lines.join("\n")}\n`;
}

function buildPrompt(
  gameName: string,
  slug: string,
  isRevision: boolean,
  existingHtml?: string,
  revisionRequest?: string,
  conversationContext?: ConversationTurn[]
): string {
  const context = conversationContext?.length ? formatConversationContext(conversationContext) : "";

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
${context}
Revision request: ${revisionRequest ?? "Make it better and more fun!"}

Apply the change to games/${slug}/index.html.

${requirements}

${verifySteps}`;
  }

  return `Build a browser game called "${gameName}" for a 7–8 year old child.
${context}
Write the complete game to: games/${slug}/index.html

${requirements}

${verifySteps}`;
}

// ── Primary path: file-based job queue processed by the parent's Claude Code session ──

const JOBS_DIR = join(config.playgroundDir, ".guardian", "jobs");
const POLL_MS = 4_000;
const PICKUP_TIMEOUT_MS = 10 * 60 * 1000;  // Claude Code may be mid-build on another game; give it 10 min
const TOTAL_TIMEOUT_MS = 30 * 60 * 1000;
const ZOMBIE_THRESHOLD_MS = 10 * 60 * 1000; // in_progress > 10 min with no completion → dead session

async function pollJobToCompletion(
  jobPath: string,
  slug: string,
  startMs: number,
  onProgress?: (msg: string) => void
): Promise<{ slug: string; url: string; jobPath: string }> {
  let prog60 = false, prog120 = false;
  let zombieRequeued = false;
  let zombieRequeuedAt = 0;

  while (true) {
    await Bun.sleep(POLL_MS);
    const elapsed = Date.now() - startMs;

    if (!prog60 && elapsed >= 60_000) { prog60 = true; onProgress?.("Still working on it... 🔨 Almost there!"); }
    if (!prog120 && elapsed >= 120_000) { prog120 = true; onProgress?.("Making it extra special! ✨ Just a bit longer..."); }

    let job: Record<string, unknown>;
    try { job = JSON.parse(readFileSync(jobPath, "utf8")); }
    catch { continue; } // file mid-write — retry next tick

    if (job.status === "done" && job.url) {
      console.log(`[builder] Job completed: ${job.url}`);
      return { slug, url: job.url as string, jobPath };
    }

    if (job.status === "failed") {
      throw new Error((job.error as string) ?? "Build failed");
    }

    // Zombie detection: session claimed the job but died before finishing
    if (job.status === "in_progress" && job.pickedUpAt && !zombieRequeued) {
      const age = Date.now() - new Date(job.pickedUpAt as string).getTime();
      if (age > ZOMBIE_THRESHOLD_MS) {
        zombieRequeued = true;
        zombieRequeuedAt = Date.now();
        job.status = "pending";
        job.pickedUpAt = null;
        job.claimedBy = null;
        writeFileSync(jobPath, JSON.stringify(job, null, 2));
        onProgress?.("Hang on, almost there! 🔧 Working on it...");
        console.log(`[builder] Zombie detected, re-queued: ${job.id}`);
      }
    }

    if (job.status === "pending") {
      const pickupDeadline = zombieRequeued
        ? zombieRequeuedAt + PICKUP_TIMEOUT_MS
        : startMs + PICKUP_TIMEOUT_MS;
      if (Date.now() >= pickupDeadline) throw new BuildNotPickedUpError();
    }

    if (elapsed >= TOTAL_TIMEOUT_MS) {
      throw new Error("Build timed out");
    }
  }
}

const DEDUP_WINDOW_MS = 30 * 60 * 1000;

async function buildGameViaJobQueue(
  gameName: string,
  slug: string,
  isRevision: boolean,
  existingHtml: string | undefined,
  revisionRequest: string | undefined,
  conversationContext: ConversationTurn[],
  chatId: number | undefined,
  onProgress?: (msg: string) => void
): Promise<{ slug: string; url: string; jobPath: string }> {
  mkdirSync(JOBS_DIR, { recursive: true });

  // Attach to an existing pending/in_progress job for the same slug rather than
  // creating a duplicate — happens when BuildNotPickedUpError fires and the kid re-confirms.
  try {
    const files = readdirSync(JOBS_DIR).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      try {
        const j = JSON.parse(readFileSync(join(JOBS_DIR, f), "utf8")) as Record<string, unknown>;
        if (
          j.slug === slug &&
          (j.status === "pending" || j.status === "in_progress") &&
          new Date(j.createdAt as string).getTime() > Date.now() - DEDUP_WINDOW_MS
        ) {
          const existingPath = join(JOBS_DIR, f);
          console.log(`[builder] Duplicate job for "${slug}" — attaching to existing ${j.id}`);
          onProgress?.("Already building it! Just a moment... 🔨");
          return pollJobToCompletion(existingPath, slug, Date.now(), onProgress);
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* jobs dir not yet readable — fall through to create new job */ }

  const id = `${Date.now()}-${slug}`;
  const jobPath = join(JOBS_DIR, `${id}.json`);
  const prompt = buildPrompt(gameName, slug, isRevision, existingHtml, revisionRequest, conversationContext);

  writeFileSync(jobPath, JSON.stringify({
    id, gameName, slug, isRevision,
    revisionRequest: revisionRequest ?? null,
    chatId: chatId ?? null,
    prompt, status: "pending",
    createdAt: new Date().toISOString(),
    port: config.port, lanIp: config.lanIp,
    playgroundDir: config.playgroundDir,
    pickedUpAt: null, completedAt: null, url: null, error: null,
    telegramSentAt: null,
  }, null, 2));

  console.log(`[builder] Job queued for Claude Code session: ${jobPath}`);

  return pollJobToCompletion(jobPath, slug, Date.now(), onProgress);
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function buildGame(
  gameName: string,
  chatId: number | undefined,
  revisionRequest?: string,
  onProgress?: (msg: string) => void,
  conversationContext: ConversationTurn[] = [],
  gameId?: string
): Promise<{ slug: string; url: string; jobPath: string }> {
  const gamesDir = join(config.playgroundDir, "games");
  let slug = toSlug(gameName);
  mkdirSync(gamesDir, { recursive: true });

  // If a gameId was supplied, resolve it to the exact existing slug
  if (gameId) {
    const manifest = readManifest(gamesDir);
    const existing = manifest.find((e) => e.id === gameId);
    if (existing && existsSync(join(gamesDir, existing.slug, "index.html"))) {
      console.log(`[builder] ID-resolved game "${gameId}" → slug "${existing.slug}"`);
      slug = existing.slug;
    }
  }

  const isRevision = existsSync(join(gamesDir, slug, "index.html"));
  const existingHtml = isRevision ? readFileSync(join(gamesDir, slug, "index.html"), "utf8") : undefined;

  return buildGameViaJobQueue(gameName, slug, isRevision, existingHtml, revisionRequest, conversationContext, chatId, onProgress);
}
