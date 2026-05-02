# Playground — AI Game Studio for Kids

A game studio for parents to build together with kids and help them learn AI with Claude Code. Your kid chats with a Telegram bot to describe a game to build; Claude builds them as self-contained web pages served on your home WiFi so the kid can play on a tablet or a smartphone. You monitor conversations and manage games from a local dashboard.

**How it works:**

```
Kid (Telegram) → Guardian server → Claude Code (on your Mac) → Game URL sent back to kid's device
```

---

## What You Need

| Requirement | Install |
|---|---|
| macOS 14+ | — |
| Git | Pre-installed on macOS (`xcode-select --install` if missing) |
| [Bun](https://bun.sh) | `curl -fsSL https://bun.sh/install \| bash` |
| [Claude Code](https://code.claude.com/docs/en/quickstart) | `curl -fsSL https://claude.ai/install.sh \| bash` |
| [Anthropic API key](https://platform.claude.com/dashboard) | Create one at platform.claude.com |
| [Telegram](https://web.telegram.org/) | Create an account for your kid |

---

## Setup (one time, ~10 minutes)

### Step 1 — Install

```bash
bun create ianlin0126/playground
cd playground
bun run server
```

### Step 2 — Run the setup wizard

Open **http://localhost:3000/parent** in your browser. The wizard walks you through:

1. Verifying Claude Code is installed and authenticated
2. Entering your Anthropic API key
3. Creating a Telegram bot via [@BotFather](https://t.me/BotFather) (takes ~2 minutes)
4. Creating a [Telegram](https://web.telegram.org/) account for your kid, then sending one message to the bot — the Telegram ID of the account is detected automatically
5. Saving everything to `.env` and starting the guardian

### Step 3 — Open Claude Code in the project directory

Games are built by Claude Code, not the server. Open a terminal in `playground/` and run:

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

**Parent dashboard:** http://localhost:3000/parent — monitor conversations, see built games, manage settings, and publish games on GitHub Pages for free.

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

## Publishing Games to GitHub Pages

Games built locally are only accessible on your home WiFi. GitHub Pages lets you publish them to a free public URL so your kid can play from anywhere, and share their work with others to play.

### How it works

Once configured, you can publish individual games from the Games section of the parent dashboard with a single click. Each game card shows its current state:

| State | Meaning |
|---|---|
| **Publish** (gray toggle) | Built locally, not yet published |
| **Publishing…** | Uploading to GitHub — takes a few seconds |
| **Deploying…** | Files uploaded, GitHub Pages is building — takes up to 2 minutes |
| **Live →** (green, clickable) | Live on GitHub Pages — click to open |
| **↑ Republish** (amber) | Game was updated locally — click to push the new version live |

### One-time setup

**1. Create a GitHub repository**

Go to [github.com/new](https://github.com/new) and create a new **public** repository (e.g. `playground-games`). No need to initialise it with any files. *(Tip: this same repo can also track the source of your selected games — see [Project Structure](#project-structure) below.)*

**2. Create a Personal Access Token**

GitHub needs a token to let the dashboard push game files on your behalf.

1. On GitHub, click your avatar → **Settings**
2. Scroll to the bottom → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
3. Click **Generate new token**. Give it a name (e.g. "Playground publish") and set an expiry (90 days is a good default)
4. Under **Repository access**, choose *Only select repositories* and pick your games repo
5. Under **Repository permissions**, grant **Read and write** for:
   - **Contents** — to push game files
   - **Pages** — to enable GitHub Pages
   - **Administration** — to configure the Pages source branch
6. Click **Generate token** and copy it immediately — you won't see it again

**3. Configure the dashboard**

Open the **Games** section of the parent dashboard and click **Set up →** in the banner at the top. Enter your token and repository name (`owner/repo`, e.g. `ianlin0126/playground-games`). The dashboard validates access and saves everything to your `.env`.

You can also update these values any time from the **Settings** page, or edit the `.env` file directly. All of this info is managed locally — it's never transmitted anywhere else.

### Keeping games up to date

When Claude builds a new version of a game that is already live on GitHub Pages, the card turns amber and shows **↑ Republish**. Click either the label or the amber toggle to push the updated version. The game goes through **Publishing…** → **Deploying…** → **Live →** just like the first publish.

---

## Configuration

All settings live in `.env` (gitignored). Edit them directly or via the Settings page on the dashboard.

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `KID_BOT_TOKEN` | Telegram bot token from @BotFather |
| `KID_NAME` | Your kid's first name |
| `KID_TELEGRAM_ID` | Your kid's numeric Telegram user ID |
| `GITHUB_TOKEN` | Personal access token for publishing to GitHub Pages (optional) |
| `GITHUB_REPO` | Repository to publish to, in `owner/repo` format (optional) |

---

## Project Structure

This is the **platform** — the guardian server, parent dashboard, and dev tools. It's intentionally generic and contains no games or personal artwork by itself, so it's safe to share or fork as a template.

Games live in `games/<slug>/` on disk and that directory is **gitignored** here by design. Kid-built games via the Telegram bot land there as ephemeral local files — they don't pollute the platform repo.

If you want to **track your favorite games in git** alongside publishing them (the same repo serves both purposes), the recommended workflow is to put the `games/` directory under its own independent git repo. No submodule, no symlink — just `git init` inside `games/` and treat it as a separate project. Set `GITHUB_REPO` in `.env` to point there and the publisher will push to that repo's `gh-pages` branch.

Per-game asset paths use `./assets/...` relative to each game's folder, so games are self-contained and copy-paste portable.

For the full architecture (what's tracked where, asset conventions, publisher details), see [CLAUDE.md](./CLAUDE.md).

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
