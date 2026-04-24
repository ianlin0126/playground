# Parent Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Guardian Agent with a local web dashboard at `http://localhost:3000/parent` — a setup wizard for first-time parents and an ongoing sidebar-nav interface for monitoring conversations, managing games, and controlling the guardian.

**Architecture:** Refactor `guardian.ts` into two independently-controllable concerns: an HTTP server that always runs (serving games + dashboard + API), and a Telegram polling loop that can be started/stopped. A new `dashboard/` directory holds the static HTML/CSS. A new `guardian/api.ts` module handles all `/api/*` routes, which are restricted to `127.0.0.1`.

**Tech Stack:** Bun, TypeScript, vanilla HTML/CSS/JS (no frontend framework), `bun:sqlite`, Anthropic SDK, Telegram Bot API.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `guardian/config.ts` | Add env file I/O helpers, soft startup (no exit on missing vars), `getMissingFields()`, `applyEnvToConfig()` |
| Create | `guardian/telegram.ts` | Telegram polling loop with `start()` / `stop()` / exported `state` |
| Create | `guardian/api.ts` | All `/api/*` route handlers |
| Modify | `guardian/guardian.ts` | Wire telegram module, add dashboard routing, serve `dashboard/` files |
| Create | `dashboard/style.css` | Shared styles for dashboard and setup wizard |
| Create | `dashboard/setup.html` | Multi-step first-run setup wizard |
| Create | `dashboard/index.html` | Parent dashboard SPA — sidebar nav, four sections, 5-second polling |
| Create | `SETUP.md` | Distribution instructions for other parents |

---

## Task 1: Config Helpers

