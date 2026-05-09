import Anthropic from "@anthropic-ai/sdk";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "./config";
import { insertTurn, getRecentTurns, upsertSummary, getLatestSummary } from "./db";
import { getGuardianSystemPrompt } from "./prompts";
import { buildGame, BuildNotPickedUpError, getExistingGames } from "./builder";

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
const BUILD_CONFIRMATIONS = ["yes", "yeah", "yep", "yup", "ok", "okay", "sure", "do it", "build it", "make it", "lets go", "let's go"];

function isFrustrated(text: string): boolean {
  const lower = text.toLowerCase();
  return FRUSTRATION_SIGNALS.some((s) => lower.includes(s));
}

function isConfirmation(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return BUILD_CONFIRMATIONS.some((c) => lower.includes(c));
}

// ── Pending-build intent classifier ──────────────────────────────────────

export type PendingIntent = "CONFIRM" | "CANCEL" | "CLARIFY";

const CANCEL_TOKENS = new Set([
  "no", "nope", "stop", "cancel", "nevermind", "never mind", "wait", "wait!", "not yet",
  "actually no", "scrap that", "no thanks", "skip", "nah",
]);

function looksLikeCancel(text: string): boolean {
  const n = text.trim().toLowerCase().replace(/[!?.…,]/g, "");
  if (!n) return false;
  if (CANCEL_TOKENS.has(n)) return true;
  const firstSpace = n.indexOf(" ");
  if (firstSpace > 0 && CANCEL_TOKENS.has(n.slice(0, firstSpace))) return true;
  return false;
}

export async function classifyPendingResponse(
  text: string,
  pending: { gameName: string; gameId?: string; revisionRequest?: string },
  anthropic: Anthropic
): Promise<PendingIntent> {
  if (isConfirmation(text)) return "CONFIRM";
  if (looksLikeCancel(text)) return "CANCEL";

  // LLM fallback
  try {
    const r = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 16,
      system: `You classify a kid's reply when an AI assistant has asked "should I update this game now?" The pending change is: "${pending.revisionRequest ?? "(building a new game)"}".\n\nReturn EXACTLY one of these uppercase labels and nothing else:\n- CONFIRM: kid is agreeing to proceed (yes/yep/sure/etc.)\n- CANCEL: kid is rejecting/aborting the change (no/stop/never mind/etc.)\n- CLARIFY: kid is refining, correcting, or adding detail to the pending change (most common when reply is a sentence describing the bug or feature differently)`,
      messages: [{ role: "user", content: `Kid's reply: ${text}` }],
    });
    const out = (r.content[0]?.type === "text" ? r.content[0].text : "").trim().toUpperCase();
    if (out.includes("CONFIRM")) return "CONFIRM";
    if (out.includes("CANCEL")) return "CANCEL";
    return "CLARIFY";
  } catch {
    return "CLARIFY"; // safest default — preserves pending context
  }
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
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(45_000) });
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
let pendingGameBuild: { gameName: string; gameId?: string; revisionRequest?: string } | null = null;
let _summaryInjected = false;

// ── Conversation summarization ────────────────────────────────────────────

const SUMMARY_TRIGGER = 60;   // compress when history exceeds this
const SUMMARY_COMPRESS = 30;  // number of old turns to summarize

async function compressOldTurns(anthropic: Anthropic): Promise<void> {
  // Strip the existing summary pair at position 0 if present
  const startIdx = _summaryInjected ? 2 : 0;
  const oldTurns = conversationHistory.slice(startIdx, startIdx + SUMMARY_COMPRESS);
  if (oldTurns.length < 10) return; // not enough to bother

  const transcript = oldTurns
    .map((m) => {
      const speaker = m.role === "user" ? config.sonName : "Guardian";
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
          content: `Summarize this conversation between a child (${config.sonName}, age 7-8) and a game-building assistant in 3-5 sentences. Focus on: games discussed or built, the child's preferences and interests, any recurring themes or requests, and the overall relationship tone. Be warm and specific.\n\n${transcript}`,
        },
      ],
    });

    if (!res.content.length || res.content[0].type !== "text") return;
    const summaryText = res.content[0].text.trim();

    // Remove old summary pair + compressed turns in-place
    conversationHistory.splice(0, startIdx + SUMMARY_COMPRESS);

    // Inject new summary pair at position 0 (user must come first for alternating-role requirement)
    conversationHistory.unshift(
      { role: "user" as const, content: `[Context from earlier conversations with ${config.sonName}]\n${summaryText}` },
      { role: "assistant" as const, content: "Got it! I remember all of that. 😊" }
    );

    _summaryInjected = true;
    upsertSummary(summaryText);
    console.log(`[telegram] Conversation compressed — summary saved (${summaryText.length} chars)`);
  } catch (err) {
    console.error("[telegram] Summarization failed (non-fatal):", err);
  }
}

