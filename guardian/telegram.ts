import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from "fs";
import { join } from "path";
import { config } from "./config";
import { insertTurn, getRecentTurns, upsertSummary, getLatestSummary } from "./db";
import { getGuardianSystemPrompt } from "./prompts";
import { buildGame, BuildNotPickedUpError, getExistingGames, ZOMBIE_THRESHOLD_MS, resolveSlug } from "./builder";
import { synthesizeSpec, writeSpecFile, buildFallbackSpec, SynthesizerError } from "./synthesizer";

// ── State ─────────────────────────────────────────────────────────────────

export type TelegramState = {
  status: "running" | "stopped" | "error";
  startedAt: Date | null;
  error: string | null;
};

export const state: TelegramState = {
  status: "stopped",
  startedAt: null,
  error: null,
};

let _running = false;
let _stopSignal = false;

// ── Helpers ───────────────────────────────────────────────────────────────

const FRUSTRATION_SIGNALS = ["i hate", "this is dumb", "ughhh", "forget it", "this doesnt work", "stupid"];

function isFrustrated(text: string): boolean {
  const lower = text.toLowerCase();
  return FRUSTRATION_SIGNALS.some((s) => lower.includes(s));
}

// ── Confirmation detection ─────────────────────────────────────────────────
// Designed for an excited 7-year-old's typing. Three layers of tolerance:
//   1. Normalize: lowercase, strip punctuation/apostrophes, collapse runs of
//      repeated letters so "Yessssss" → "yes" and "okkk" → "ok".
//   2. Match against a wide variant set covering yes/ok/sure/go families.
//   3. Damerau-Levenshtein fuzzy match (distance ≤ 1) for longer phrases so
//      common typos ("bild it", "bulid it" with l-i transposed) still work.

const CONFIRM_TOKENS = new Set([
  // yes family — variants and slang
  "yes", "yeah", "yea", "yep", "yup", "ya", "yas",
  // ok family — including single-letter abbreviations
  "ok", "okay", "okey", "okie", "k", "kay",
  // other simple affirmatives
  "sure", "fine", "go", "alright", "alrighty",
  // condensed (no-space) forms of multi-word phrases
  "doit", "buildit", "makeit", "letsgo",
]);

const CONFIRM_PHRASES = [
  "do it",
  "build it",
  "make it",
  "lets go",
  "go for it",
];

// Phrases long enough that an edit-distance-1 match is safe (won't collide
// with random English). Short tokens like "yes" or "ok" are NOT fuzzy-matched
// because too many real words ("yet", "yew", "or") sit at distance 1.
const FUZZY_PHRASES = ["build it", "make it", "lets go", "go for it"];

const CONFIRM_EMOJI_RE = /[👍✅👌🆗🤙✔]/u;

function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,         // deletion
        d[i][j - 1] + 1,         // insertion
        d[i - 1][j - 1] + cost,  // substitution
      );
      // Transposition (treat swapped adjacent chars as a single edit)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/['‘’`]/g, "")  // strip apostrophes (' ` ' ' )
    .replace(/[!.,?¿¡]+/g, "")                    // strip terminal punctuation
    .replace(/\s+/g, " ")                          // collapse whitespace
    .replace(/(.)\1+/g, "$1");                     // collapse repeated chars
}

export function isConfirmation(text: string): boolean {
  if (CONFIRM_EMOJI_RE.test(text)) return true;

  const normalized = normalizeForMatch(text);
  if (!normalized) return false;

  // Whole-message exact match
  if (CONFIRM_TOKENS.has(normalized)) return true;

  // First token of the message is a known confirmation (covers "yes please",
  // "yeah do it", "ok let me see", etc.)
  const firstSpace = normalized.indexOf(" ");
  if (firstSpace > 0 && CONFIRM_TOKENS.has(normalized.slice(0, firstSpace))) return true;

  // Multi-word phrase at the start
  for (const phrase of CONFIRM_PHRASES) {
    if (normalized === phrase) return true;
    if (normalized.startsWith(phrase + " ")) return true;
  }

  // Fuzzy match for typos in longer phrases ("bild it", "bulid it", "mak it")
  for (const phrase of FUZZY_PHRASES) {
    const minLen = Math.max(1, phrase.length - 1);
    const maxLen = Math.min(normalized.length, phrase.length + 1);
    for (let len = minLen; len <= maxLen; len++) {
      const prefix = normalized.slice(0, len);
      if (damerauLevenshtein(prefix, phrase) <= 1) {
        const after = normalized[len];
        if (after === undefined || after === " ") return true;
      }
    }
  }

  return false;
}

