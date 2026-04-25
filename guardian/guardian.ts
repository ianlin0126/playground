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

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