**Files:**
- Modify: `guardian/config.ts`
- Create: `guardian/config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `guardian/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Each test gets a fresh temp dir
let testDir: string;
beforeEach(() => {
  testDir = join(tmpdir(), `cfg-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});
afterEach(() => rmSync(testDir, { recursive: true, force: true }));

// Import after setting up — config.ts reads playgroundDir from import.meta
// We'll test the helpers by importing them with a custom dir arg
import { readEnvFile, writeEnvAll, getMissingFields } from "./config";

describe("readEnvFile", () => {
  it("returns empty object when file does not exist", () => {
    expect(readEnvFile(testDir)).toEqual({});
  });

  it("parses key=value pairs", () => {
    writeFileSync(join(testDir, ".env"), "FOO=bar\nBAZ=qux\n");
    expect(readEnvFile(testDir)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comment lines", () => {
    writeFileSync(join(testDir, ".env"), "# comment\nFOO=bar\n");
    expect(readEnvFile(testDir)).toEqual({ FOO: "bar" });
  });
});

describe("writeEnvAll", () => {
  it("writes new file with all fields", () => {
    writeEnvAll(testDir, { A: "1", B: "2" });
    expect(readEnvFile(testDir)).toEqual({ A: "1", B: "2" });
  });

  it("merges with existing fields", () => {
    writeFileSync(join(testDir, ".env"), "A=old\n");
    writeEnvAll(testDir, { B: "new" });
    const result = readEnvFile(testDir);
    expect(result.A).toBe("old");
    expect(result.B).toBe("new");
  });
});

describe("getMissingFields", () => {
  it("returns all required keys when env is empty", () => {
    const missing = getMissingFields(testDir);
    expect(missing).toContain("KID_BOT_TOKEN");
    expect(missing).toContain("ANTHROPIC_API_KEY");
    expect(missing).toContain("SON_NAME");
    expect(missing).toContain("SON_TELEGRAM_ID");
  });

  it("returns empty array when all keys present", () => {
    writeFileSync(join(testDir, ".env"),
      "KID_BOT_TOKEN=tok\nANTHROPIC_API_KEY=key\nSON_NAME=Clive\nSON_TELEGRAM_ID=123\n");
    expect(getMissingFields(testDir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/ian/ai-workspace/playground && bun test guardian/config.test.ts
```

Expected: compile error — `readEnvFile`, `writeEnvAll`, `getMissingFields` not exported.

- [ ] **Step 3: Implement helpers in `guardian/config.ts`**

Replace the full file with:

```typescript
import { networkInterfaces } from "os";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const REQUIRED_KEYS = ["KID_BOT_TOKEN", "ANTHROPIC_API_KEY", "SON_NAME", "SON_TELEGRAM_ID"] as const;

// ── Env file I/O ───────────────────────────────────────────────────────────

export function readEnvFile(dir: string): Record<string, string> {
  const envPath = join(dir, ".env");
  if (!existsSync(envPath)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) result[m[1].trim()] = m[2].trim();
  }
  return result;
}

export function writeEnvAll(dir: string, fields: Record<string, string>): void {
  const current = readEnvFile(dir);
  Object.assign(current, fields);
  const envPath = join(dir, ".env");
  writeFileSync(envPath, Object.entries(current).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}

export function getMissingFields(dir: string): string[] {
  const env = readEnvFile(dir);
  return REQUIRED_KEYS.filter(k => !env[k]);
}

// ── Runtime config ────────────────────────────────────────────────────────

function loadEnv(key: string): string {
  return process.env[key] ?? "";
}

function detectLanIp(): string {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return "localhost";
}

export const config = {
  kidBotToken: loadEnv("KID_BOT_TOKEN"),
  anthropicApiKey: loadEnv("ANTHROPIC_API_KEY"),
  sonName: loadEnv("SON_NAME"),
  sonTelegramId: Number(loadEnv("SON_TELEGRAM_ID")) || 0,
  port: 3000,
  lanIp: detectLanIp(),
  playgroundDir: new URL("..", import.meta.url).pathname.replace(/\/$/, ""),
};

export function applyEnvToConfig(fields: Record<string, string>): void {
  if (fields.KID_BOT_TOKEN !== undefined) config.kidBotToken = fields.KID_BOT_TOKEN;
  if (fields.ANTHROPIC_API_KEY !== undefined) config.anthropicApiKey = fields.ANTHROPIC_API_KEY;
  if (fields.SON_NAME !== undefined) config.sonName = fields.SON_NAME;
  if (fields.SON_TELEGRAM_ID !== undefined) config.sonTelegramId = Number(fields.SON_TELEGRAM_ID) || 0;
}
```

Note: `loadEnv` no longer calls `process.exit()` — the server starts even with an empty `.env`. Missing-field detection is now done via `getMissingFields()`.

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/ian/ai-workspace/playground && bun test guardian/config.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add guardian/config.ts guardian/config.test.ts
git commit -m "feat(config): add env file I/O helpers and soft startup"
```

---

## Task 2: Extract Telegram Module

**Files:**
- Create: `guardian/telegram.ts`
- Modify: `guardian/guardian.ts` (remove extracted code)

- [ ] **Step 1: Create `guardian/telegram.ts`**

Extract all Telegram-specific logic from `guardian.ts`. The loop is made stoppable via a `_stopSignal` flag.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";
import { insertTurn } from "./db";
import { getGuardianSystemPrompt } from "./prompts";
import { buildGame } from "./builder";

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
let pendingGameBuild: { gameName: string; revisionRequest?: string } | null = null;

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
    if (isConfirmation(text)) {
      const { gameName, revisionRequest } = pendingGameBuild;
      pendingGameBuild = null;
      await sendMessage(chatId, "Ok let me make it!! Give me a sec... 🔨⭐");
      insertTurn("guardian", "Ok let me make it!! Give me a sec... 🔨⭐");
      try {
        const recentContext = conversationHistory.slice(-10).map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "[media]",
        }));
        const { url } = await buildGame(gameName, revisionRequest, (msg) => sendMessage(chatId, msg).catch(() => {}), recentContext);
        const reply = `Here it is!! Open this on your tablet: ${url} 🎉`;
        await sendMessage(chatId, reply);
        insertTurn("guardian", reply);
      } catch (err) {
        console.error("Build failed:", err);
        const reply = `Oops, something went a little wrong! 😅 Want to try again? Just say yes!`;
        await sendMessage(chatId, reply);
        insertTurn("guardian", reply);
        pendingGameBuild = { gameName, revisionRequest };
      }
      return;
    } else {
      pendingGameBuild = null;
      const cancelMsg = "No problem! 😊 What would you like to do?";
      await sendMessage(chatId, cancelMsg);
      insertTurn("guardian", cancelMsg);
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
    system: getGuardianSystemPrompt(config.sonName),
    messages: messagesForApi,
  });

  if (!response.content.length || response.content[0].type !== "text") {
    console.error("Unexpected Claude response");
    return;
  }

  const reply = response.content[0].text;
  const tokenMatch = reply.match(/^GAME_NAME:\s*(.+)$/m);
  if (tokenMatch) {
    pendingGameBuild = { gameName: tokenMatch[1].trim(), revisionRequest: text || undefined };
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
          const largest = msg.photo[msg.photo.length - 1];
          image = await downloadPhoto(largest.file_id).catch((err) => {
            console.error("Failed to download photo:", err);
            return undefined;
          });
        }

        const text = msg.text ?? msg.caption ?? "";
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/ian/ai-workspace/playground && bun build guardian/telegram.ts --target bun 2>&1 | head -30
```

Expected: no errors (warnings about unused imports are ok).

- [ ] **Step 3: Commit**

```bash
git add guardian/telegram.ts
git commit -m "feat(telegram): extract polling loop into standalone module with start/stop"
```

---

## Task 3: API Module

**Files:**
- Create: `guardian/api.ts`

This module exports a single `handleApiRequest` function. All `/api/*` route logic lives here.

- [ ] **Step 1: Create `guardian/api.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { config, readEnvFile, writeEnvAll, getMissingFields, applyEnvToConfig } from "./config";
import { state as telegramState, start as startTelegram, stop as stopTelegram } from "./telegram";
import { getRecentTurns } from "./db";

// ── Helpers ───────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isLocalRequest(req: Request, server: Bun.Server): boolean {
  const ip = server.requestIP(req)?.address;
  return ip === "127.0.0.1" || ip === "::1";
}

// ── Handlers ──────────────────────────────────────────────────────────────

function handleStatus(): Response {
  const turns = getRecentTurns(200);
  const today = new Date().toDateString();
  const todayTurns = turns.filter(t => new Date(t.ts).toDateString() === today);
  const flaggedToday = todayTurns.filter(t => t.flagged).length;

  const manifest = (() => {
    const path = join(config.playgroundDir, "games", "manifest.json");
    if (!existsSync(path)) return [];
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return []; }
  })() as Array<{ name: string; slug: string; builtAt: string }>;

  const lastGame = manifest.length ? manifest[manifest.length - 1] : null;

  return json({
    status: telegramState.status,
    startedAt: telegramState.startedAt,
    error: telegramState.error,
    uptime: telegramState.startedAt ? Date.now() - telegramState.startedAt.getTime() : 0,
    messagesToday: todayTurns.filter(t => t.direction === "kid").length,
    flaggedToday,
    gamesBuilt: manifest.length,
    lastGame: lastGame?.name ?? null,
    lanUrl: `http://${config.lanIp}:${config.port}`,
    sonName: config.sonName,
    sonTelegramId: config.sonTelegramId,
    botToken: config.kidBotToken ? `${config.kidBotToken.slice(0, 8)}••••` : null,
  });
}

function handleGuardianStart(): Response {
  if (!getMissingFields(config.playgroundDir).length) {
    startTelegram();
    return json({ ok: true, status: telegramState.status });
  }
  return json({ error: "Setup incomplete" }, 400);
}

function handleGuardianStop(): Response {
  stopTelegram();
  return json({ ok: true, status: telegramState.status });
}

function handleConversations(): Response {
  const turns = getRecentTurns(100);
  return json(turns);
}