function flagsMessage(text: string): boolean {
  const lower = text.toLowerCase();
  const alarmPhrases = ["where do you live", "what is your address", "send me money", "phone number", "password", "credit card"];
  return alarmPhrases.some((p) => lower.includes(p));
}

function tgBase(): string {
  return `https://api.telegram.org/bot${config.kidBotToken}`;
}

async function tgGet<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(`${tgBase()}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(70_000) });
  const json = (await res.json()) as { ok: boolean; result: T };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
  return json.result;
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  await tgGet("sendMessage", { chat_id: chatId, text });
}

async function downloadPhoto(fileId: string): Promise<{ base64: string; mimeType: "image/jpeg" }> {
  const file = await tgGet<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${config.kidBotToken}/${file.file_path}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const buffer = await res.arrayBuffer();
  return { base64: Buffer.from(buffer).toString("base64"), mimeType: "image/jpeg" };
}

// ── Conversation loop ─────────────────────────────────────────────────────

const conversationHistory: Anthropic.Messages.MessageParam[] = [];
type PendingGameBuild = { gameName: string; gameId?: string; revisionRequest?: string };
let pendingGameBuild: PendingGameBuild | null = null;

// Persisted across server restarts so the kid's "yes" survives a guardian
// restart between the question and the confirmation. Without this, a restart
// clears the in-RAM state and the kid's "yes" routes to Claude as a fresh
// message — which can hallucinate a build it never queued. Stale entries
// older than the TTL are discarded on load.
const PENDING_BUILD_TTL_MS = 30 * 60 * 1000;

function pendingBuildPath(): string {
  return join(config.playgroundDir, ".guardian", "pending-build.json");
}

function setPendingBuild(value: PendingGameBuild | null): void {
  pendingGameBuild = value;
  const path = pendingBuildPath();
  try {
    if (value === null) {
      if (existsSync(path)) unlinkSync(path);
    } else {
      const tmp = path + ".tmp";
      writeFileSync(tmp, JSON.stringify({ ...value, setAt: new Date().toISOString() }, null, 2));
      renameSync(tmp, path);
    }
  } catch (e) {
    console.error("[telegram] failed to persist pendingGameBuild:", e);
  }
}

function loadPendingBuild(): PendingGameBuild | null {
  const path = pendingBuildPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { gameName?: string; gameId?: string; revisionRequest?: string; setAt?: string };
    const setAt = raw.setAt ? new Date(raw.setAt).getTime() : NaN;
    if (!raw.gameName || isNaN(setAt) || Date.now() - setAt > PENDING_BUILD_TTL_MS) {
      try { unlinkSync(path); } catch { /* non-fatal */ }
      return null;
    }
    return { gameName: raw.gameName, gameId: raw.gameId, revisionRequest: raw.revisionRequest };
  } catch {
    return null;
  }
}
let _summaryInjected = false;

// ── Conversation summarization ────────────────────────────────────────────

const SUMMARY_TRIGGER = 60;   // compress when history exceeds this
const SUMMARY_COMPRESS = 30;  // number of old turns to summarize

let _compressing = false;

async function compressOldTurns(anthropic: Anthropic): Promise<void> {
  // Guard: prevent overlapping runs from spliting the same conversationHistory.
  // compressOldTurns is fire-and-forget from handleMessage, so two messages
  // arriving close together would otherwise both read+mutate the array.
  if (_compressing) return;
  _compressing = true;
  try {
    // Strip the existing summary pair at position 0 if present
    const startIdx = _summaryInjected ? 2 : 0;
    const oldTurns = conversationHistory.slice(startIdx, startIdx + SUMMARY_COMPRESS);
    if (oldTurns.length < 10) return; // not enough to bother

    const transcript = oldTurns
      .map((m) => {
        const speaker = m.role === "user" ? config.kidName : "Guardian";
        const text = typeof m.content === "string" ? m.content : "[media]";
        return `${speaker}: ${text}`;
      })
      .join("\n");

    try {
      const res = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `Summarize this conversation between a child (${config.kidName}, age 7-8) and a game-building assistant in 3-5 sentences. Focus on: games discussed or built, the child's preferences and interests, any recurring themes or requests, and the overall relationship tone. Be warm and specific.\n\n${transcript}`,
          },
        ],
      });

      if (!res.content.length || res.content[0].type !== "text") return;
      const summaryText = res.content[0].text.trim();

      // Remove old summary pair + compressed turns in-place
      conversationHistory.splice(0, startIdx + SUMMARY_COMPRESS);

      // Inject new summary pair at position 0 (user must come first for alternating-role requirement)
      conversationHistory.unshift(
        { role: "user" as const, content: `[Context from earlier conversations with ${config.kidName}]\n${summaryText}` },
        { role: "assistant" as const, content: "Got it! I remember all of that. 😊" }
      );

      _summaryInjected = true;
      upsertSummary(summaryText);
      console.log(`[telegram] Conversation compressed — summary saved (${summaryText.length} chars)`);
    } catch (err) {
      console.error("[telegram] Summarization failed (non-fatal):", err);
    }
  } finally {
    _compressing = false;
  }
}

