import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface PublishedEntry {
  slug: string;
  publishedAt: string;
  commitSha?: string;  // present = deploying (gh-pages push done but Pages not yet built)
}

export interface PublishResult {
  ok: boolean;
  url?: string;
  error?: string;
  publishedSlugs?: string[];
  publishedAt?: string;
  commitSha?: string;
}

// ── published.json I/O ────────────────────────────────────────────────────

export function readPublishedEntries(playgroundDir: string): PublishedEntry[] {
  const path = join(playgroundDir, "games", "published.json");
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(data)) return [];
    return data.filter(e => typeof e?.slug === "string" && typeof e?.publishedAt === "string");
  } catch {
    return [];
  }
}

export function writePublishedEntries(playgroundDir: string, entries: PublishedEntry[]): void {
  const path = join(playgroundDir, "games", "published.json");
  writeFileSync(path, JSON.stringify(entries, null, 2));
}

// ── GitHub access check ───────────────────────────────────────────────────

export async function checkGitHubAccess(
  githubToken: string,
  githubRepo: string,
): Promise<{ ok: boolean; error?: string }> {
  const parts = githubRepo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, error: "Repo must be in owner/repo format (e.g. ianlin0126/playground)" };
  }
  const [owner, repo] = parts;

  try {
    await githubApi(githubToken, "GET", "/user");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("401")) return { ok: false, error: "Invalid or expired GitHub token" };
    return { ok: false, error: "Could not reach GitHub. Check your internet connection." };
  }

  try {
    const repoData = await githubApi(githubToken, "GET", `/repos/${owner}/${repo}`) as {
      permissions?: { push?: boolean };
    };
    if (repoData.permissions && repoData.permissions.push === false) {
      return { ok: false, error: `Token lacks write access to ${githubRepo}. Grant Contents: Read and write.` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404")) {
      return { ok: false, error: `Repository "${githubRepo}" not found. Create it on GitHub first and make sure the token has access.` };
    }
    if (msg.includes("403")) {
      return { ok: false, error: `Access denied to ${githubRepo}. Grant Contents: Read and write permission.` };
    }
    return { ok: false, error: "Could not access repository. Check the token and repo name." };
  }

  return { ok: true };
}

// ── Static lobby builder ──────────────────────────────────────────────────

