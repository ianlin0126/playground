import { resolve, sep, join } from "path";
import { existsSync } from "fs";
import { createInterface } from "readline";
import { config, getMissingFields, writeEnvAll, parsePort } from "./config";
import { initDb } from "./db";
import { start as startTelegram, recoverOrphanedJobs, resetZombieJobs } from "./telegram";
import { handleApiRequest } from "./api";
import { loadCustomPromptFromDisk } from "./prompts";

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

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function findPortHolders(port: number): Promise<Array<{ pid: number; info: string }>> {
  // -sTCP:LISTEN filters to listeners only — without it, lsof also reports
  // any process with an OPEN CONNECTION to the port (browser tabs, etc.),
  // which would be wrong to SIGTERM if the user picks [k].
  const lsof = Bun.spawn(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { stdout: "pipe", stderr: "ignore" });
  const pidText = await new Response(lsof.stdout).text();
  await lsof.exited;
  const pids = pidText.split("\n").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (!pids.length) return [];

  const ps = Bun.spawn(["ps", "-p", pids.join(","), "-o", "pid=,etime=,command="], { stdout: "pipe", stderr: "ignore" });
  const psText = await new Response(ps.stdout).text();
  await ps.exited;

  const byPid = new Map<number, string>();
  for (const line of psText.trim().split("\n").filter(Boolean)) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m) byPid.set(Number(m[1]), m[2].trim());
  }
  return pids.map((pid) => ({ pid, info: byPid.get(pid) ?? "(no ps info)" }));
}

async function handlePortInUse(port: number): Promise<"retry" | "exit"> {
  console.error(`\n❌ Port ${port} is already in use.\n`);
  const holders = await findPortHolders(port);
  if (holders.length) {
    console.error("   Process holding the port:");
    for (const h of holders) console.error(`     PID ${h.pid}  ${h.info}`);
    console.error("");
  }

  if (!process.stdin.isTTY) {
    console.error("Run `bun run server` in an interactive terminal to choose an action,");
    console.error("or set PORT=<another port> in .env and try again.\n");
    return "exit";
  }

  console.error("What would you like to do?");
  console.error(`  [k] Kill the process${holders.length > 1 ? "es" : ""} above and try again`);
  console.error("  [p] Use a different port (writes PORT=… to .env)");
  console.error("  [q] Quit (default)\n");

  const answer = (await ask("> ")).trim().toLowerCase();

  if (answer === "k") {
    if (!holders.length) {
      console.error("No PIDs to kill — quitting.");
      return "exit";
    }
    for (const { pid } of holders) {
      try {
        process.kill(pid, "SIGTERM");
        console.error(`   Sent SIGTERM to ${pid}`);
      } catch (e) {
        console.error(`   Failed to kill ${pid}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await Bun.sleep(500);
    return "retry";
  }

  if (answer === "p") {
    const newPortStr = (await ask("Enter a port number (e.g. 3001): ")).trim();
    const newPort = parsePort(newPortStr);
    if (String(newPort) !== newPortStr) {
      console.error(`Invalid port "${newPortStr}" — quitting.`);
      return "exit";
    }
    writeEnvAll(config.playgroundDir, { PORT: String(newPort) });
    config.port = newPort;
    console.error(`✅ Wrote PORT=${newPort} to .env. Trying again on port ${newPort}...`);
    return "retry";
  }

  return "exit";
}

async function main(): Promise<void> {
  initDb(config.playgroundDir);
  loadCustomPromptFromDisk(config.playgroundDir);

  let server: ReturnType<typeof Bun.serve> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      server = startServer();
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") throw err;
      const action = await handlePortInUse(config.port);
      if (action === "exit") process.exit(1);
    }
  }
  if (!server) {
    console.error("\nCould not bind to a port after 3 attempts. Exiting.");
    process.exit(1);
  }

  const missing = getMissingFields(config.playgroundDir);
  if (missing.length > 0) {
    console.log(`\n⚠️  Setup required. Open http://localhost:${config.port}/parent to get started.\n`);
  } else {
    console.log(`✅ Guardian started for ${config.kidName}`);
    console.log(`📱 Accepting messages from Telegram ID: ${config.kidTelegramId}`);
    resetZombieJobs().catch((err) => console.error("[guardian] resetZombieJobs failed:", err));
    recoverOrphanedJobs().catch((err) => console.error("[guardian] recoverOrphanedJobs failed:", err));
    startTelegram();
    setInterval(() => {
      recoverOrphanedJobs().catch((err) => console.error("[guardian] periodic recoverOrphanedJobs failed:", err));
    }, 5 * 60 * 1000);
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
