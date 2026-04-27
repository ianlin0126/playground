# Playground — AI Game Studio for Kids

A home game studio run by parents and kids together. Your kid chats with a Telegram bot to request games; Claude builds them as self-contained web pages served on your home WiFi so the kid can play on a tablet. You monitor conversations and manage games from a local dashboard.

**How it works:**

```
Kid (Telegram) → Guardian server → Claude Code (on your Mac) → Game URL sent back to kid's tablet
```

---

## What You Need

| Requirement | Install |
|---|---|
| macOS 14+ | — |
| Git | Pre-installed on macOS (`xcode-select --install` if missing) |
| [Bun](https://bun.sh) | `curl -fsSL https://bun.sh/install | bash` |
| [Claude Code](https://claude.ai/code) | `npm install -g @anthropic/claude-code` then `claude login` |
| [Anthropic API key](https://console.anthropic.com/keys) | Create one at console.anthropic.com |
| Telegram account | For both parent and kid |

> Claude Code requires Node.js to install. If `npm` isn't available, install Node.js first from [nodejs.org](https://nodejs.org).

---

## Setup (one time, ~10 minutes)

### Step 1 — Install

```bash
bun create github:ianlin0126/playground my-playground
cd my-playground
bun install
bun run server
```

### Step 2 — Run the setup wizard

Open **http://localhost:3000/parent** in your browser. The wizard walks you through:

1. Verifying Claude Code is installed and authenticated
2. Entering your Anthropic API key
3. Creating a Telegram bot via [@BotFather](https://t.me/BotFather) (takes ~2 minutes)
4. Getting your kid's Telegram ID — they send one message to the bot and it's detected automatically
5. Saving everything to `.env` and starting the guardian

### Step 3 — Open Claude Code in the project directory

Games are built by Claude Code, not the server. Open a terminal in `my-playground/` and run:

```bash
claude
```

Keep this session open whenever your kid might be requesting games. When a build request comes in, Claude Code picks it up automatically in the background.

> **This is the most important step to not miss.** If Claude Code isn't running, the server queues the request and tells your kid to ask a grown-up to open Claude Code. Once you open it, the build starts immediately.

---

## Day-to-Day

**Your kid:** Opens Telegram, chats with the bot, asks for a game. Gets a link back when it's ready.

**You:** Keep two things running on your Mac:
- `bun run server` in one terminal (the guardian — handles Telegram and serves games)
- `claude` in another terminal opened in the project directory (builds games when requested)

**Parent dashboard:** http://localhost:3000/parent — monitor conversations, see built games, manage settings.

**Playing on a tablet:** Games are served at `http://<your-mac-ip>:3000` — accessible from any device on the same WiFi. The dashboard shows your exact LAN URL.

---

## Stopping and Starting

```bash
# Stop: Ctrl+C in the bun run server terminal

# Start again:
bun run server

# Then open Claude Code in the project directory:
claude
```

The Telegram bot resumes automatically when the server starts, as long as `.env` is configured.

---

## Configuration

All settings live in `.env` (gitignored). Edit them directly or via the Settings page on the dashboard.

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `KID_BOT_TOKEN` | Telegram bot token from @BotFather |
| `SON_NAME` | Your kid's first name |
| `SON_TELEGRAM_ID` | Your kid's numeric Telegram user ID |

---

## Troubleshooting

**Kid asks for a game but nothing happens**
→ Claude Code isn't running. Open a terminal in the project directory and run `claude`. The queued build will start within seconds.

**"Setup required" appears on every server start**
→ Your `.env` is missing or incomplete. Go to http://localhost:3000/parent and complete the wizard.

**Kid's tablet can't open the game URL**
→ Make sure the tablet is on the same WiFi network as your Mac. Check the LAN URL shown on the dashboard Status page.

**Telegram bot doesn't respond**
→ Check that `bun run server` is running and the Status page shows the guardian as active. Restart it from the dashboard if needed.