// ── Diagnostic logging ────────────────────────────────────────────────────
// Appends one JSONL line per Claude reply at .guardian/raw-replies.jsonl,
// capturing the pre-strip text and every decision point. Lets us tell, after
// the fact, whether a build-in-progress message was a model hallucination
// caught by the guard, a hallucination that survived re-prompting, or a
// legitimate token-bearing reply that's waiting on the kid's confirmation.

export type RawReplyEntry = {
  ts: string;
  kidMessage: string;
  initialReply: string;
  initialHasToken: boolean;
  halluFired: boolean;
  urlHalluFired: boolean;
  correctedReply: string | null;
  finalReply: string;
  tokenMatch: { gameName: string; gameId?: string } | null;
  pendingBuildAfter: { gameName: string; gameId?: string; revisionRequest?: string } | null;
};

export function logRawReply(playgroundDir: string, entry: Omit<RawReplyEntry, "ts">): void {
  try {
    const path = join(playgroundDir, ".guardian", "raw-replies.jsonl");
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    appendFileSync(path, line);
  } catch (err) {
    console.error("[telegram] Failed to append raw-reply log:", err);
  }
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function callPmSynthesizerApi(
  anthropic: Anthropic,
  system: string,
  userMessage: string
): Promise<string> {
  const r = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  if (!r.content.length || r.content[0].type !== "text") {
    throw new Error("non-text response from Anthropic");
  }
  return r.content[0].text;
}

async function handleMessage(
  anthropic: Anthropic,
  chatId: number,
  fromId: number,
  text: string,
  image?: { base64: string; mimeType: "image/jpeg" }
): Promise<void> {
  if (fromId !== config.kidTelegramId) {
    console.log(`Ignored message from unknown sender ${fromId}.`);
    return;
  }

  const flagged = flagsMessage(text);
  insertTurn("kid", text, flagged);
  if (flagged) console.warn(`⚠️  FLAGGED message: "${text}"`);

  if (pendingGameBuild !== null) {
    if (isConfirmation(text)) {
      const { gameName, gameId, revisionRequest } = pendingGameBuild;
      setPendingBuild(null);
      conversationHistory.push({ role: "user", content: text });
      const startMsg = "Ok let me make it!! Give me a sec... 🔨⭐";
      await sendMessage(chatId, startMsg);
      insertTurn("guardian", startMsg);
      conversationHistory.push({ role: "assistant", content: startMsg });
      try {
        // Resolve slug + revision state. resolveSlug() is the same helper buildGame() uses internally.
        const gamesDir = join(config.playgroundDir, "games");
        const slug = resolveSlug(gameName, gameId);
        const indexPath = join(gamesDir, slug, "index.html");
        const specPath = join(gamesDir, slug, "spec.md");
        const isRevision = existsSync(indexPath);

        // Inputs to the synthesizer
        const recentContext = conversationHistory.slice(-20).map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "[media]",
        }));
        const priorSpec = existsSync(specPath) ? readFileSync(specPath, "utf8") : undefined;
        const existingIndexHtml = !priorSpec && isRevision && existsSync(indexPath)
          ? readFileSync(indexPath, "utf8")
          : undefined;

        let specContent: string;
        try {
          specContent = await synthesizeSpec(
            {
              gameName,
              slug,
              isRevision,
              conversationTurns: recentContext,
              priorSpec,
              existingIndexHtml,
              today: todayLocal(),
            },
            {
              callApi: (system, userMessage) => callPmSynthesizerApi(anthropic, system, userMessage),
            }
          );
        } catch (e) {
          if (e instanceof SynthesizerError) {
            console.error("[telegram] synthesizer failed twice — using fallback spec:", (e as SynthesizerError).message);
            specContent = buildFallbackSpec({
              gameName,
              today: todayLocal(),
              conversationTurns: recentContext,
              isRevision,
            });
          } else {
            throw e;  // unexpected error — let the outer catch handle it
          }
        }

        await writeSpecFile(gamesDir, slug, specContent);

        const { url, jobPath } = await buildGame(
          gameName,
          chatId,
          specContent,
          specPath,
          (msg) => sendMessage(chatId, msg).catch(() => {}),
          gameId
        );
        const reply = `Here it is!! Open this on your tablet: ${url} 🎉`;
        await sendMessage(chatId, reply);
        insertTurn("guardian", reply);
        conversationHistory.push({ role: "assistant", content: reply });
        try {
          const job = JSON.parse(readFileSync(jobPath, "utf8"));
          job.telegramSentAt = new Date().toISOString();
          writeFileSync(jobPath, JSON.stringify(job, null, 2));
        } catch { /* non-fatal */ }
      } catch (err) {
        console.error("Build failed:", err);
        let reply: string;
        if (err instanceof BuildNotPickedUpError) {
          reply = `Hmm, I hit a little snag! 😅 Want to try again? Just say yes and I'll get right on it! 🔨`;
        } else {
          reply = `Oops, something went a little wrong! 😅 Want to try again? Just say yes!`;
        }
        await sendMessage(chatId, reply);
        insertTurn("guardian", reply);
        conversationHistory.push({ role: "assistant", content: reply });
        setPendingBuild({ gameName, gameId, revisionRequest });
      }
      return;
    } else {
      setPendingBuild(null);
      conversationHistory.push({ role: "user", content: text });
      const cancelMsg = "No problem! 😊 What would you like to do?";
      await sendMessage(chatId, cancelMsg);
      insertTurn("guardian", cancelMsg);
      conversationHistory.push({ role: "assistant", content: cancelMsg });
      return;
    }
  }

  const userContent: Anthropic.Messages.MessageParam["content"] = image
    ? [
        { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } },
        { type: "text", text: text || "What do you see in this picture?" },
      ]
    : text;

  const historyText = image ? `[${config.kidName} sent a photo${text ? `: "${text}"` : ""}]` : text;
  conversationHistory.push({ role: "user", content: historyText });

  if (isFrustrated(text)) {
    conversationHistory.push({
      role: "user",
      content: `[Guardian note: ${config.kidName} seems frustrated. Please respond with extra warmth, slow down, and offer to try something simpler or take a break.]`,
    });
  }

  const cappedHistory = conversationHistory.slice(-40);
  const messagesForApi = [
    ...cappedHistory.slice(0, -1),
    { role: "user" as const, content: userContent },
  ];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: getGuardianSystemPrompt(config.kidName, getExistingGames()),
    messages: messagesForApi,
  });

  if (!response.content.length || response.content[0].type !== "text") {
    console.error("Unexpected Claude response");
    return;
  }

  const initialReply = response.content[0].text;
  let reply = initialReply;

  // Safety net: if Claude used build-in-progress language OR a confirmation
  // question ("Should I make it now?") without including a GAME_NAME: token,
  // it's a forgotten-token case — re-prompt once to get a corrected response.
  const nameMatch = () => reply.match(/^GAME_NAME:\s*(.+)$/m);
  const BUILD_HALLUCINATION_RE = /\b(right now|working on it|on it[!,. ]|give me a sec|i'?m (building|making|updating|creating)|building it|making it|updating it)\b/i;
  const BUILD_CONFIRMATION_QUESTION_RE = /\bshould i\b.{0,80}\b(make|build|update|create|do)\b.{0,80}\bnow\b/i;
  const initialHasToken = !!nameMatch();
  let halluFired = false;
  let correctedReply: string | null = null;
  if (!initialHasToken && (BUILD_HALLUCINATION_RE.test(reply) || BUILD_CONFIRMATION_QUESTION_RE.test(reply))) {
    halluFired = true;
    console.warn("[telegram] Build hallucination detected — re-prompting Claude");
    const corrected = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: getGuardianSystemPrompt(config.kidName, getExistingGames()),
      messages: [
        ...messagesForApi,
        { role: "assistant" as const, content: reply },
        { role: "user" as const, content: "[System: Your response implied a build is in progress but no GAME_NAME: token was included, so nothing will actually be built. Please send a corrected response: either include the GAME_NAME: token if you are ready to build and ask 'Should I make it now? 🎮', or reply without any build-in-progress language.]" },
      ],
    });
    if (corrected.content.length && corrected.content[0].type === "text") {
      correctedReply = corrected.content[0].text;
      reply = correctedReply;
    }
  }

  // Second safety net: if the reply has BOTH a GAME_NAME: token AND a /games/<slug>/
  // URL inside the same message, the LLM has hallucinated the build-completion
  // step. The real flow only emits a URL after buildGame returns, in a separate
  // sendMessage call — never in the same reply as the token. Re-prompt to get a
  // clean confirmation question without the fake URL.
  const HALLUCINATED_GAME_URL_RE = /https?:\/\/[^\s]+\/games\//i;
  let urlHalluFired = false;
  if (!!nameMatch() && HALLUCINATED_GAME_URL_RE.test(reply)) {
    urlHalluFired = true;
    console.warn("[telegram] Hallucinated game URL in tokenized reply — re-prompting Claude");
    const corrected = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: getGuardianSystemPrompt(config.kidName, getExistingGames()),
      messages: [
        ...messagesForApi,
        { role: "assistant" as const, content: reply },
        { role: "user" as const, content: "[System: Your reply contained a fabricated game URL. Only the server can produce a real URL after the build completes. Please send a corrected response: keep the GAME_NAME: token and ask 'Should I make it now? 🎮' (or 'Should I do it now? 🎮' for updates), but remove any URL, 'Here it is', 'Open this on your tablet', or 'Ok let me make it' content. The kid hasn't confirmed yet — just ask.]" },
      ],
    });
    if (corrected.content.length && corrected.content[0].type === "text") {
      reply = corrected.content[0].text;
    }
  }

  const tokenMatch = nameMatch();
  const idMatch = reply.match(/^GAME_ID:\s*(.+)$/m);
  if (tokenMatch) {
    setPendingBuild({
      gameName: tokenMatch[1].trim(),
      gameId: idMatch ? idMatch[1].trim() : undefined,
      revisionRequest: text || undefined,
    });
  }

  logRawReply(config.playgroundDir, {
    kidMessage: text,
    initialReply,
    initialHasToken,
    halluFired,
    urlHalluFired,
    correctedReply,
    finalReply: reply,
    tokenMatch: tokenMatch
      ? { gameName: tokenMatch[1].trim(), gameId: idMatch ? idMatch[1].trim() : undefined }
      : null,
    pendingBuildAfter: pendingGameBuild,
  });

  const cleanReply = reply
    .replace(/^GAME_ID:\s*.+\n?/m, "")
    .replace(/^GAME_NAME:\s*.+\n?/m, "")
    .trim();
  conversationHistory.push({ role: "assistant", content: cleanReply });
  insertTurn("guardian", cleanReply);
  await sendMessage(chatId, cleanReply);

  if (conversationHistory.length > SUMMARY_TRIGGER) {
    compressOldTurns(anthropic).catch((e) => console.error("[telegram] compressOldTurns error:", e));
  }
}

