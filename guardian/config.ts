import { networkInterfaces } from "os";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const REQUIRED_KEYS = ["KID_BOT_TOKEN", "ANTHROPIC_API_KEY", "KID_NAME", "KID_TELEGRAM_ID"] as const;

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

export function parsePort(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : 3000;
}

function detectLanIp(): string {
  const nets = networkInterfaces();
  const candidates: string[] = [];
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) candidates.push(addr.address);
    }
  }
  // Prefer typical home LAN ranges (192.168.0.x or 192.168.1.x) over VPN/VM ranges
  const homeLan = candidates.find(ip => /^192\.168\.(0|1)\./.test(ip));
  return homeLan ?? candidates[0] ?? "localhost";
}

export const config = {
  kidBotToken: loadEnv("KID_BOT_TOKEN"),
  anthropicApiKey: loadEnv("ANTHROPIC_API_KEY"),
  openaiApiKey: loadEnv("OPENAI_API_KEY"),
  kidName: loadEnv("KID_NAME"),
  kidTelegramId: Number(loadEnv("KID_TELEGRAM_ID")) || 0,
  githubToken: loadEnv("GITHUB_TOKEN"),
  githubRepo: loadEnv("GITHUB_REPO"),
  port: parsePort(loadEnv("PORT")),
  lanIp: detectLanIp(),
  playgroundDir: new URL("..", import.meta.url).pathname.replace(/\/$/, ""),
};

export function applyEnvToConfig(fields: Record<string, string>): void {
  if (fields.KID_BOT_TOKEN !== undefined) config.kidBotToken = fields.KID_BOT_TOKEN;
  if (fields.ANTHROPIC_API_KEY !== undefined) config.anthropicApiKey = fields.ANTHROPIC_API_KEY;
  if (fields.OPENAI_API_KEY !== undefined) config.openaiApiKey = fields.OPENAI_API_KEY;
  if (fields.KID_NAME !== undefined) config.kidName = fields.KID_NAME;
  if (fields.KID_TELEGRAM_ID !== undefined) config.kidTelegramId = Number(fields.KID_TELEGRAM_ID) || 0;
  if (fields.GITHUB_TOKEN !== undefined) config.githubToken = fields.GITHUB_TOKEN;
  if (fields.GITHUB_REPO !== undefined) config.githubRepo = fields.GITHUB_REPO;
}