function handleGames(): Response {
  const path = join(config.playgroundDir, "games", "manifest.json");
  if (!existsSync(path)) return json([]);
  try {
    return json(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return json([]);
  }
}

function handleConfigGet(): Response {
  const mask = (val: string) => val ? `${val.slice(0, 8)}••••` : "";
  return json({
    sonName: config.sonName,
    sonTelegramId: config.sonTelegramId,
    anthropicApiKey: mask(config.anthropicApiKey),
    kidBotToken: mask(config.kidBotToken),
    playgroundDir: config.playgroundDir,
    port: config.port,
    lanIp: config.lanIp,
  });
}

async function handleConfigPatch(req: Request): Promise<Response> {
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  // Validate Anthropic API key if provided
  if (body.ANTHROPIC_API_KEY) {
    try {
      const sdk = new Anthropic({ apiKey: body.ANTHROPIC_API_KEY, maxRetries: 0 });
      await sdk.models.list();
    } catch {
      return json({ error: "Invalid Anthropic API key" }, 400);
    }
  }

  // Validate Telegram bot token if provided
  if (body.KID_BOT_TOKEN) {
    const res = await fetch(`https://api.telegram.org/bot${body.KID_BOT_TOKEN}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as { ok: boolean; result?: { username: string } };
    if (!data.ok) return json({ error: "Invalid Telegram bot token" }, 400);
    body._botUsername = data.result?.username ?? "";
  }

  // Write to .env and update live config
  const { _botUsername, ...envFields } = body;
  writeEnvAll(config.playgroundDir, envFields);
  applyEnvToConfig(envFields);

  return json({ ok: true, botUsername: _botUsername ?? null });
}

function handleSetupStatus(): Response {
  const missing = getMissingFields(config.playgroundDir);
  return json({ missing, complete: missing.length === 0 });
}

async function handleSetupTelegramId(): Promise<Response> {
  if (!config.kidBotToken) return json({ error: "No bot token configured yet" }, 400);

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.kidBotToken}/getUpdates?timeout=0&allowed_updates=["message"]`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const data = await res.json() as { ok: boolean; result: Array<{ message?: { from: { id: number; first_name: string } } }> };
    if (!data.ok || !data.result.length) return json({ found: false });
    const first = data.result.find(u => u.message?.from);
    if (!first?.message) return json({ found: false });
    return json({ found: true, id: first.message.from.id, name: first.message.from.first_name });
  } catch {
    return json({ found: false });
  }
}

async function handleCheckClaude(): Promise<Response> {
  const proc = Bun.spawn(["which", "claude"], { stdout: "pipe", stderr: "ignore" });
  await proc.exited;
  if (proc.exitCode !== 0) return json({ installed: false, authenticated: false });

  const versionProc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "pipe" });
  await versionProc.exited;
  return json({ installed: true, authenticated: versionProc.exitCode === 0 });
}

