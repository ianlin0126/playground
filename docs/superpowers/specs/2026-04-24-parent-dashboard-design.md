# Parent Dashboard Design

**Date:** 2026-04-24  
**Status:** Approved  
**Goal:** Extend the existing Guardian Agent with a local web dashboard that lets other tech-savvy parents set up and manage the same AI playground environment — enabling parents and young kids to build games together with Claude.

---

## Overview

The parent dashboard is a local web UI served by the existing Bun guardian process at `http://localhost:3000/parent`. It covers two phases:

1. **First-run setup wizard** — guides the parent through configuring the guardian (API key, Telegram bot, kid profile, Claude Code check)
2. **Ongoing dashboard** — sidebar-nav interface for monitoring conversations, managing games, controlling the guardian, and launching Claude Code

No native app wrapper, no new framework, no new ports. The target audience is tech-savvy parents comfortable with Terminal and a browser.

---

## Architecture

### Refactored Guardian Process

`guardian.ts` is split into two independently controllable concerns:

**HTTP server (always running)**  
Serves:
- `GET /games/*` — game files (existing behavior)
- `GET /parent` — parent dashboard SPA
- `GET /parent/setup` — setup wizard (redirect target on first run)
- `GET /api/*` — JSON API for dashboard

The HTTP server never stops. It is always reachable at `localhost:3000`.

**Telegram loop (start/stop controlled)**  
Extracted into `guardian/telegram.ts`. Exports `start()`, `stop()`, and a `state` object (`{ status: 'running' | 'stopped' | 'error', startedAt: Date | null, error: string | null }`). The dashboard's Start/Stop button calls these functions via the API.

### Entry Point

`bun run guardian` remains the single command to run everything. No new top-level processes, no new ports.

---

## Setup Wizard (First Run)

**Detection:** On startup, the server checks for missing or incomplete `.env` fields. If any required field is absent, `GET /parent` redirects to `GET /parent/setup`.

### Steps

**Step 1 — Welcome**  
Brief explanation: "Let's get your AI playground ready." No user input required.

**Step 2 — Claude Code check**  
The API calls `which claude` and `claude --version`. If not found or not authenticated, the step shows: "Install Claude Code at claude.ai/code, then run `claude login` in your terminal." A "Check again" button re-runs detection. The parent cannot proceed until the check passes.

**Step 3 — Anthropic API key**  
Text input with a direct link to `console.anthropic.com/keys`. On submit, the API calls `anthropic.models.list()` to validate the key live. Shows a green checkmark or an inline error. Does not save until validated.

**Step 4 — Telegram bot token**  
Numbered instructions linking to `@BotFather` in Telegram. Parent creates a bot, copies the token, pastes it here. The API calls Telegram's `getMe` endpoint to validate live before saving.

**Step 5 — Kid's Telegram ID**  
Instructions tell the parent to have their child send any message to the new bot. A "Waiting for first message…" indicator polls `/api/setup/telegram-id` every 3 seconds. The server calls Telegram's `getUpdates` until a message arrives, then auto-fills the ID. Parent confirms.

**Step 6 — Kid's name**  
Simple text input.

**Step 7 — Done**  
Writes all values to `.env`. Starts the Telegram loop. Redirects to `/parent`. (Optional confetti.)

All wizard state is held in memory during the session. `.env` is only written on Step 7 success.

---

## Dashboard

### Layout

Sidebar navigation (fixed left, dark background) with four sections. Content area fills the right. A persistent guardian status badge sits at the bottom of the sidebar.

### Section: Status

Three stat cards at the top:
- Guardian status (Running / Stopped) with uptime
- Messages today + flagged count
- Games built + name of last game

Two control cards below:
- **Telegram Bot** — shows kid name, Telegram ID, bot username. "Stop Guardian" / "Start Guardian" button.
- **Game Server** — shows LAN URL (`http://<lan-ip>:3000`). "Copy URL" button for sharing with the kid's tablet.

