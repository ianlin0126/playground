# CLAUDE.md

This file provides guidance for AI assistants (Claude and others) working with this repository.

## Repository Overview

**Repository:** `ianlin0126/playground`
**Purpose:** Kid-friendly applications and games targeted at children around 8 years old.
**Status:** Freshly initialized — no source files committed yet.

### Audience

- **Target age:** ~8 years old (early elementary school)
- **Tone:** Playful, encouraging, and forgiving — no frustrating failure states
- **Reading level:** Short sentences, simple words, large readable text
- **Interaction style:** Intuitive controls; minimize reliance on reading for core gameplay

> Update this section as the project takes shape: describe the chosen tech stack and architecture here.

---

## Guardian Agent

The Guardian Agent is a Bun/TypeScript process that lets your child interact with the playground via Telegram.

**Start:** `bun run server` (from the `playground/` root — `.env` optional; wizard runs if missing)

**What it does:**
- Listens to a dedicated kid Telegram bot (separate from the parent bot)
- Holds a kid-friendly conversation powered by Claude (`claude-sonnet-4-6`)
- Builds HTML games via the Claude API and writes them to `games/<slug>/index.html`
- Serves the entire `playground/` directory on `http://<lan-ip>:3000/`
- Sends the game URL back to Telegram so the kid can open it on a tablet (same WiFi)
- Logs all conversation turns to `.guardian/conversations.db` (SQLite, gitignored)

**Files:**
- `guardian/guardian.ts` — main entry point (HTTP server + Telegram poller + conversation loop)
- `guardian/config.ts` — env loading, LAN IP detection
- `guardian/db.ts` — SQLite conversation log
- `guardian/prompts.ts` — system prompts for guardian personality and game builder
- `guardian/builder.ts` — Claude API game generation + manifest update

**Configuration (`.env`, gitignored):**
```
KID_BOT_TOKEN=       # from BotFather
KID_NAME=            # kid's first name
KID_TELEGRAM_ID=     # kid's numeric Telegram user ID
ANTHROPIC_API_KEY=   # Anthropic API key
```

**Game lobby:** `games/manifest.json` lists all built games; `index.html` fetches it dynamically. Add new entries by having the guardian build a game, or manually append to the JSON.

**Parent monitoring:** The parent queries `.guardian/conversations.db` directly from their Claude Code session — `flagged=1` rows indicate messages that triggered alarm phrases.

---

## Development Workflow

### Branching Strategy

- Work on feature branches: `claude/<feature-name>` or `feature/<feature-name>`
- Never push directly to `main` without explicit permission
- Always use `git push -u origin <branch-name>` when pushing a new branch

### Commit Guidelines

- Write clear, descriptive commit messages focused on *why*, not just *what*
- Keep commits atomic — one logical change per commit
- Include the session URL as a footer in Claude-authored commits:
  ```
  https://claude.ai/code/session_<id>
  ```

### Git Operations

- Stage specific files by name — avoid `git add -A` or `git add .`
- Never skip hooks (`--no-verify`) unless the user explicitly requests it
- Never force-push to `main`/`master`
- Prefer creating new commits over amending existing ones

---

## Code Conventions

> Fill in this section once a language/framework is chosen. Examples to document:
> - Language version and toolchain
> - Formatting rules (indentation, line length, trailing commas)
> - Naming conventions (files, variables, functions, classes)
> - Import ordering
> - Error handling patterns
> - Logging conventions

---

## Project Structure

```
playground/
  guardian/          # Guardian Agent source (Bun/TypeScript)
  games/             # Built games; manifest.json lists all entries
  .guardian/         # Runtime data (SQLite db — gitignored)
  index.html         # Game Zone lobby (loads games from manifest.json)
  package.json       # "guardian" script: bun run guardian/guardian.ts
  .env.example       # Config template
  CLAUDE.md          # This file
```

---

## Build, Test, and Run Commands

> Add commands here as the project is set up. Common examples:
>
> ```bash
> # Install dependencies
> npm install          # Node.js
> pip install -r requirements.txt  # Python
>
> # Run the application
> npm start
> python main.py
>
> # Run tests
> npm test
> pytest
>
> # Lint / format
> npm run lint
> ruff check .
> ```

---

## Key Conventions for AI Assistants

### Before Making Changes

- Always read files before editing them
- Understand existing patterns before adding new ones
- Do not introduce new dependencies without discussing them first

### Scope Discipline

- Make only the changes requested — do not refactor surrounding code
- Do not add comments, docstrings, or type annotations to code you didn't change
- Do not add error handling, fallbacks, or validation for scenarios that cannot happen
- Do not create helpers or abstractions for one-time operations

### Security

- Never commit secrets, API keys, or credentials
- Validate input only at system boundaries (user input, external APIs)
- Avoid command injection, SQL injection, XSS, and other OWASP Top 10 vulnerabilities

### Risky Operations — Confirm Before Proceeding

- Deleting files or branches
- Force-pushing
- Modifying CI/CD pipelines
- Pushing to remote repositories
- Any action visible to others or that affects shared state