export function buildStaticLobbyHtml(games: { name: string; slug: string }[]): string {
  const gamesJson = JSON.stringify(games);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Game Zone 🎮</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
    }
    h1 { font-size: clamp(32px, 8vw, 48px); color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.3); margin-bottom: 12px; text-align: center; }
    p.subtitle { font-size: clamp(16px, 4vw, 22px); color: rgba(255,255,255,0.85); margin-bottom: 48px; text-align: center; }
    .games { display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; max-width: 800px; }
    a.game-card {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: #fff; border-radius: 20px; width: min(200px, calc(100vw - 32px));
      padding: 36px 24px; text-decoration: none; color: #333;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2); transition: transform 0.15s, box-shadow 0.15s;
      min-height: 180px;
    }
    a.game-card:hover, a.game-card:focus { transform: translateY(-6px); box-shadow: 0 16px 32px rgba(0,0,0,0.3); outline: 4px solid #fff; }
    a.game-card .emoji { font-size: 56px; margin-bottom: 16px; }
    a.game-card .name { font-size: 26px; font-weight: bold; text-align: center; }
    footer { margin-top: 48px; color: rgba(255,255,255,0.6); font-size: 16px; }
  </style>
</head>
<body>
  <h1>Game Zone 🎮</h1>
  <p class="subtitle">Pick a game and have fun!</p>
  <div class="games" id="games-container"></div>
  <footer>More games coming soon!</footer>
  <script>
    var EMOJIS = ['🃏', '🎲', '🧩', '🎯', '🕹️', '🎮', '🏆', '⭐'];
    var games = ${gamesJson};
    var container = document.getElementById('games-container');
    if (games.length === 0) {
      container.innerHTML = '<p style="color:#fff;font-size:1.2rem;">No games yet — come back soon! 🎮</p>';
    } else {
      games.forEach(function(game, i) {
        var a = document.createElement('a');
        a.className = 'game-card';
        a.href = 'games/' + game.slug + '/';
        a.setAttribute('aria-label', 'Play ' + game.name);
        var emojiSpan = document.createElement('span');
        emojiSpan.className = 'emoji';
        emojiSpan.textContent = EMOJIS[i % EMOJIS.length];
        var nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = game.name;
        a.appendChild(emojiSpan);
        a.appendChild(nameSpan);
        container.appendChild(a);
      });
    }
  </script>
</body>
</html>`;
}

// ── GitHub API helper ─────────────────────────────────────────────────────

async function githubApi(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    let msg = `GitHub API ${method} ${path} → ${res.status}`;
    try {
      const data = await res.json() as { message?: string };
      if (data.message) msg += `: ${data.message}`;
    } catch {}
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Main publish function ─────────────────────────────────────────────────

export async function publishToGitHubPages(
  playgroundDir: string,
  githubToken: string,
  githubRepo: string,
  slugs: string[],
): Promise<PublishResult> {
  try {
    const parts = githubRepo.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, error: "GITHUB_REPO must be in owner/repo format" };
    }
    const [owner, repo] = parts;

    // Validate slugs (no path traversal, no empty)
    for (const slug of slugs) {
      if (!slug || /[./\\]/.test(slug)) {
        return { ok: false, error: `Invalid slug: ${slug}` };
      }
      const gamePath = join(playgroundDir, "games", slug, "index.html");
      if (!existsSync(gamePath)) {
        return { ok: false, error: `Game not found: ${slug}` };
      }
    }

    // Get current gh-pages branch tip (null if branch doesn't exist yet)
    let parentSha: string | null = null;
    try {
      const ref = await githubApi(githubToken, "GET", `/repos/${owner}/${repo}/git/ref/heads/gh-pages`) as { object: { sha: string } };
      parentSha = ref.object.sha;
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes("404")) throw e;
    }

    // Upload each game file as a blob
    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];

    for (const slug of slugs) {
      const content = readFileSync(join(playgroundDir, "games", slug, "index.html"), "utf8");
      const blob = await githubApi(githubToken, "POST", `/repos/${owner}/${repo}/git/blobs`, {
        content: Buffer.from(content).toString("base64"),
        encoding: "base64",
      }) as { sha: string };
      treeEntries.push({ path: `games/${slug}/index.html`, mode: "100644", type: "blob", sha: blob.sha });
    }

    // Build and upload the static lobby
    const manifestPath = join(playgroundDir, "games", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{ slug: string; name: string }>;
    const manifestMap = new Map(manifest.map(e => [e.slug, e.name]));
    const lobbyHtml = buildStaticLobbyHtml(slugs.map(s => ({ slug: s, name: manifestMap.get(s) ?? s })));
    const lobbyBlob = await githubApi(githubToken, "POST", `/repos/${owner}/${repo}/git/blobs`, {
      content: Buffer.from(lobbyHtml).toString("base64"),
      encoding: "base64",
    }) as { sha: string };
    treeEntries.push({ path: "index.html", mode: "100644", type: "blob", sha: lobbyBlob.sha });

    // Create tree (base_tree: null = exact set, no stale files from previous pushes)
    const tree = await githubApi(githubToken, "POST", `/repos/${owner}/${repo}/git/trees`, {
      tree: treeEntries,
    }) as { sha: string };

    // Create commit
    const now = new Date().toISOString();
    const commit = await githubApi(githubToken, "POST", `/repos/${owner}/${repo}/git/commits`, {
      message: `Publish ${slugs.length} game${slugs.length === 1 ? "" : "s"} — ${now}`,
      tree: tree.sha,
      parents: parentSha ? [parentSha] : [],
    }) as { sha: string };

    // Update or create the gh-pages ref
    if (parentSha) {
      await githubApi(githubToken, "PATCH", `/repos/${owner}/${repo}/git/refs/heads/gh-pages`, {
        sha: commit.sha,
        force: true,
      });
    } else {
      await githubApi(githubToken, "POST", `/repos/${owner}/${repo}/git/refs`, {
        ref: "refs/heads/gh-pages",
        sha: commit.sha,
      });
    }

    // Configure Pages to serve from gh-pages — create if new, update source if already exists
    try {
      await githubApi(githubToken, "POST", `/repos/${owner}/${repo}/pages`, {
        source: { branch: "gh-pages", path: "/" },
      });
    } catch {
      // Pages already exists — update source branch in case it's pointing elsewhere (e.g. main)
      try {
        await githubApi(githubToken, "PUT", `/repos/${owner}/${repo}/pages`, {
          source: { branch: "gh-pages", path: "/" },
        });
      } catch {}
    }

    // Persist published state
    writePublishedEntries(playgroundDir, slugs.map(slug => ({ slug, publishedAt: now })));

    return {
      ok: true,
      url: `https://${owner}.github.io/${repo}/`,
      publishedSlugs: slugs,
      publishedAt: now,
      commitSha: commit.sha,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Deployment confirmation ───────────────────────────────────────────────

export async function getDeploymentStatus(
  githubToken: string,
  githubRepo: string,
): Promise<{ built: boolean; latestCommit?: string }> {
  const parts = githubRepo.split("/");
  if (parts.length !== 2) return { built: false };
  const [owner, repo] = parts;

  try {
    // Legacy branch builds expose the exact commit that was deployed
    const build = await githubApi(githubToken, "GET", `/repos/${owner}/${repo}/pages/builds/latest`) as {
      status: string;
      commit: string;
    };
    return { built: build.status === "built", latestCommit: build.commit };
  } catch {
    // Fall back to the pages status field (no commit comparison possible)
    try {
      const pages = await githubApi(githubToken, "GET", `/repos/${owner}/${repo}/pages`) as { status: string };
      return { built: pages.status === "built" };
    } catch {
      return { built: false };
    }
  }
}