An **"Open in Claude Code"** button appears in the top-right of this section. It calls `POST /api/open-claude`, which opens a new Terminal window running `claude` in the playground directory via AppleScript:
```
osascript -e 'tell application "Terminal" to do script "cd <playgroundDir> && claude"'
```

### Section: Conversations

Chronological feed of conversation turns read from SQLite. Flagged messages (`flagged=1`) are shown with a red border and `⚠ flagged` badge, sorted to appear first within their time window. Polls `/api/conversations` every 5 seconds.

### Section: Games

Grid view of all games from `games/manifest.json`. Each card shows: emoji thumbnail (derived from game name), game name, build date, and a "▶ Play" link to the game URL.

### Section: Settings

Grouped rows for each config value:
- Kid name, Kid Telegram ID
- Anthropic API key (masked), Telegram bot token (masked)
- Playground directory (read-only), Game server port

Each editable row has an "Edit" button that opens an inline input and calls `PATCH /api/config` on save. The API rewrites `.env` and reloads the affected config values in memory.

"Open in Claude Code" button also appears here.

---

## API Routes

All `/api/*` routes bind only to `127.0.0.1` — not accessible from the LAN.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/status` | Guardian state, uptime, message count, flagged count, last game, LAN URL |
| `POST` | `/api/guardian/start` | Start Telegram polling loop |
| `POST` | `/api/guardian/stop` | Stop Telegram polling loop |
| `GET` | `/api/conversations` | Recent turns from SQLite (newest first), with `flagged` field |
| `GET` | `/api/games` | Contents of `games/manifest.json` |
| `GET` | `/api/config` | Masked config values for Settings display |
| `PATCH` | `/api/config` | Write updated field(s) back to `.env` |
| `GET` | `/api/setup/status` | Returns which required `.env` fields are missing |
| `GET` | `/api/setup/telegram-id` | Polls Telegram `getUpdates` for first inbound message; returns sender ID when found |
| `POST` | `/api/open-claude` | Opens new Terminal window running `claude` in playground directory via `osascript` |

---

## File Changes

### Modified

| File | Change |
|------|--------|
| `guardian/guardian.ts` | Extract Telegram loop; add `/api/*` routing; serve `/parent` and `/parent/setup`; apply 127.0.0.1 binding to API routes |
| `guardian/config.ts` | Add `readEnv()` and `writeEnv(key, value)` helpers for `.env` patching |
| `guardian/db.ts` | Add `getRecentTurns(limit: number)` query |

### New

| File | Description |
|------|-------------|
| `guardian/telegram.ts` | Telegram polling loop extracted from guardian.ts; exports `start()`, `stop()`, `state` |
| `guardian/api.ts` | All `/api/*` route handlers |
| `dashboard/index.html` | Parent dashboard SPA — sidebar nav, four sections, 5-second polling |
| `dashboard/setup.html` | Setup wizard — multi-step first-run onboarding |
| `dashboard/style.css` | Shared styles for both dashboard pages |

### Unchanged

`guardian/builder.ts`, `guardian/prompts.ts`, `.guardian/jobs/` job queue, game serving, Telegram behavior, kid experience.

---

## Distribution

No installer or DMG. Other parents set up by:

1. Clone the repo
2. Install Bun (`curl -fsSL https://bun.sh/install | bash`)
3. `bun install`
4. `bun run guardian`
5. Open `http://localhost:3000/parent` — wizard starts automatically

A `SETUP.md` in the repo root documents these steps.

---

## Constraints & Non-Goals

- **One kid only** — single Telegram bot, single child profile. Multi-kid support is out of scope.
- **macOS only** — LAN IP detection, `open`-style Claude Code spawning, and path conventions target macOS. Cross-platform is not a goal.
- **No App Store, no DMG, no Electron** — plain Bun process, plain browser. 
- **No authentication on the dashboard** — it is local-only (`127.0.0.1`); the LAN serves only games.
- **No WebSockets** — 5-second polling is sufficient for the parent monitoring use case.
