# Playground — AI Game Studio for Kids

A shared game studio for parents and kids. The parent runs a local server that connects to a Telegram bot. The kid chats with the bot and asks for games; Claude builds them as self-contained HTML pages served on your home WiFi so the kid can play on a tablet. The parent monitors conversations and manages games from a local dashboard.

**How it works:** Kid sends a Telegram message → Guardian (Bun server) receives it → Claude Code builds the game → Guardian sends the game URL back to the kid's tablet.

## Prerequisites

- macOS (tested on macOS 14+)
- [Git](https://git-scm.com) (required by `bun create`; pre-installed on macOS via Xcode Command Line Tools)
- [Bun](https://bun.sh) runtime — `curl -fsSL https://bun.sh/install | bash`
- [Claude Code](https://claude.ai/code) installed and authenticated — `npm install -g @anthropic/claude-code && claude login`
- An [Anthropic API key](https://console.anthropic.com/keys)
- A Telegram account

## Install

```bash
bun create github:ianlin0126/playground my-playground
cd my-playground
bun install
bun run server
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
- **Parent (building):** Open Claude Code in the playground directory — it automatically watches for game build requests from the kid

The game server at `http://<your-lan-ip>:3000` is accessible from any device on your home network (great for a tablet on the same WiFi).

## Stopping and Starting

The server runs as long as the terminal window is open. To stop:

```bash
# Ctrl+C in the terminal running bun run server
```

To start again:

```bash
bun run server
```

The Telegram bot (guardian) starts automatically on launch if the config is complete. You can also stop and restart it independently from the dashboard's Status page without touching the server process.

## Configuration

All settings live in `.env` (gitignored). You can also edit them from the Settings section of the dashboard.

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `KID_BOT_TOKEN` | Telegram bot token from @BotFather |
| `SON_NAME` | Your kid's name (used by the guardian) |
| `SON_TELEGRAM_ID` | Your kid's Telegram user ID |
