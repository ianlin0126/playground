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
