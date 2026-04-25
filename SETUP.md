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
