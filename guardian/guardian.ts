import Anthropic from "@anthropic-ai/sdk";
import { resolve, sep } from "path";
import { config } from "./config";
import { initDb, insertTurn } from "./db";
import { getGuardianSystemPrompt } from "./prompts";
import { buildGame } from "./builder";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const TG_BASE = `https://api.telegram.org/bot${config.kidBotToken}`;

async function tgGet<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(`${TG_BASE}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString());
  const json = (await res.json()) as { ok: boolean; result: T };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
  return json.result;
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  await tgGet("sendMessage", { chat_id: chatId, text });
}

const conversationHistory: Anthropic.Messages.MessageParam[] = [];
let pendingGameBuild: string | null = null;

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

function flagsMessage(text: string): boolean {
  const lower = text.toLowerCase();
  const alarmPhrases = ["where do you live", "what is your address", "send me money", "phone number", "password", "credit card"];
  return alarmPhrases.some((p) => lower.includes(p));
}

async function handleMessage(chatId: number, fromId: number, text: string): Promise<void> {
  if (fromId !== config.sonTelegramId) {
    console.log(`Ignored message from unknown sender ${fromId}. Add them to SON_TELEGRAM_ID if intended.`);
    return;
  }

  const flagged = flagsMessage(text);
  insertTurn("kid", text, flagged);
  if (flagged) console.warn(`⚠️  FLAGGED message: "${text}"`);

  if (pendingGameBuild !== null) {
    if (isConfirmation(text)) {
      const gameName = pendingGameBuild;
      pendingGameBuild = null;
      await sendMessage(chatId, "Ok let me make it!! Give me a sec... 🔨⭐");
      try {
        const { url } = await buildGame(gameName);
        const reply = `Here it is!! Open this on your tablet: ${url} 🎉`;
        await sendMessage(chatId, reply);
        insertTurn("guardian", reply);
      } catch (err) {
        console.error("Build failed:", err);
        const reply = `Oops, something went a little wrong! 😅 Want to try again? Just say yes!`;
        await sendMessage(chatId, reply);
        insertTurn("guardian", reply);
        pendingGameBuild = gameName;
      }
      return;
    } else {
      pendingGameBuild = null;
    }
  }

  conversationHistory.push({ role: "user", content: text });

  const cappedHistory = conversationHistory.slice(-40);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: getGuardianSystemPrompt(config.sonName),
    messages: cappedHistory,
  });

  if (!response.content.length || response.content[0].type !== "text") {
    console.error("Unexpected Claude response");
    return;
  }

  const reply = response.content[0].text;

  const tokenMatch = reply.match(/^GAME_NAME:\s*(.+)$/m);
  if (tokenMatch) {
    pendingGameBuild = tokenMatch[1].trim();
  }

  const cleanReply = reply.replace(/^GAME_NAME:\s*.+\n?/m, "").trim();
  conversationHistory.push({ role: "assistant", content: cleanReply });
  insertTurn("guardian", cleanReply);

  await sendMessage(chatId, cleanReply);
}

type TelegramUpdate = {
  update_id: number;
  message?: {
    from: { id: number };
    chat: { id: number };
    text?: string;
  };
};

async function pollTelegram(): Promise<void> {
  let offset = 0;
  console.log(`\n🤖 Guardian ready! Listening for ${config.sonName}...`);
  console.log(`🌐 Games at: http://${config.lanIp}:${config.port}/\n`);

  while (true) {
    try {
      const updates = await tgGet<TelegramUpdate[]>("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message"],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;
        console.log(`📨 [${msg.from.id}]: ${msg.text}`);
        await handleMessage(msg.chat.id, msg.from.id, msg.text).catch((err) =>
          console.error("Error handling message:", err)
        );
      }
    } catch (err) {
      console.error("Polling error (retrying in 3s):", err);
      await Bun.sleep(3000);
    }
  }
}

function startServer(): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port: config.port,
    fetch(req) {
      let pathname = new URL(req.url).pathname;
      if (pathname === "/" || pathname.endsWith("/")) pathname += "index.html";
      const root = resolve(config.playgroundDir);
      const filePath = resolve(root, "." + pathname);
      if (!filePath.startsWith(root + sep)) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(Bun.file(filePath));
    },
    error(err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return new Response("Not found", { status: 404 });
      }
      return new Response("Server error", { status: 500 });
    },
  });
  console.log(`🌐 Serving playground at http://${config.lanIp}:${server.port}/`);
  return server;
}

async function main(): Promise<void> {
  initDb(config.playgroundDir);
  const server = startServer();

  console.log(`✅ Guardian started for ${config.sonName}`);
  console.log(`📱 Accepting messages from Telegram ID: ${config.sonTelegramId}`);

  process.on("SIGINT", () => {
    console.log("\n👋 Shutting down...");
    server.stop();
    process.exit(0);
  });

  await pollTelegram();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
