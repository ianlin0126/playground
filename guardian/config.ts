import { networkInterfaces } from "os";

function loadEnv(key: string, required = true): string {
  const val = process.env[key];
  if (!val && required) {
    console.error(`Missing required env var: ${key}`);
    console.error("Copy .env.example to .env and fill in your values.");
    process.exit(1);
  }
  return val ?? "";
}

function detectLanIp(): string {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "localhost";
}

export const config = {
  kidBotToken: loadEnv("KID_BOT_TOKEN"),
  anthropicApiKey: loadEnv("ANTHROPIC_API_KEY"),
  sonName: loadEnv("SON_NAME"),
  sonTelegramId: Number(loadEnv("SON_TELEGRAM_ID")),
  port: 3000,
  lanIp: detectLanIp(),
  playgroundDir: new URL("..", import.meta.url).pathname.replace(/\/$/, ""),
};
