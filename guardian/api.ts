import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { config, writeEnvAll, getMissingFields, applyEnvToConfig } from "./config";
import { state as telegramState, start as startTelegram, stop as stopTelegram } from "./telegram";
import { getRecentTurns } from "./db";
import {
  getGuardianSystemPrompt,
  getDefaultGuardianSystemPrompt,
  isUsingCustomPrompt,
  setCustomPrompt,
} from "./prompts";

// ── Helpers ───────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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
    botId: config.kidBotToken ? config.kidBotToken.split(":")[0] : null,
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
  let botUsername = "";
  if (body.KID_BOT_TOKEN) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${body.KID_BOT_TOKEN}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json() as { ok: boolean; result?: { username: string } };
      if (!data.ok) return json({ error: "Invalid Telegram bot token" }, 400);
      botUsername = data.result?.username ?? "";
    } catch {
      return json({ error: "Could not reach Telegram API" }, 400);
    }
  }

  // Write to .env and update live config
  writeEnvAll(config.playgroundDir, body);
  applyEnvToConfig(body);

  return json({ ok: true, botUsername: botUsername || null });
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
  const whichProc = Bun.spawn(["which", "claude"], { stdout: "pipe", stderr: "ignore" });
  await whichProc.exited;
  if (whichProc.exitCode !== 0) return json({ installed: false, authenticated: false });

  const authProc = Bun.spawn(["claude", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
  await authProc.exited;
  return json({ installed: true, authenticated: authProc.exitCode === 0 });
}

async function handleVerifyBotToken(): Promise<Response> {
  if (!config.kidBotToken) return json({ ok: false, error: "No bot token found in .env" });
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.kidBotToken}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as { ok: boolean; result?: { username: string } };
    if (!data.ok) return json({ ok: false, error: "Bot token is invalid" });
    return json({ ok: true, botUsername: data.result?.username ?? "" });
  } catch {
    return json({ ok: false, error: "Could not reach Telegram API" });
  }
}

async function handleVerifyApiKey(): Promise<Response> {
  if (!config.anthropicApiKey) return json({ ok: false, error: "No API key found in .env" });
  try {
    const sdk = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
    await sdk.models.list();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "API key is invalid or could not reach Anthropic" });
  }
}

async function handleClaudeSessions(): Promise<Response> {
  // Find all 'claude' PIDs via ps (lsof shows the binary version number, not "claude")
  const psAllProc = Bun.spawn(["ps", "-axo", "pid,comm"], { stdout: "pipe", stderr: "ignore" });
  const psAllRaw = await new Response(psAllProc.stdout).text();
  await psAllProc.exited;

  const claudePids = psAllRaw.split("\n")
    .map(l => l.trim())
    .filter(l => /\bclaude$/.test(l))
    .map(l => Number(l.split(/\s+/)[0]))
    .filter(n => !isNaN(n) && n > 0);

  if (!claudePids.length) return json({ sessions: [] });

  // Get start time and TTY for all claude processes in one ps call
  const psProc = Bun.spawn(
    ["ps", "-p", claudePids.join(","), "-o", "pid=,tty=,lstart="],
    { stdout: "pipe", stderr: "ignore" }
  );
  const psRaw = await new Response(psProc.stdout).text();
  await psProc.exited;

  const sessions: Array<{ pid: number; startedAt: string; tty: string }> = [];
  for (const line of psRaw.trim().split("\n").filter(Boolean)) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (m) {
      const ttyShort = m[2];
      sessions.push({
        pid: Number(m[1]),
        tty: ttyShort === "??" ? "" : `/dev/${ttyShort}`,
        startedAt: m[3].trim(),
      });
    }
  }

  return json({ sessions });
}

function handleDeleteGame(slug: string): Response {
  if (!slug || !/^[\w-]+$/.test(slug)) return json({ error: "Invalid slug" }, 400);
  const gamesDir = join(config.playgroundDir, "games");
  const gameDir = join(gamesDir, slug);
  if (!gameDir.startsWith(gamesDir + "/")) return json({ error: "Forbidden" }, 403);

  try { rmSync(gameDir, { recursive: true, force: true }); } catch {
    return json({ error: "Failed to delete game files" }, 500);
  }

  const manifestPath = join(gamesDir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{ slug: string }>;
      writeFileSync(manifestPath, JSON.stringify(manifest.filter(e => e.slug !== slug), null, 2));
    } catch { /* non-fatal */ }
  }

  return json({ ok: true });
}