type TelegramUpdate = {
  update_id: number;
  message?: {
    from: { id: number };
    chat: { id: number };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; width: number; height: number }>;
  };
};

async function pollLoop(anthropic: Anthropic): Promise<void> {
  let offset = 0;
  console.log(`\n🤖 Guardian ready! Listening for ${config.kidName}...`);

  while (!_stopSignal) {
    try {
      const updates = await tgGet<TelegramUpdate[]>("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message"],
      });

      for (const update of updates) {
        if (_stopSignal) break;
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text && !msg?.photo) continue;

        let image: { base64: string; mimeType: "image/jpeg" } | undefined;
        if (msg.photo?.length) {
          console.log(`📷 [${msg.from.id}]: photo${msg.caption ? ` — "${msg.caption}"` : ""}`);
          const largest = msg.photo[msg.photo.length - 1];
          image = await downloadPhoto(largest.file_id).catch((err) => {
            console.error("Failed to download photo:", err);
            return undefined;
          });
        }

        const text = msg.text ?? msg.caption ?? "";
        if (!msg.photo?.length) {
          console.log(`📨 [${msg.from.id}]: ${msg.text}`);
        }
        await handleMessage(anthropic, msg.chat.id, msg.from.id, text, image).catch((err) =>
          console.error("Error handling message:", err)
        );
      }
    } catch (err) {
      if (_stopSignal) break;
      console.error("Polling error (retrying in 3s):", err);
      await Bun.sleep(3000);
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export function start(): void {
  if (_running) return;
  _running = true;
  _stopSignal = false;
  state.status = "running";
  state.startedAt = new Date();
  state.error = null;

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  // Seed conversation history from DB, using summary if available
  conversationHistory.length = 0;
  _summaryInjected = false;

  // Re-hydrate pending build from disk so a confirm survives a restart.
  // Stale entries (>30 min) are dropped inside loadPendingBuild.
  pendingGameBuild = loadPendingBuild();
  if (pendingGameBuild) {
    console.log(`[telegram] restored pendingGameBuild: ${pendingGameBuild.gameName}`);
  }

  const summary = getLatestSummary();
  if (summary) {
    // Inject summary pair at position 0 (user first for alternating-role requirement)
    conversationHistory.push(
      { role: "user", content: `[Context from earlier conversations with ${config.kidName}]\n${summary.content}` },
      { role: "assistant", content: "Got it! I remember all of that. 😊" }
    );
    _summaryInjected = true;
    // Load fewer recent turns since summary covers the rest
    const savedTurns = getRecentTurns(30).reverse();
    for (const turn of savedTurns) {
      conversationHistory.push({ role: turn.direction === "kid" ? "user" : "assistant", content: turn.message });
    }
  } else {
    const savedTurns = getRecentTurns(40).reverse();
    for (const turn of savedTurns) {
      conversationHistory.push({ role: turn.direction === "kid" ? "user" : "assistant", content: turn.message });
    }
  }

  pollLoop(anthropic)
    .catch((err) => {
      state.status = "error";
      state.error = err instanceof Error ? err.message : String(err);
      console.error("Telegram loop crashed:", err);
    })
    .finally(() => {
      _running = false;
      if (state.status === "running") state.status = "stopped";
    });
}

export function stop(): void {
  _stopSignal = true;
  state.status = "stopped";
  state.startedAt = null;
}

export async function resetZombieJobs(): Promise<void> {
  const jobsDir = join(config.playgroundDir, ".guardian", "jobs");
  if (!existsSync(jobsDir)) return;
  try {
    const files = readdirSync(jobsDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const filePath = join(jobsDir, f);
      let job: Record<string, unknown>;
      try { job = JSON.parse(readFileSync(filePath, "utf8")); } catch { continue; }
      if (
        job.status === "in_progress" &&
        job.pickedUpAt &&
        new Date(job.pickedUpAt as string).getTime() < Date.now() - ZOMBIE_THRESHOLD_MS
      ) {
        job.status = "pending";
        job.pickedUpAt = null;
        job.claimedBy = null;
        writeFileSync(filePath, JSON.stringify(job, null, 2));
        console.log(`[telegram] Zombie job reset to pending on startup: ${f}`);
      }
    }
  } catch (err) {
    console.error("[telegram] resetZombieJobs error:", err);
  }
}

export async function recoverOrphanedJobs(): Promise<void> {
  const jobsDir = join(config.playgroundDir, ".guardian", "jobs");
  if (!existsSync(jobsDir)) return;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours — catch jobs completed while guardian was down
  try {
    const files = readdirSync(jobsDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const filePath = join(jobsDir, f);
      let job: Record<string, unknown>;
      try { job = JSON.parse(readFileSync(filePath, "utf8")); }
      catch { continue; }
      if (
        job.status === "done" &&
        job.chatId &&
        !job.telegramSentAt &&
        job.url &&
        new Date(job.completedAt as string).getTime() > cutoff
      ) {
        console.log(`[telegram] Recovering orphaned job ${f}, re-sending URL...`);
        try {
          const msg = job.isRevision
            ? `✅ Updated! Same link: ${job.url} 🎉`
            : `Here it is!! Open this on your tablet: ${job.url} 🎉`;
          await sendMessage(job.chatId as number, msg);
          job.telegramSentAt = new Date().toISOString();
          writeFileSync(filePath, JSON.stringify(job, null, 2));
          console.log(`[telegram] Orphaned job ${f} recovered`);
        } catch (err) {
          console.error(`[telegram] Failed to recover orphaned job ${f}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[telegram] recoverOrphanedJobs error:", err);
  }
}
