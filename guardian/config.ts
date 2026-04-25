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