function handlePromptGet(): Response {
  const customPromptPath = join(config.playgroundDir, ".guardian", "custom-prompt.txt");
  const template = isUsingCustomPrompt()
    ? (existsSync(customPromptPath) ? readFileSync(customPromptPath, "utf8") : null)
    : null;
  return json({
    rendered: getGuardianSystemPrompt(config.sonName),
    isCustom: isUsingCustomPrompt(),
    template,
    defaultRendered: getDefaultGuardianSystemPrompt(config.sonName),
  });
}

async function handlePromptPatch(req: Request): Promise<Response> {
  let body: { prompt?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return json({ error: "prompt is required" }, 400);
  }
  const text = body.prompt.trim();
  const customPromptPath = join(config.playgroundDir, ".guardian", "custom-prompt.txt");
  writeFileSync(customPromptPath, text, "utf8");
  setCustomPrompt(text);
  return json({ ok: true });
}

function handlePromptDelete(): Response {
  const customPromptPath = join(config.playgroundDir, ".guardian", "custom-prompt.txt");
  try { unlinkSync(customPromptPath); } catch {}
  setCustomPrompt(null);
  return json({ ok: true });
}

async function handleOpenClaude(): Promise<Response> {
  const dir = config.playgroundDir.replace(/'/g, "'\\''");
  Bun.spawn(["osascript", "-e",
    `tell application "Terminal" to do script "cd '${dir}' && claude"`,
  ]);
  return json({ ok: true });
}

async function handleOpenClaudeSession(req: Request): Promise<Response> {
  let body: { pid?: number };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.pid || typeof body.pid !== "number") return json({ error: "pid is required" }, 400);

  const pid = body.pid;

  // Resolve TTY for the process
  const psProc = Bun.spawn(["ps", "-p", String(pid), "-o", "tty="], { stdout: "pipe", stderr: "ignore" });
  const ttyShort = (await new Response(psProc.stdout).text()).trim();
  await psProc.exited;
  if (!ttyShort || ttyShort === "??") return json({ error: "Could not resolve TTY for PID" }, 400);
  const ttyFull = `/dev/${ttyShort}`;

  // Match by tty of tab — processes of tab returns names, not PIDs
  const script = `
tell application "Terminal"
  set winCount to count of windows
  repeat with wIdx from 1 to winCount
    set w to window wIdx
    set tabCount to count of tabs of w
    repeat with tIdx from 1 to tabCount
      set t to tab tIdx of w
      if (tty of t) = "${ttyFull}" then
        set selected of t to true
        set index of w to 1
        activate
        return
      end if
    end repeat
  end repeat
end tell`;
  Bun.spawn(["osascript", "-e", script]);
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
  if (path === "/api/claude-sessions" && method === "GET") return handleClaudeSessions();
  if (path === "/api/games" && method === "GET") return handleGames();
  if (path.startsWith("/api/games/") && method === "DELETE") return handleDeleteGame(path.slice("/api/games/".length));
  if (path === "/api/config" && method === "GET") return handleConfigGet();
  if (path === "/api/config" && method === "PATCH") return handleConfigPatch(req);
  if (path === "/api/setup/status" && method === "GET") return handleSetupStatus();
  if (path === "/api/setup/telegram-id" && method === "GET") return handleSetupTelegramId();
  if (path === "/api/setup/check-claude" && method === "GET") return handleCheckClaude();
  if (path === "/api/setup/verify-api-key" && method === "GET") return handleVerifyApiKey();
  if (path === "/api/setup/verify-bot-token" && method === "GET") return handleVerifyBotToken();
  if (path === "/api/open-claude" && method === "POST") return handleOpenClaude();
  if (path === "/api/open-claude-session" && method === "POST") return handleOpenClaudeSession(req);
  if (path === "/api/prompt" && method === "GET")    return handlePromptGet();
  if (path === "/api/prompt" && method === "PATCH")  return handlePromptPatch(req);
  if (path === "/api/prompt" && method === "DELETE") return handlePromptDelete();

  return new Response("Not found", { status: 404 });
}