async function handleMessage(
  anthropic: Anthropic,
  chatId: number,
  fromId: number,
  text: string,
  image?: { base64: string; mimeType: "image/jpeg" }
): Promise<void> {
  if (fromId !== config.sonTelegramId) {
    console.log(`Ignored message from unknown sender ${fromId}.`);
    return;
  }

  const flagged = flagsMessage(text);
  insertTurn("kid", text, flagged);
  if (flagged) console.warn(`⚠️  FLAGGED message: "${text}"`);

  if (pendingGameBuild !== null) {
    const intent = await classifyPendingResponse(text, pendingGameBuild, anthropic);
    if (intent === "CONFIRM") {
      const { gameName, gameId, revisionRequest } = pendingGameBuild;
      pendingGameBuild = null;
      conversationHistory.push({ role: "user", content: text });
      const startMsg = "Ok let me make it!! Give me a sec... 🔨⭐";
      await sendMessage(chatId, startMsg);
      insertTurn("guardian", startMsg);
      conversationHistory.push({ role: "assistant", content: startMsg });
      try {
        const recentContext = conversationHistory.slice(-10).map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "[media]",
        }));
        const { url, jobPath } = await buildGame(gameName, chatId, revisionRequest, (msg) => sendMessage(chatId, msg).catch(() => {}), recentContext, gameId);
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
        pendingGameBuild = { gameName, gameId, revisionRequest };
      }
      return;
    } else if (intent === "CANCEL") {
      pendingGameBuild = null;
      conversationHistory.push({ role: "user", content: text });
      const cancelMsg = "No problem! 😊 What would you like to do?";
      await sendMessage(chatId, cancelMsg);
      insertTurn("guardian", cancelMsg);
      conversationHistory.push({ role: "assistant", content: cancelMsg });
      return;
    } else {
      // CLARIFY — merge clarification into revisionRequest, re-ask confirmation
      const merged = pendingGameBuild.revisionRequest
        ? `${pendingGameBuild.revisionRequest}\n\nClarification: ${text}`
        : text;
      pendingGameBuild = { ...pendingGameBuild, revisionRequest: merged };
      conversationHistory.push({ role: "user", content: text });
      const lastClarification = merged.split("\n\nClarification: ").pop() ?? text;
      const clarifyReply = `Got it, thanks for the extra detail!! 🎯\n\nSo the change is: ${lastClarification}\n\nShould I update it now? ✨`;
      await sendMessage(chatId, clarifyReply);
      insertTurn("guardian", clarifyReply);
      conversationHistory.push({ role: "assistant", content: clarifyReply });
      return;
    }
  }

  const userContent: Anthropic.Messages.MessageParam["content"] = image
    ? [
        { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } },
        { type: "text", text: text || "What do you see in this picture?" },
      ]
    : text;

  const historyText = image ? `[${config.sonName} sent a photo${text ? `: "${text}"` : ""}]` : text;
  conversationHistory.push({ role: "user", content: historyText });

  if (isFrustrated(text)) {
    conversationHistory.push({
      role: "user",
      content: `[Guardian note: ${config.sonName} seems frustrated. Please respond with extra warmth, slow down, and offer to try something simpler or take a break.]`,
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
    system: getGuardianSystemPrompt(config.sonName, getExistingGames()),
    messages: messagesForApi,
  });

  if (!response.content.length || response.content[0].type !== "text") {
    console.error("Unexpected Claude response");
    return;
  }

  let reply = response.content[0].text;

  // Safety net: if Claude used build-in-progress language without including a GAME_NAME: token,
  // it's a hallucinated build — re-prompt once to get a corrected response.
  const nameMatch = () => reply.match(/^GAME_NAME:\s*(.+)$/m);
  const BUILD_HALLUCINATION_RE = /\b(right now|working on it|on it[!,. ]|give me a sec|i'?m (building|making|updating|creating)|building it|making it|updating it)\b/i;
  if (!nameMatch() && BUILD_HALLUCINATION_RE.test(reply)) {
    console.warn("[telegram] Build hallucination detected — re-prompting Claude");
    const corrected = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: getGuardianSystemPrompt(config.sonName, getExistingGames()),
      messages: [
        ...messagesForApi,
        { role: "assistant" as const, content: reply },
        { role: "user" as const, content: "[System: Your response implied a build is in progress but no GAME_NAME: token was included, so nothing will actually be built. Please send a corrected response: either include the GAME_NAME: token if you are ready to build and ask 'Should I make it now? 🎮', or reply without any build-in-progress language.]" },
      ],
    });
    if (corrected.content.length && corrected.content[0].type === "text") {
      reply = corrected.content[0].text;
    }
  }

  const tokenMatch = nameMatch();
  const idMatch = reply.match(/^GAME_ID:\s*(.+)$/m);
  if (tokenMatch) {
    pendingGameBuild = {
      gameName: tokenMatch[1].trim(),
      gameId: idMatch ? idMatch[1].trim() : undefined,
      revisionRequest: text || undefined,
    };
  }

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
  console.log(`\n🤖 Guardian ready! Listening for ${config.sonName}...`);

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

  const summary = getLatestSummary();
  if (summary) {
    // Inject summary pair at position 0 (user first for alternating-role requirement)
    conversationHistory.push(
      { role: "user", content: `[Context from earlier conversations with ${config.sonName}]\n${summary.content}` },
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

const ZOMBIE_THRESHOLD_MS = 10 * 60 * 1000;

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
          await sendMessage(job.chatId as number, `Here it is!! Open this on your tablet: ${job.url} 🎉`);
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