async function handleOpenClaude(): Promise<Response> {
  const dir = config.playgroundDir.replace(/'/g, "'\\''");
  Bun.spawn(["osascript", "-e",
    `tell application "Terminal" to do script "cd '${dir}' && claude"`,
  ]);
  return json({ ok: true });
}

// ── Router ────────────────────────────────────────────────────────────────

export async function handleApiRequest(req: Request, server: Bun.Server): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (!path.startsWith("/api/")) return null;

  if (!isLocalRequest(req, server)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (path === "/api/status" && method === "GET") return handleStatus();
  if (path === "/api/guardian/start" && method === "POST") return handleGuardianStart();
  if (path === "/api/guardian/stop" && method === "POST") return handleGuardianStop();
  if (path === "/api/conversations" && method === "GET") return handleConversations();
  if (path === "/api/games" && method === "GET") return handleGames();
  if (path === "/api/config" && method === "GET") return handleConfigGet();
  if (path === "/api/config" && method === "PATCH") return handleConfigPatch(req);
  if (path === "/api/setup/status" && method === "GET") return handleSetupStatus();
  if (path === "/api/setup/telegram-id" && method === "GET") return handleSetupTelegramId();
  if (path === "/api/setup/check-claude" && method === "GET") return handleCheckClaude();
  if (path === "/api/open-claude" && method === "POST") return handleOpenClaude();

  return new Response("Not found", { status: 404 });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/ian/ai-workspace/playground && bun build guardian/api.ts --target bun 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add guardian/api.ts
git commit -m "feat(api): add all /api/* route handlers"
```

---

## Task 4: Refactor `guardian/guardian.ts`

**Files:**
- Modify: `guardian/guardian.ts`

Wire the new modules together. The `fetch` handler gains routing for `/parent`, `/parent/setup`, and `/api/*`. All Telegram-specific code is removed (it now lives in `telegram.ts`).

- [ ] **Step 1: Replace `guardian/guardian.ts`**

```typescript
import { resolve, sep } from "path";
import { existsSync } from "fs";
import { join } from "path";
import { config, getMissingFields } from "./config";
import { initDb } from "./db";
import { start as startTelegram } from "./telegram";
import { handleApiRequest } from "./api";

function startServer(): ReturnType<typeof Bun.serve> {
  const root = resolve(config.playgroundDir);
  const dashboardDir = join(root, "dashboard");

  const server = Bun.serve({
    port: config.port,
    async fetch(req, server) {
      const url = new URL(req.url);
      let pathname = url.pathname;

      // API routes (127.0.0.1 only — enforced inside handleApiRequest)
      if (pathname.startsWith("/api/")) {
        return handleApiRequest(req, server);
      }

      // Parent dashboard
      if (pathname === "/parent" || pathname === "/parent/") {
        const missing = getMissingFields(config.playgroundDir);
        if (missing.length > 0) return Response.redirect("/parent/setup", 302);
        return new Response(Bun.file(join(dashboardDir, "index.html")));
      }

      if (pathname === "/parent/setup" || pathname === "/parent/setup/") {
        return new Response(Bun.file(join(dashboardDir, "setup.html")));
      }

      // Dashboard static assets (style.css etc.)
      if (pathname.startsWith("/parent/")) {
        const asset = pathname.replace("/parent/", "");
        const assetPath = join(dashboardDir, asset);
        if (existsSync(assetPath)) return new Response(Bun.file(assetPath));
      }

      // Game files — served on all interfaces for LAN access
      if (pathname === "/" || pathname.endsWith("/")) pathname += "index.html";
      const filePath = resolve(root, "." + pathname);
      if (!filePath.startsWith(root + sep)) return new Response("Forbidden", { status: 403 });
      const file = Bun.file(filePath);
      const headers = filePath.endsWith(".html")
        ? { "Cache-Control": "no-cache, no-store, must-revalidate" }
        : undefined;
      return new Response(file, { headers });
    },
    error(err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Response("Not found", { status: 404 });
      return new Response("Server error", { status: 500 });
    },
  });

  console.log(`🌐 Serving playground at http://${config.lanIp}:${server.port}/`);
  console.log(`📊 Parent dashboard at http://localhost:${server.port}/parent`);
  return server;
}

async function main(): Promise<void> {
  initDb(config.playgroundDir);
  const server = startServer();

  const missing = getMissingFields(config.playgroundDir);
  if (missing.length > 0) {
    console.log(`\n⚠️  Setup required. Open http://localhost:${config.port}/parent to get started.\n`);
  } else {
    console.log(`✅ Guardian started for ${config.sonName}`);
    console.log(`📱 Accepting messages from Telegram ID: ${config.sonTelegramId}`);
    startTelegram();
  }

  process.on("SIGINT", () => {
    console.log("\n👋 Shutting down...");
    server.stop();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test — server starts**

```bash
cd /Users/ian/ai-workspace/playground && bun run guardian &
sleep 2
curl -s http://localhost:3000/parent -w "\n%{http_code}" | tail -1
kill %1
```

Expected: `302` (redirects to setup since .env may be incomplete) OR `200` (if .env is complete).

- [ ] **Step 3: Smoke test — API is localhost-only**

```bash
cd /Users/ian/ai-workspace/playground && bun run guardian &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/status
kill %1
```

Expected: `200` (localhost request allowed).

- [ ] **Step 4: Commit**

```bash
git add guardian/guardian.ts
git commit -m "refactor(guardian): wire telegram/api modules, add dashboard routing"
```

---

## Task 5: Dashboard Stylesheet

**Files:**
- Create: `dashboard/style.css`

- [ ] **Step 1: Create `dashboard/` directory and `style.css`**

```bash
mkdir -p /Users/ian/ai-workspace/playground/dashboard
```

Create `dashboard/style.css`:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 14px;
  color: #0f172a;
  background: #f1f5f9;
  min-height: 100vh;
}

/* ── Layout ──────────────────────────────────────────────────────────────── */

.shell { display: flex; height: 100vh; overflow: hidden; }

.sidebar {
  width: 200px;
  background: #1e293b;
  color: #94a3b8;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-logo {
  padding: 18px 16px 14px;
  font-size: 15px;
  font-weight: 700;
  color: #f1f5f9;
  border-bottom: 1px solid #334155;
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s, color 0.1s;
}
.nav-item:hover { background: #334155; color: #f1f5f9; }
.nav-item.active { background: #334155; color: #f1f5f9; font-weight: 600; }
.nav-icon { font-size: 15px; width: 20px; text-align: center; }

.sidebar-bottom {
  margin-top: auto;
  padding: 12px 16px;
  border-top: 1px solid #334155;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
  transition: background 0.3s;
}
.status-dot.running { background: #22c55e; }
.status-dot.error { background: #ef4444; }

.main { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }

.topbar {
  background: white;
  border-bottom: 1px solid #e2e8f0;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.topbar h1 { font-size: 17px; font-weight: 700; }

.content { padding: 24px; flex: 1; }

/* ── Buttons ─────────────────────────────────────────────────────────────── */

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 7px;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn:hover { opacity: 0.85; }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn-primary { background: #6366f1; color: white; }
.btn-danger  { background: #fee2e2; color: #dc2626; }
.btn-success { background: #dcfce7; color: #16a34a; }
.btn-ghost   { background: #f1f5f9; color: #475569; }

/* ── Cards ───────────────────────────────────────────────────────────────── */

.card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 18px;
}

.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 18px; }

.stat-card { background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
.stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 6px; }
.stat-value { font-size: 24px; font-weight: 700; }
.stat-sub { font-size: 11px; color: #64748b; margin-top: 3px; }

.control-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 16px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.control-info h3 { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
.control-info p  { font-size: 12px; color: #64748b; }

/* ── Conversations ───────────────────────────────────────────────────────── */

.chat-list { display: flex; flex-direction: column; gap: 10px; }

.chat-msg {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px 16px;
}
.chat-msg.flagged { border-color: #fca5a5; background: #fff5f5; }

.chat-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
.chat-sender { font-size: 12px; font-weight: 600; color: #6366f1; }
.chat-sender.guardian { color: #64748b; }
.chat-time   { font-size: 11px; color: #94a3b8; }
.chat-text   { font-size: 13px; color: #334155; line-height: 1.55; }
.flag-badge  { display: inline-block; background: #fee2e2; color: #dc2626; font-size: 10px; padding: 2px 6px; border-radius: 10px; margin-left: 6px; }

/* ── Games ───────────────────────────────────────────────────────────────── */

.games-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; }

.game-card { background: white; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.game-thumb { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 36px; background: #f8fafc; }
.game-info  { padding: 10px 12px; }
.game-name  { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.game-date  { font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
.game-link  { font-size: 12px; color: #6366f1; text-decoration: none; font-weight: 500; }
.game-link:hover { text-decoration: underline; }

/* ── Settings ────────────────────────────────────────────────────────────── */

.settings-group { background: white; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 16px; overflow: hidden; }

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 18px;
  border-bottom: 1px solid #f8fafc;
}
.settings-row:last-child { border-bottom: none; }
.settings-label { font-size: 13px; font-weight: 500; }
.settings-value { font-size: 12px; color: #64748b; font-family: ui-monospace, monospace; margin-right: 12px; }
.settings-value.readonly { color: #94a3b8; }

.inline-edit { display: none; align-items: center; gap: 8px; }
.inline-edit.visible { display: flex; }
.inline-edit input {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 13px;
  width: 220px;
}

/* ── Setup Wizard ────────────────────────────────────────────────────────── */

.wizard-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
  padding: 24px;
}

.wizard-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 40px;
  max-width: 520px;
  width: 100%;
}

.wizard-logo { font-size: 36px; margin-bottom: 16px; }
.wizard-card h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
.wizard-card .subtitle { font-size: 14px; color: #64748b; margin-bottom: 28px; line-height: 1.5; }

.step { display: none; }
.step.active { display: block; }

.step-indicator {
  display: flex;
  gap: 6px;
  margin-bottom: 28px;
}
.step-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #e2e8f0;
  transition: background 0.2s;
}
.step-dot.done { background: #6366f1; }
.step-dot.active { background: #6366f1; box-shadow: 0 0 0 3px #e0e7ff; }

.wizard-field { margin-bottom: 18px; }
.wizard-field label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
.wizard-field input {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}
.wizard-field input:focus { border-color: #6366f1; }
.wizard-field .hint { font-size: 12px; color: #94a3b8; margin-top: 5px; }
.wizard-field .hint a { color: #6366f1; }

.check-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 16px;
}
.check-badge.ok   { background: #dcfce7; color: #16a34a; }
.check-badge.fail { background: #fee2e2; color: #dc2626; }
.check-badge.wait { background: #f1f5f9; color: #64748b; }

.error-msg { color: #dc2626; font-size: 13px; margin-top: 8px; min-height: 20px; }

.wizard-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }

.instructions ol { padding-left: 20px; line-height: 2; font-size: 14px; color: #334155; }
.instructions a  { color: #6366f1; }
.instructions code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 13px; }

.polling-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 13px;
  color: #64748b;
}
.spinner {
  width: 16px; height: 16px;
  border: 2px solid #e2e8f0;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Sections (dashboard) */
.section { display: none; }
.section.visible { display: block; }
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/style.css
git commit -m "feat(dashboard): add shared stylesheet"
```

---

## Task 6: Setup Wizard

**Files:**
- Create: `dashboard/setup.html`

- [ ] **Step 1: Create `dashboard/setup.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playground Setup</title>
  <link rel="stylesheet" href="/parent/style.css">
</head>
<body>
<div class="wizard-shell">
  <div class="wizard-card">
    <div class="wizard-logo">🎮</div>
    <div class="step-indicator" id="dots"></div>

    <!-- Step 1: Welcome -->
    <div class="step active" id="step-1">
      <h1>Welcome to Playground!</h1>
      <p class="subtitle">Let's get your AI-powered game studio ready. This takes about 5 minutes. You'll need a Claude Code account and a Telegram account.</p>
      <div class="wizard-actions">
        <button class="btn btn-primary" onclick="goTo(2)">Get started →</button>
      </div>
    </div>

    <!-- Step 2: Claude Code check -->
    <div class="step" id="step-2">
      <h1>Claude Code</h1>
      <p class="subtitle">Playground uses Claude Code so you can build and fix games alongside your kid. Let's make sure it's ready.</p>
      <div id="claude-badge" class="check-badge wait">Checking...</div>
      <div id="claude-instructions" style="display:none" class="instructions">
        <p style="margin-bottom:12px;color:#334155;">Claude Code is not installed or authenticated. Please:</p>
        <ol>
          <li>Install Claude Code: <a href="https://claude.ai/code" target="_blank">claude.ai/code</a></li>
          <li>Run <code>claude login</code> in your Terminal</li>
        </ol>
      </div>
      <div class="wizard-actions" style="margin-top:16px">
        <button class="btn btn-ghost" onclick="checkClaude()">Check again</button>
        <button class="btn btn-primary" id="claude-next" disabled onclick="goTo(3)">Next →</button>
      </div>
    </div>

    <!-- Step 3: Anthropic API key -->
    <div class="step" id="step-3">
      <h1>Anthropic API Key</h1>
      <p class="subtitle">The guardian uses the Claude API to chat with your kid and build games. Paste your API key below.</p>
      <div class="wizard-field">
        <label>API Key</label>
        <input type="password" id="apikey-input" placeholder="sk-ant-api03-..." autocomplete="off">
        <div class="hint">Get yours at <a href="https://console.anthropic.com/keys" target="_blank">console.anthropic.com/keys</a></div>
      </div>
      <div class="error-msg" id="apikey-error"></div>
      <div class="wizard-actions">
        <button class="btn btn-ghost" onclick="goTo(2)">← Back</button>
        <button class="btn btn-primary" id="apikey-btn" onclick="validateApiKey()">Validate →</button>
      </div>
    </div>

    <!-- Step 4: Telegram bot token -->
    <div class="step" id="step-4">
      <h1>Telegram Bot</h1>
      <p class="subtitle">Your kid will chat with the guardian through a Telegram bot you create. It only takes 2 minutes.</p>
      <div class="instructions" style="margin-bottom:20px">
        <ol>
          <li>Open Telegram and search for <a href="https://t.me/BotFather" target="_blank">@BotFather</a></li>
          <li>Send <code>/newbot</code> and follow the prompts</li>
          <li>Copy the token BotFather gives you (looks like <code>1234567890:AAH...</code>)</li>
        </ol>
      </div>
      <div class="wizard-field">
        <label>Bot Token</label>
        <input type="password" id="bottoken-input" placeholder="1234567890:AAH..." autocomplete="off">
      </div>
      <div class="error-msg" id="bottoken-error"></div>
      <div class="wizard-actions">
        <button class="btn btn-ghost" onclick="goTo(3)">← Back</button>
        <button class="btn btn-primary" onclick="validateBotToken()">Validate →</button>
      </div>
    </div>

    <!-- Step 5: Kid's Telegram ID -->
    <div class="step" id="step-5">
      <h1>Kid's Telegram</h1>
      <p class="subtitle">Have your kid send any message to your new bot now. We'll detect their Telegram ID automatically.</p>
      <div class="polling-indicator" id="polling-indicator">
        <div class="spinner"></div>
        <span>Waiting for a message from your kid...</span>
      </div>
      <div id="kid-found" style="display:none">
        <div class="check-badge ok" id="kid-badge">✓ Found!</div>
        <p style="font-size:13px;color:#334155;margin-top:8px">Telegram ID: <strong id="kid-id-display"></strong> · Name: <strong id="kid-name-display"></strong></p>
      </div>
      <div class="error-msg" id="telegram-id-error"></div>
      <div class="wizard-actions">
        <button class="btn btn-ghost" onclick="goTo(4)">← Back</button>
        <button class="btn btn-primary" id="kid-next" disabled onclick="goTo(6)">Next →</button>
      </div>
    </div>

    <!-- Step 6: Kid's name -->
    <div class="step" id="step-6">
      <h1>What's your kid's name?</h1>
      <p class="subtitle">The guardian will use this name when chatting with your kid.</p>
      <div class="wizard-field">
        <label>Name</label>
        <input type="text" id="sonname-input" placeholder="e.g. Clive" autocomplete="given-name">
      </div>
      <div class="error-msg" id="sonname-error"></div>
      <div class="wizard-actions">
        <button class="btn btn-ghost" onclick="goTo(5)">← Back</button>
        <button class="btn btn-primary" onclick="saveName()">Next →</button>
      </div>
    </div>

    <!-- Step 7: Done -->
    <div class="step" id="step-7">
      <h1>All set! 🎉</h1>
      <p class="subtitle">The guardian is starting up. Your kid can now chat with it on Telegram. Open the game lobby URL on their tablet to play games.</p>
      <div class="card" style="margin-bottom:20px">
        <div class="stat-label">Game Lobby URL (share with kid's tablet)</div>
        <div id="lobby-url" style="font-size:15px;font-weight:600;color:#6366f1;margin-top:6px;font-family:ui-monospace,monospace"></div>
      </div>
      <div class="wizard-actions">
        <button class="btn btn-primary" onclick="window.location.href='/parent'">Go to Dashboard →</button>
      </div>
    </div>
  </div>
</div>

<script>
let currentStep = 1;
const TOTAL_STEPS = 7;
let detectedKidId = null;
let pollTimer = null;

function renderDots() {
  const container = document.getElementById('dots');
  container.innerHTML = '';
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const dot = document.createElement('div');
    dot.className = 'step-dot' + (i < currentStep ? ' done' : i === currentStep ? ' active' : '');
    container.appendChild(dot);
  }
}

function goTo(n) {
  document.getElementById('step-' + currentStep).classList.remove('active');
  currentStep = n;
  document.getElementById('step-' + currentStep).classList.add('active');
  renderDots();
  if (n === 2) checkClaude();
  if (n === 5) startPollingTelegramId();
  if (n === 7) startGuardian();
}

async function checkClaude() {
  const badge = document.getElementById('claude-badge');
  const instructions = document.getElementById('claude-instructions');
  const nextBtn = document.getElementById('claude-next');
  badge.className = 'check-badge wait';
  badge.textContent = 'Checking...';
  instructions.style.display = 'none';
  nextBtn.disabled = true;

  const res = await fetch('/api/setup/check-claude').then(r => r.json()).catch(() => ({ installed: false }));
  if (res.installed && res.authenticated) {
    badge.className = 'check-badge ok';
    badge.textContent = '✓ Claude Code is ready';
    nextBtn.disabled = false;
  } else {
    badge.className = 'check-badge fail';
    badge.textContent = res.installed ? '✗ Claude Code is not authenticated' : '✗ Claude Code is not installed';
    instructions.style.display = 'block';
  }
}

async function validateApiKey() {
  const key = document.getElementById('apikey-input').value.trim();
  const btn = document.getElementById('apikey-btn');
  const err = document.getElementById('apikey-error');
  if (!key) { err.textContent = 'Please enter your API key.'; return; }
  btn.disabled = true;
  btn.textContent = 'Validating...';
  err.textContent = '';

  const res = await fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ANTHROPIC_API_KEY: key }),
  }).then(r => r.json()).catch(() => ({ error: 'Network error' }));

  btn.disabled = false;
  btn.textContent = 'Validate →';
  if (res.ok) { goTo(4); }
  else { err.textContent = res.error || 'Validation failed.'; }
}

async function validateBotToken() {
  const token = document.getElementById('bottoken-input').value.trim();
  const err = document.getElementById('bottoken-error');
  if (!token) { err.textContent = 'Please enter the bot token.'; return; }
  err.textContent = '';

  const res = await fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ KID_BOT_TOKEN: token }),
  }).then(r => r.json()).catch(() => ({ error: 'Network error' }));

  if (res.ok) { goTo(5); }
  else { err.textContent = res.error || 'Validation failed.'; }
}

function startPollingTelegramId() {
  document.getElementById('kid-found').style.display = 'none';
  document.getElementById('polling-indicator').style.display = 'flex';
  document.getElementById('kid-next').disabled = true;
  detectedKidId = null;

  async function poll() {
    const res = await fetch('/api/setup/telegram-id').then(r => r.json()).catch(() => ({ found: false }));
    if (res.found) {
      detectedKidId = res.id;
      document.getElementById('polling-indicator').style.display = 'none';
      document.getElementById('kid-found').style.display = 'block';
      document.getElementById('kid-id-display').textContent = res.id;
      document.getElementById('kid-name-display').textContent = res.name;
      document.getElementById('kid-next').disabled = false;
      await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ SON_TELEGRAM_ID: String(res.id) }),
      });
    } else {
      pollTimer = setTimeout(poll, 3000);
    }
  }
  poll();
}

async function saveName() {
  const name = document.getElementById('sonname-input').value.trim();
  const err = document.getElementById('sonname-error');
  if (!name) { err.textContent = 'Please enter a name.'; return; }
  err.textContent = '';

  await fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ SON_NAME: name }),
  });
  goTo(7);
}

async function startGuardian() {
  await fetch('/api/guardian/start', { method: 'POST' });
  const status = await fetch('/api/status').then(r => r.json()).catch(() => ({}));
  document.getElementById('lobby-url').textContent = status.lanUrl || 'http://localhost:3000';
}

renderDots();
</script>
</body>
</html>
```

- [ ] **Step 2: Manual test**

With guardian running and `.env` missing or cleared:

```bash
cd /Users/ian/ai-workspace/playground
cp .env .env.bak   # save real .env
echo "" > .env     # clear it
bun run guardian &
sleep 1
open http://localhost:3000/parent
```

Verify: browser redirects to `/parent/setup` and shows Step 1 (Welcome). Navigate through steps using browser. Restore env when done:

```bash
kill %1 && mv .env.bak .env
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/setup.html
git commit -m "feat(dashboard): add multi-step setup wizard"
```

---

## Task 7: Dashboard SPA

**Files:**
- Create: `dashboard/index.html`

- [ ] **Step 1: Create `dashboard/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playground Dashboard</title>
  <link rel="stylesheet" href="/parent/style.css">
</head>
<body>
<div class="shell">
  <div class="sidebar">
    <div class="sidebar-logo">🎮 Playground</div>
    <div class="nav-item active" data-section="status" onclick="showSection('status', this)">
      <span class="nav-icon">●</span> Status
    </div>
    <div class="nav-item" data-section="chats" onclick="showSection('chats', this)">
      <span class="nav-icon">💬</span> Chats
    </div>
    <div class="nav-item" data-section="games" onclick="showSection('games', this)">
      <span class="nav-icon">🎯</span> Games
    </div>
    <div class="nav-item" data-section="settings" onclick="showSection('settings', this)">
      <span class="nav-icon">⚙️</span> Settings
    </div>
    <div class="sidebar-bottom">
      <div class="status-dot" id="sidebar-dot"></div>
      <span id="sidebar-status">Loading...</span>
    </div>
  </div>

  <div class="main">
    <div class="topbar">
      <h1 id="section-title">Status</h1>
      <button class="btn btn-primary" id="claude-btn" onclick="openClaude()" style="display:none">
        ⚡ Open in Claude Code
      </button>
    </div>

    <div class="content">

      <!-- STATUS -->
      <div class="section visible" id="section-status">
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">Guardian</div>
            <div class="stat-value" id="stat-guardian">—</div>
            <div class="stat-sub" id="stat-uptime"></div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Messages today</div>
            <div class="stat-value" id="stat-msgs">—</div>
            <div class="stat-sub" id="stat-flagged"></div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Games built</div>
            <div class="stat-value" id="stat-games">—</div>
            <div class="stat-sub" id="stat-lastgame"></div>
          </div>
        </div>

        <div class="control-card">
          <div class="control-info">
            <h3>Telegram Bot</h3>
            <p id="bot-info">Loading...</p>
          </div>
          <button class="btn" id="toggle-btn" onclick="toggleGuardian()">...</button>
        </div>

        <div class="control-card">
          <div class="control-info">
            <h3>Game Server</h3>
            <p id="server-url">Loading...</p>
          </div>
          <button class="btn btn-ghost" onclick="copyServerUrl()">Copy URL</button>
        </div>
      </div>

      <!-- CHATS -->
      <div class="section" id="section-chats">
        <div class="chat-list" id="chat-list">
          <p style="color:#94a3b8;font-size:13px">Loading conversations...</p>
        </div>
      </div>

      <!-- GAMES -->
      <div class="section" id="section-games">
        <div class="games-grid" id="games-grid">
          <p style="color:#94a3b8;font-size:13px">Loading games...</p>
        </div>
      </div>

      <!-- SETTINGS -->
      <div class="section" id="section-settings">
        <div class="settings-group">
          <div class="settings-row">
            <span class="settings-label">Kid's name</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="settings-value" id="cfg-sonName">—</span>
              <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="editField('SON_NAME','cfg-sonName')">Edit</button>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label">Kid's Telegram ID</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="settings-value" id="cfg-sonTelegramId">—</span>
              <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="editField('SON_TELEGRAM_ID','cfg-sonTelegramId')">Edit</button>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-row">
            <span class="settings-label">Anthropic API key</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="settings-value" id="cfg-anthropicApiKey">—</span>
              <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="editSecret('ANTHROPIC_API_KEY','cfg-anthropicApiKey')">Edit</button>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label">Telegram bot token</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="settings-value" id="cfg-kidBotToken">—</span>
              <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="editSecret('KID_BOT_TOKEN','cfg-kidBotToken')">Edit</button>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <div class="settings-row">
            <span class="settings-label">Playground directory</span>
            <span class="settings-value readonly" id="cfg-playgroundDir">—</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">Game server port</span>
            <span class="settings-value" id="cfg-port">—</span>
          </div>
        </div>
        <div style="margin-top:20px">
          <button class="btn btn-primary" onclick="openClaude()">⚡ Open in Claude Code</button>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
const SECTIONS = ['status', 'chats', 'games', 'settings'];
const TITLES   = { status:'Status', chats:'Conversations', games:'Games', settings:'Settings' };

let _lanUrl = '';
let _guardianStatus = 'stopped';

function showSection(name, el) {
  SECTIONS.forEach(s => {
    document.getElementById('section-' + s).classList.toggle('visible', s === name);
  });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('section-title').textContent = TITLES[name];
  document.getElementById('claude-btn').style.display = (name === 'status') ? 'inline-flex' : 'none';
  if (name === 'chats') loadChats();
  if (name === 'games') loadGames();
  if (name === 'settings') loadSettings();
}

// ── Status polling ────────────────────────────────────────────────────────

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function refreshStatus() {
  const data = await fetch('/api/status').then(r => r.json()).catch(() => null);
  if (!data) return;
  _guardianStatus = data.status;
  _lanUrl = data.lanUrl || '';

  const dot = document.getElementById('sidebar-dot');
  dot.className = 'status-dot ' + data.status;
  document.getElementById('sidebar-status').textContent =
    data.status === 'running' ? 'Guardian running' :
    data.status === 'error'   ? 'Guardian error'   : 'Guardian stopped';

  document.getElementById('stat-guardian').textContent = data.status === 'running' ? 'Running' : data.status === 'error' ? 'Error' : 'Stopped';
  document.getElementById('stat-guardian').style.color = data.status === 'running' ? '#16a34a' : data.status === 'error' ? '#dc2626' : '#64748b';
  document.getElementById('stat-uptime').textContent = data.status === 'running' && data.uptime ? `Started ${formatUptime(data.uptime)} ago` : '';
  document.getElementById('stat-msgs').textContent = data.messagesToday ?? 0;
  document.getElementById('stat-flagged').textContent = data.flaggedToday ? `${data.flaggedToday} flagged` : 'None flagged';
  document.getElementById('stat-games').textContent = data.gamesBuilt ?? 0;
  document.getElementById('stat-lastgame').textContent = data.lastGame ? `Last: ${data.lastGame}` : '';

  document.getElementById('bot-info').textContent =
    `${data.sonName || '—'} (ID ${data.sonTelegramId || '—'})`;

  const toggleBtn = document.getElementById('toggle-btn');
  if (data.status === 'running') {
    toggleBtn.textContent = 'Stop Guardian';
    toggleBtn.className = 'btn btn-danger';
  } else {
    toggleBtn.textContent = 'Start Guardian';
    toggleBtn.className = 'btn btn-success';
  }

  document.getElementById('server-url').textContent = data.lanUrl || 'localhost:3000';
}

async function toggleGuardian() {
  const endpoint = _guardianStatus === 'running' ? '/api/guardian/stop' : '/api/guardian/start';
  await fetch(endpoint, { method: 'POST' });
  await refreshStatus();
}

function copyServerUrl() {
  navigator.clipboard.writeText(_lanUrl).then(() => {
    const btn = event.target;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy URL', 1500);
  });
}

// ── Chats ─────────────────────────────────────────────────────────────────

function timeAgo(isoStr) {
  const d = new Date(isoStr);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString();
}

async function loadChats() {
  const turns = await fetch('/api/conversations').then(r => r.json()).catch(() => []);
  const list = document.getElementById('chat-list');
  if (!turns.length) { list.innerHTML = '<p style="color:#94a3b8;font-size:13px">No conversations yet.</p>'; return; }

  list.innerHTML = turns.map(t => `
    <div class="chat-msg ${t.flagged ? 'flagged' : ''}">
      <div class="chat-meta">
        <span class="chat-sender ${t.direction === 'guardian' ? 'guardian' : ''}">
          ${t.direction === 'kid' ? '👦 Kid' : '🤖 Guardian'}
          ${t.flagged ? '<span class="flag-badge">⚠ flagged</span>' : ''}
        </span>
        <span class="chat-time">${timeAgo(t.ts)}</span>
      </div>
      <div class="chat-text">${escHtml(t.message)}</div>
    </div>
  `).join('');
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Games ─────────────────────────────────────────────────────────────────

const GAME_EMOJIS = {
  'catch': '⭐', 'star': '⭐', 'space': '🚀', 'shoot': '🚀', 'alien': '👾',
  'fruit': '🍉', 'ninja': '🥷', 'color': '🎨', 'fish': '🐟', 'balloon': '🎈',
  'cookie': '🍪', 'whack': '🐹', 'mole': '🐹', 'maze': '🌀', 'memory': '🧠',
  'slide': '🧩', 'snow': '❄️', 'turtle': '🐢', 'race': '🏁', 'uno': '🃏',
};

function gameEmoji(name) {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(GAME_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return '🎮';
}

async function loadGames() {
  const games = await fetch('/api/games').then(r => r.json()).catch(() => []);
  const grid = document.getElementById('games-grid');
  if (!games.length) { grid.innerHTML = '<p style="color:#94a3b8;font-size:13px">No games built yet.</p>'; return; }

  grid.innerHTML = [...games].reverse().map(g => `
    <div class="game-card">
      <div class="game-thumb">${gameEmoji(g.name)}</div>
      <div class="game-info">
        <div class="game-name">${escHtml(g.name)}</div>
        <div class="game-date">${new Date(g.builtAt).toLocaleDateString()}</div>
        <a class="game-link" href="/games/${g.slug}/" target="_blank">▶ Play</a>
      </div>
    </div>
  `).join('');
}

// ── Settings ──────────────────────────────────────────────────────────────

async function loadSettings() {
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  document.getElementById('cfg-sonName').textContent = cfg.sonName || '—';
  document.getElementById('cfg-sonTelegramId').textContent = cfg.sonTelegramId || '—';
  document.getElementById('cfg-anthropicApiKey').textContent = cfg.anthropicApiKey || '—';
  document.getElementById('cfg-kidBotToken').textContent = cfg.kidBotToken || '—';
  document.getElementById('cfg-playgroundDir').textContent = cfg.playgroundDir || '—';
  document.getElementById('cfg-port').textContent = cfg.port || '—';
}

async function editField(envKey, displayId) {
  const display = document.getElementById(displayId);
  const current = display.textContent;
  const val = prompt(`New value for ${envKey}:`, current === '—' ? '' : current);
  if (!val) return;
  await fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [envKey]: val }),
  });
  display.textContent = val;
}

async function editSecret(envKey, displayId) {
  const val = prompt(`New value for ${envKey} (will be validated):`);
  if (!val) return;
  const res = await fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [envKey]: val }),
  }).then(r => r.json());
  if (res.ok) {
    document.getElementById(displayId).textContent = `${val.slice(0,8)}••••`;
  } else {
    alert('Error: ' + (res.error || 'Validation failed'));
  }
}

async function openClaude() {
  await fetch('/api/open-claude', { method: 'POST' });
}

// ── Init ──────────────────────────────────────────────────────────────────

refreshStatus();
setInterval(refreshStatus, 5000);
</script>
</body>
</html>
```

- [ ] **Step 2: Manual test — all four sections**

With guardian running and a complete `.env`:

```bash
open http://localhost:3000/parent
```

Verify:
- Status section loads: guardian state, message count, LAN URL show correctly
- "Open in Claude Code" button appears in topbar
- Chats section loads conversation history from SQLite
- Games section shows game cards from manifest.json
- Settings section shows masked credentials
- Sidebar status dot is green when guardian is running
- Polling: after 5 seconds, stat counts update

- [ ] **Step 3: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): add parent SPA with status, chats, games, settings"
```

---

## Task 8: Distribution Guide

**Files:**
- Create: `SETUP.md`

- [ ] **Step 1: Create `SETUP.md`**

```markdown
# Playground Setup Guide

A shared AI game studio for parents and kids. Parents build games with Claude Code; kids request games and play them via Telegram.

## Prerequisites

- macOS (tested on macOS 14+)
- [Bun](https://bun.sh) runtime
- [Claude Code](https://claude.ai/code) installed and authenticated (`claude login`)
- An [Anthropic API key](https://console.anthropic.com/keys)
- A Telegram account

## Install

```bash
git clone https://github.com/ianlin0126/playground.git
cd playground
bun install
bun run guardian
```

Open **http://localhost:3000/parent** in your browser. The setup wizard will guide you through the rest (~5 minutes).

## What the Wizard Does

1. Verifies Claude Code is installed and authenticated
2. Validates your Anthropic API key (used by the guardian to chat with your kid and build games)
3. Walks you through creating a Telegram bot via @BotFather
4. Detects your kid's Telegram ID automatically (they send one message to the bot)
5. Saves everything to a local `.env` file and starts the guardian

## Day-to-Day

- **Kid:** Opens Telegram, chats with the bot, asks for games
- **Parent:** Opens http://localhost:3000/parent to monitor chats and manage games
- **Parent (building):** Click "Open in Claude Code" from the dashboard to start a coding session in the playground directory

The game server at `http://<your-lan-ip>:3000` is accessible from any device on your home network (great for a tablet on the same WiFi).

## Stopping and Starting

The guardian runs as long as the terminal window is open. To stop:

```bash
# Ctrl+C in the terminal running bun run guardian
```

To start again:

```bash
bun run guardian
```

## Configuration

All settings live in `.env` (gitignored). You can also edit them from the Settings section of the dashboard.

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `KID_BOT_TOKEN` | Telegram bot token from @BotFather |
| `SON_NAME` | Your kid's name (used by the guardian) |
| `SON_TELEGRAM_ID` | Your kid's Telegram user ID |
```

- [ ] **Step 2: Commit**

```bash
git add SETUP.md
git commit -m "docs: add SETUP.md for other parents"
```

---

## Self-Review Notes

- **Spec coverage:** All 10 API routes from the spec are implemented in `api.ts`. `/api/setup/check-claude` was added (not in spec table but required by wizard Step 2). Setup wizard covers all 7 steps. Dashboard covers all 4 sections. `SETUP.md` covers distribution.
- **Type consistency:** `TelegramState`, `start()`, `stop()` defined in Task 2 and referenced correctly in Task 3's `handleApiRequest`. `readEnvFile`, `writeEnvAll`, `getMissingFields`, `applyEnvToConfig` defined in Task 1 and imported in Tasks 3 and 4.
- **No placeholders:** All code blocks are complete. All test commands include expected output.
- **db.ts note:** `getRecentTurns(limit)` already exists in the current `guardian/db.ts` — no changes needed to that file.