---

## Child Safety & Content Standards

All features, copy, and assets must be appropriate for children ~8 years old.

### Content Rules

- **No violence, gore, or frightening imagery** — even cartoon violence should be mild and consequence-free
- **No mature themes** — no romance, politics, religion, or adult humor
- **No dark patterns** — no manipulative mechanics, fake urgency, or pressure to spend money
- **No external links** — do not link to any external websites or services from within the app
- **No user-generated content shared publicly** — if kids can type or draw, it stays local
- **No data collection** — do not collect, transmit, or store any personal information about users
- **No ads** — do not integrate advertising SDKs or networks

### UX & Accessibility Rules

- Use large, high-contrast text (minimum 18px, prefer 24px+)
- Buttons and tap targets must be large (minimum 44×44px)
- Avoid timers that cause anxiety; if used, keep them gentle and optional
- Always provide positive reinforcement — celebrate effort, not just success
- Support keyboard navigation and screen readers where feasible
- Avoid flashing animations that could trigger photosensitive conditions (follow WCAG 2.3.1)

### Language & Copy Rules

- Use simple, short sentences (aim for Grade 2–3 reading level)
- Spell out words — avoid abbreviations and jargon
- Use encouraging language ("Try again!", "Almost!", "Great job!")
- Avoid negative framing ("Wrong", "Failed", "Loser")

---

## GitHub Integration

- Repository scope: `ianlin0126/playground` only
- Use MCP GitHub tools (`mcp__github__*`) for all GitHub interactions
- Do NOT create pull requests unless explicitly asked
- Be frugal with comments — only comment when a reply is genuinely necessary

---

## Guardian Build Queue

When the child requests a game via Telegram, the guardian writes a job to `.guardian/jobs/<id>.json`.

**Claude Code is required for game builds.** The guardian queues a job file and waits for a Claude Code session to pick it up. If no session picks up the job within 90 seconds, the guardian tells the kid to ask a grown-up to open Claude Code.

### Claude Code session monitor (required)

Run the Monitor in a Claude Code session opened in the playground directory. A `SessionStart` hook in `.claude/settings.local.json` starts this automatically — just open Claude Code and it begins watching.

Use the Monitor tool pointed at this Python command (singleton — only one instance runs at a time):

```bash
python3 -c "
import os, json, time, sys
pid_file = '/tmp/guardian-monitor.pid'
with open(pid_file, 'w') as f:
    f.write(str(os.getpid()))
try:
    jobs_dir = os.path.join(os.getcwd(), '.guardian', 'jobs')
    seen = set()
    while True:
        if os.path.isdir(jobs_dir):
            try: files = [f for f in os.listdir(jobs_dir) if f.endswith('.json')]
            except: files = []
            for f in files:
                fpath = os.path.join(jobs_dir, f)
                if fpath in seen: continue
                try:
                    with open(fpath) as fp: job = json.load(fp)
                    if job.get('status') == 'pending':
                        seen.add(fpath)
                        print('JOB:' + fpath, flush=True)
                except: pass
        time.sleep(3)
finally:
    try: os.unlink(pid_file)
    except: pass
"
```

Each `JOB:<path>` line is a notification of a new pending build request.

**Singleton guarantee:** The SessionStart hook checks `/tmp/guardian-monitor.pid` before instructing Claude to start a monitor. If the PID exists and the process is alive, the hook tells Claude to skip — so only one monitor runs across all open sessions.

### Processing a job (when a JOB: notification arrives)

1. Read the job file. Set `status → "in_progress"`, `claimedBy → "claude-code"`, `pickedUpAt → <ISO now>`, write back.
2. Execute the `prompt` field using full tool access (Read, Write, Edit, Bash, WebFetch).
3. **Mandatory quality checks before marking done:**
   - **No truncation:** Read the written file — confirm it ends with `</html>` and all `<script>` blocks are closed.
   - **IIFE scoping:** Scan every `onclick=`, `onchange=`, `onsubmit=` attribute. Each referenced function must be declared at **top-level scope** in a `<script>` tag — NOT inside an IIFE like `(function(){...})()` or `window.onload = function(){...}`. If found, fix it: move functions to top-level or replace inline handlers with `addEventListener` calls inside the closure.
   - **URL check:** Fetch `http://localhost:<port>/games/<slug>/` and confirm a 200 HTML response.
4. If any check fails, fix and re-check. Iterate until all pass.
5. **On success:** Write back: `status: "done"`, `url: "http://<lanIp>:<port>/games/<slug>/?v=<Date.now()>"`, `completedAt: <ISO now>`.
6. **On failure:** Write back: `status: "failed"`, `error: "<description>"`, `completedAt: <ISO now>`.

The guardian polls every 4 seconds and picks up the status change automatically.

---

## Updating This File

Keep this file current as the project evolves:
- Add the tech stack and architecture description once chosen
- Document build/test/run commands once configured
- Add code conventions once patterns are established
- Record any project-specific gotchas or pitfalls discovered along the way
