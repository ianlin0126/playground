# Kids Playground — Guardian Agent Design Spec

**Date:** 2026-04-18
**Status:** Approved

---

## Overview

A kid-friendly playground system for Ian's 7-year-old son. A Guardian Agent (single Bun/TypeScript process) handles conversation via a dedicated Telegram bot, builds HTML games via the Claude API, serves them on localhost, and sends playable URLs back to Telegram. Ian monitors and controls everything from his existing Claude Code session.

---

## Architecture

```
Son's Telegram ──► kid bot (separate from parent bot ianlin_claude_bot)
                         │
                guardian.ts  (single Bun process, port 3000)
                   ├── Telegram long-poller (kid bot token)
                   ├── Conversation manager (Claude API, stateful)
                   ├── Game builder (Claude API, writes HTML files)
                   ├── HTTP file server (Bun.serve, serves playground/)
                   └── Conversation log (SQLite)
                         │
             playground/games/<name>/index.html
                         │
         http://<mac-lan-ip>:3000/games/<name>/  ◄── son's tablet (same WiFi)

Ian (Claude Code session)
  └── reads SQLite for summaries, flags, session history
  └── can directly build games or edit guardian personality
```

**Two entry points:**
- `bun run guardian` — starts a kid session
- Ian's Claude Code session — parent controls, reads logs, builds directly

---

## Components

### 1. Guardian Agent Process (`guardian/guardian.ts`)

**Start command:** `bun run guardian` (from `playground/` root)

**Startup sequence:**
1. Detect Mac's LAN IP via `os.networkInterfaces()`
2. Start `Bun.serve` on port 3000 (auto-increment if busy), serving `playground/`
3. Open SQLite at `.guardian/conversations.db`
4. Begin Telegram long-poll loop (30s timeout) against kid bot token
5. Greet son by name with 4 starter game suggestions

**Access control:** Only responds to messages from `SON_TELEGRAM_ID`; silently ignores all others.

**Shutdown:** `Ctrl+C` → flush SQLite → close HTTP server → exit cleanly

---

### 2. Guardian Personality (`guardian/prompts.ts`)

System prompt characteristics:
- Warm, patient, enthusiastic — like a friendly older sibling
- Grade 1–2 vocabulary, short sentences, emoji encouraged
- Never correct spelling aloud; interpret all typos charitably
- Frustration detection: if message contains anger/distress signals (`"i hate"`, `"this is dumb"`, repeated short angry words), shift to comfort mode — validate feelings, offer to simplify or take a break
- **Never build a game until the kid explicitly confirms** (e.g. guardian asks "Should I make it now? 🎮" and kid says yes)

**Session greeting includes 4 starter ideas:**
- Catch the Stars ⭐
- Whack a Mole 🐹
- Color Mixer 🎨
- Race the Turtle 🐢

---

### 3. Game Builder (`guardian/builder.ts`)

**Build flow:**
1. Send "building" message: `"Ok let me make it!! Give me a sec... 🔨⭐"`
2. Call Claude API (non-streaming) with game-building system prompt
3. Write output to `games/<kebab-name>/index.html`
4. Update `games/manifest.json` — append `{name, slug, builtAt}` entry
5. Reply with URL: `"Here it is!! Open this on your tablet: http://<ip>:3000/games/<name>/ 🎉"`

**Game-building system prompt constraints:**
- Single self-contained `index.html`, vanilla HTML/CSS/JS, zero external dependencies
- Mobile-first, tap targets ≥ 44px, text ≥ 24px, bright colors
- Positive-only feedback language (no "Wrong", "Failed", "Game Over")
- No violence, no dark patterns, no external links, no data collection
- Must work on iOS Safari

**Iteration:** Kid says "make it faster" → guardian reads existing `index.html`, sends full file content + request to Claude API for a revised full file, overwrites, sends same URL

---

### 4. HTTP File Server

- `Bun.serve` on `0.0.0.0:3000` serving `playground/` statically
- Lobby: `http://<ip>:3000/` → Game Zone index page
- Games: `http://<ip>:3000/games/<name>/`
- IP re-detected on each startup

---

### 5. Conversation Log (`guardian/db.ts`)

SQLite at `.guardian/conversations.db`:

```sql
CREATE TABLE turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  direction TEXT NOT NULL,  -- 'kid' | 'guardian'
  message TEXT NOT NULL,
  flagged INTEGER DEFAULT 0
);
```

Flagging: sets `flagged=1` for distress signals, requests for personal info, or off-topic content.

---

### 6. Parent Controls (Ian's Claude Code session)

Queries SQLite directly — no separate process:
- `"summarize today's session"` → narrative summary
- `"show flagged messages"` → `flagged=1` rows
- `"build [game] for him"` → write game files directly
- `"update the guardian's personality"` → edit `guardian/prompts.ts`

---

## File Structure

```
playground/
  guardian/
    guardian.ts       ← main entry point
    prompts.ts        ← system prompts
    builder.ts        ← game file generation + manifest update
    db.ts             ← SQLite conversation log
    config.ts         ← env vars, LAN IP detection, port
  games/
    manifest.json     ← dynamic game list (index.html reads this)
    uno/              ← existing
  .guardian/
    conversations.db  ← SQLite (gitignored)
  .env                ← secrets (gitignored)
  .env.example        ← template
  index.html          ← Game Zone lobby (fetches manifest.json dynamically)
  package.json        ← "guardian" script: bun run guardian/guardian.ts
  CLAUDE.md           ← kid-safety rules
```

---

## Configuration

`.env` (gitignored):
```
KID_BOT_TOKEN=<from BotFather>
ANTHROPIC_API_KEY=<key>
SON_NAME=<name>
SON_TELEGRAM_ID=<numeric Telegram user ID>
```

`.env.example` (committed):
```
KID_BOT_TOKEN=
ANTHROPIC_API_KEY=
SON_NAME=
SON_TELEGRAM_ID=
```

---

## Prerequisites

- Create a new Telegram bot via BotFather → `KID_BOT_TOKEN`
- Son needs a Telegram account
- `SON_TELEGRAM_ID`: discovered by having son send first message; guardian logs unknown sender IDs to console

---

## Verification Checklist

1. `bun run guardian` starts; logs LAN IP and port
2. Son's account sends "hi" → guardian replies with game suggestions
3. Son confirms a game → guardian sends "building" message → file appears in `games/`
4. URL opens on tablet on same WiFi → game is playable
5. Son requests a change → same URL reflects update
6. `conversations.db` has logged turns
7. Flagged message (e.g. "i hate this") → `flagged=1` in DB
