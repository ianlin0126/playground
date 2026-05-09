---
name: game-assets
description: >
  Use this skill when adding or replacing visual assets for a 2D HTML5
  canvas game — sprite atlases for entities (player, enemies, items, FX)
  and/or painted background images for parallax scenery. Generated via an
  Image Gen AI (OpenAI gpt-image-1, Midjourney, Gemini, etc.). Triggers
  when the user (or a guardian-queued kid request) asks to "reskin", "use
  real graphics", "add a sprite atlas", "add a background", "give it a
  custom backdrop", "polish the visuals", "make the game look real", or
  whenever Claude would otherwise leave a game looking placeholder-y.
  Also use it when extending or fixing the visual assets of a game that
  already has them (e.g. adding a missing pit-drop background, swapping
  an atlas because the kid asked for a new theme).
---

# Game Assets Skill

A workflow for producing custom image assets for 2D HTML5 canvas games.
There are two asset tracks, often combined for the same game:

1. **Sprite atlas** — one transparent PNG with all entity sprites laid
   out on a grid. Drives players, enemies, items, FX. (Phases 1–7,
   atlas track.)
2. **Background image(s)** — one or more opaque painterly landscapes
   drawn behind the play area, cover-fit with parallax, and used to
   show through level holes via the **pitfall visual treatment**.
   (Phases 1, 2B, 3, 6B, 7.)

Both tracks share the same machinery: audit the game's needs, author a
careful prompt, generate via Image Gen, verify, iterate, integrate, QA.
The differences are in the prompt shape and the integration code.

This skill is **action-oriented**: each phase produces a concrete artifact
that feeds the next phase. Don't skip phases — Image Gen is unreliable, and
the audit + validation steps catch problems before they reach the player.

The skill assumes a single-game scope. Reskinning multiple games is N
independent runs through this workflow.

**Bundled scripts** in `scripts/` are the deterministic backbone — call
them rather than re-deriving the steps inline:

- `scripts/gen_image.py` — generate an atlas (transparent square) or a
  background (opaque landscape) via OpenAI's image API.
- `scripts/extract_atlas.py` — alpha-detect sprite bboxes from a
  generated atlas and emit `sprite-map.json`.
- `scripts/verify_reskin.py` — drive the game in headless Chrome,
  capture console errors + a gameplay screenshot, fail loudly on JS
  errors or 404s.

**Entry-point context.** This skill fires in two situations:

- **Parent in Claude Code** asks for visuals on a game directly —
  full interactive flow.
- **Kid via the guardian agent** queues a build job whose prompt
  implies new visuals (e.g. "make red-ball look like the real game").
  Claude Code picks up that job per `CLAUDE.md`'s Guardian Build Queue
  protocol and runs this skill *non-interactively*. In that case treat
  the kid's spec as the requirements input; don't ask the kid follow-up
  questions, infer what's reasonable, and document inferences in the
  spec change log entry.

---

## Phase 1 — Audit the existing game

Before generating anything, read the game's source code and produce a deep
understanding of its visual mechanics. The output of this phase is an
asset-requirements table that drives everything that follows.

### Read the source

For every entity that's drawn on the canvas:

- What does it currently render as? (canvas shape / emoji / SVG / placeholder sprite)
- At what destination size is it drawn? (`ctx.drawImage(... dw, dh)` or `arc(... r)` etc.)
- What states does it have?
  - **Static** — one image (coin, simple obstacle)
  - **Multi-frame animation** — explosions, walk cycles, idle bobs
  - **State swap** — hit-flash, shielded, charged, destroyed
  - **Direction variant** — tilt-left vs tilt-right (often runtime-mirrorable from one source)
  - **Tier variant** — weak / medium / strong (boss tiers, asteroid sizes)
- Is the entity rotated at runtime? (asteroids spin; ships don't)
- What's its on-screen size relative to the player?

### Build the asset-requirements table

| Entity | States / frames | Dest size | Notes |
|---|---|---|---|
| player | idle, tilt-left, tilt-right + shielded versions of each (6 total OR 4 with mirroring) | 72×72 | Tilt is purely visual; gameplay just tracks `vx` |
| asteroid | 5 size tiers, same shape | radius scales 28→144 by tier | Sprite is rotation-agnostic (game rotates at runtime) |
| explosion | 5-frame death animation | 90×90 | Plays once when player dies; not looping |
| boss | 1 base sprite + tier-driven scale/tint in code | 140×140 | Tier 1/2/3 differentiated by code, not separate sprites |
| coin | static | 26×26 | Game-bobs in code |

The table above is illustrative. Actual contents depend on the game.

### Decide what code-side compensation buys you

Image Gen costs money per call and is unreliable. Before adding *N* sprites
to your prompt, ask: can code do this cheaper?

- **Direction variants** → mirror with `ctx.scale(-1, 1)`. One source sprite
  becomes both left and right.
- **Color tints** → `ctx.globalCompositeOperation = 'multiply'` + a colored
  fill (works on a solid background) or the **offscreen-canvas + source-atop**
  pattern (see Phase 6) to recolor a sprite-shaped region without bleeding
  onto neighbors. Drives "tier 1 green / tier 2 red" or "damaged-asteroid
  red" from one base sprite. Avoid `ctx.filter` for tints — iOS Safari
  before v17 silently ignores it, and a kid's tablet is the most common
  break case.
- **Scale variants** → just change `dw, dh`. One sprite renders as N sizes.
- **Damage state** → overlay a tinted version of the same sprite on top
  at alpha proportional to damage (see Phase 6 recipe).
- **Hit flash** → swap to a brighter version OR draw a white overlay using
  `globalCompositeOperation = 'source-atop'`.
- **Multi-tier visual escalation from one base sprite** → stack scale + tint
  + glow ring + HP-bar palette per tier. Each individual technique is small;
  the compound effect makes tier 3 feel distinctly more dangerous than
  tier 1 even though they share the underlying art.

A modest atlas (~20 sprite slots) plus aggressive code-side compensation
can drive dozens of distinct visual states in the running game.

---

## Phase 2 — Author the Image Gen prompt

Image Gen models produce one image per call. There are two prompt shapes
depending on the asset:

- **Phase 2A — sprite atlas** (entities): a transparent PNG with all
  sprites on a strict grid. Heavy enumeration, anti-text rules, style
  consistency.
- **Phase 2B — background image** (scenery): an opaque painterly
  landscape, no grid, with a reserved bottom band the floor sits on
  top of. Loose composition cues, no cell enumeration.

Pick one (or both, in sequence — atlas first, then bg) based on the
Phase 1 audit. Both follow the same generation/validation flow in
Phase 3+.

## Phase 2A — Sprite-atlas prompt

The most efficient output is a **single sprite atlas** — a transparent
PNG with all sprites on a grid.

### Atlas spec

- **Format:** PNG with transparent background (alpha channel, NOT a solid color)
- **Dimensions:** 1024×1024 is the default — most Image Gen models are
  trained on this size and respect it best. Larger atlases (2048×2048)
  work but slow generation.
- **Cell size:** ~192×192 px for normal sprites; bigger for highly
  detailed art.
- **Layout:** rows × cols, every cell filled. Image Gen models drop or
  merge cells when there are gaps — fill spares with throwaway content
  if you must (a star icon, a generic coin) rather than leaving them
  empty.

### Required prompt elements

1. **Output spec up front:** "Generate a 1024×1024 px PNG sprite atlas
   for a 2D space shooter game. Fully transparent background. No solid
   color fills. No checker pattern."
2. **Anti-text rule:** "NO text labels, NO numbers, NO captions,
   NO legend, NO row/column headers anywhere in the image." Image Gen
   loves to add labels to anything it perceives as a chart. Repeat the
   anti-text rule at both the start and end of the prompt for emphasis.
3. **Strict grid:** "Strict R-row × C-column grid. Each cell is exactly
   <px>×<px>. Sprites are centered in their cells with consistent
   padding."
4. **Cell-by-cell enumeration:** walk every cell with explicit content.
   Use `(row, col)` notation:
   ```
   (0,0) Player ship, silver/gunmetal, FACING UP, perfectly level
   (0,1) Same player ship, banking 15 degrees to the LEFT
   (0,2) Same player ship, banking 15 degrees to the RIGHT
   ...
   ```
   Image Gen ignores partial spec, so be exhaustive.
5. **Style note:** "Detailed digital painting, sharp outlines, dramatic
   rim lighting, saturated colors. Consistent art direction across all
   <N> sprites — no per-sprite stylistic drift."
6. **Composite hygiene:** "No drop shadows under sprites (so they
   composite cleanly on a black background). No backgrounds within
   cells — only the sprite plus transparent space."

### Common Image Gen quirks to plan for

- **Drops cells when the grid has gaps** → fill every cell with content.
- **Bakes in labels despite "no text"** → expect 1–2 regens. Stronger
  language at both ends of the prompt helps; nothing eliminates this.
- **Inconsistent scaling between cells** → "all sprites at the same
  pixel scale within their cells" reduces this.
- **Drops the transparent background** → many models default to white
  unless you stress transparency multiple times.
- **Tier variants too similar** → describe each tier with concrete
  visual differences ("tier 1 green/teal, tier 2 purple/red with extra
  turrets, tier 3 deepest red/black with the most weapons") not abstract
  level numbers.
- **Animation frames that look the same** → describe each frame's
  content explicitly ("frame 1: small initial pop, sparks; frame 2:
  bright orange and yellow primary explosion, ship gone; ...") not
  just "5 explosion frames".

### Output the prompt

Show the user the full prompt as a fenced markdown block, ready to paste.

---

## Phase 2B — Background-image prompt

Backgrounds are *not* atlases. The prompt is shaped completely differently:
no grid, no enumeration, no anti-text obsession, opaque output, painterly
composition. The artifact lives behind everything in the play area and
shows through pits.

### Background spec

- **Format:** PNG, opaque (no alpha — the image fully covers the canvas
  before the floor draws on top of it). When using `gen_image.py`, use
  `--mode bg` which omits the `background:transparent` parameter.
- **Dimensions:** `1536×1024` (landscape) is the default. Matches the
  cover-fit math used by the parallax helper in Phase 6B.
- **Style:** painterly cartoon — saturated but consistent palette, soft
  shading, no heavy outlines. Background should *recede* behind the
  foreground sprites, not compete with them.
- **Composition:** keep critical detail in the upper 60–70%. Reserve
  the bottom 10–15% as a plain dark band of a single ground-tone color
  so the in-game floor sits on top of it without visual conflict.
- **No characters, no foreground objects, no text labels.** Backgrounds
  are scenery only.

### Required prompt elements

1. **Subject** — what the place *is*: "friendly robot factory at golden
   hour", "twilight crystal cave", "rolling green hills with a low
   sun". One short sentence.
2. **Mood / lighting** — "golden hour", "moody and atmospheric",
   "cheerful midday", "stars and a glowing moon". Drives palette.
3. **Style** — "painterly cartoon, Saturday-morning Wall-E vibes",
   "watercolor storybook", "flat-shaded SNES-era pixel-painterly".
   Be concrete.
4. **Composition cues** — explicitly call out "wide horizontal landscape,
   16:10", "leave the lower 12% as a plain dark band so a game floor
   can sit on top", "no foreground objects, no characters, no text".
5. **Palette anchors** — name 3–6 hex/named colors so multiple
   background regenerations stay coherent (e.g. `#FFB347 peach`,
   `#FF8C42 amber`, `#4A2E5C deep purple`).

### Background prompt template

```
A wide painterly cartoon background of {SUBJECT} at {LIGHTING}, in the
style of {STYLE}. {2–3 sentences of concrete content — silhouettes,
clouds, sun, gears, rocks, crystals, etc.}. A {ground-tone} band sits
just above the bottom edge, blending into a narrow {ground-tone-darker}
band at the very bottom. Flat painterly shading, soft rim light, no
heavy black outlines, no text, no characters, no foreground objects.
Composition leaves the lower 12% as a plain {ground-tone} band so a
game floor can sit on top of it without conflict. Cinematic horizontal
landscape, 16:10 wide. Palette: {3–6 named hex colors}.
```

### Multiple backgrounds for multi-world games

For games with worlds/biomes, generate one bg per world (`bg-w1.png`,
`bg-w2.png`, ...). Keep the *style* identical across them; vary only
the *subject* and *palette*. Example pairing from the playground:
red-ball worlds 1/2/3 are "rolling hills" / "crystal cave" /
"factory-at-sunset" — same painterly style, different scenes.

---

## Phase 3 — Generate the image

**Default path: call the OpenAI image API via the bundled
`scripts/gen_image.py`.** The manual paste-into-a-tool path is the
fallback for when no API key is configured or the user explicitly opts
to do it themselves.

Decision rule:

1. Read `OPENAI_API_KEY` from the project's `.env` file.
2. If the key is present AND the user has not asked to do it manually
   → **3a (API path)**.
3. Otherwise → **3b (manual path)**, and tell the user why
   ("`OPENAI_API_KEY` not set in `.env` — falling back to manual
   paste").

### 3a — API path (default when `OPENAI_API_KEY` is set)

Run the bundled script. It handles atlases and backgrounds with the
same code path; the `--mode` flag selects sane defaults.

```bash
set -a; . ./.env; set +a   # load OPENAI_API_KEY into the env

SLUG="<game-slug>"

# Atlas (transparent square, default 1024x1024):
/opt/homebrew/bin/python3.13 .claude/skills/game-assets/scripts/gen_image.py \
  --mode atlas \
  --prompt-file /tmp/${SLUG}-atlas-prompt.txt \
  --out games/${SLUG}/assets/${SLUG}-atlas.png

# Background (opaque landscape, default 1536x1024):
/opt/homebrew/bin/python3.13 .claude/skills/game-assets/scripts/gen_image.py \
  --mode bg \
  --prompt-file /tmp/${SLUG}-bg-prompt.txt \
  --out games/${SLUG}/assets/bg-<world-or-name>.png
```

Write the Phase 2 prompt to `$PROMPT_FILE` first (use the Write tool).
The script reads it verbatim — no shell-quoting hell.

**Why the explicit `python3.13` path:** macOS's stock `python3` (3.6 in
this user's env) ships with an SSL cert bundle that fails handshake
against `api.openai.com`. Use any modern Python (3.11+) you have on
PATH; `/opt/homebrew/bin/python3.13` is the verified one in this
playground. If `gen_image.py` ever fails with `CERTIFICATE_VERIFY_FAILED`,
this is the cause.

**Model name.** The script defaults to `gpt-image-1` (verified working
as of 2026-05-08). Override with `--model gpt-image-2` if/when the
newer model becomes generally available. If the API rejects the name,
the script surfaces the OpenAI error message — adjust and retry.

**Sanity check.** A successful call writes a PNG > ~50 KB. A few
hundred bytes means the response was a JSON error — the script prints
the response body to stderr in that case.

After the PNG is saved, proceed to Phase 4. Validation still runs —
gpt-image has the same quirks (label leaks, dropped cells, inconsistent
scaling) as any other Image Gen model.

### 3a-fallback — Inline curl (if gen_image.py is unavailable)

If you can't run the script for any reason, the equivalent shell
recipe is:

```bash
set -a; . ./.env; set +a

SLUG="<game-slug>"
PROMPT_FILE="/tmp/${SLUG}-atlas-prompt.txt"
OUT="games/${SLUG}/assets/${SLUG}-atlas.png"
mkdir -p "$(dirname "$OUT")"

curl -sS https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile p "$PROMPT_FILE" \
        '{model:"gpt-image-1", prompt:$p, size:"1024x1024", background:"transparent", n:1}')" \
  | tee /tmp/${SLUG}-atlas-response.json \
  | jq -r '.data[0].b64_json' \
  | base64 -d > "$OUT"
ls -l "$OUT"
```

For backgrounds, drop the `background:"transparent"` field and set
`size:"1536x1024"`.

### 3b — Manual path (fallback)

Use this path only when:

- `OPENAI_API_KEY` is absent or empty after sourcing `.env`, OR
- The user has explicitly asked to generate the atlas manually
  ("I'll paste it into Midjourney instead", "let me run this through
  my own tool").

Tell the user:

> Paste the prompt below into <their preferred tool>. Save the resulting
> image as `games/<slug>/assets/<slug>-atlas.png`. Tell me when it's saved.

When they confirm, proceed to Phase 4.

---

## Phase 4 — Validate the asset

Image Gen output is unreliable. Validation has two pieces: a **mechanical
pass** (run a script, check thresholds — fast, deterministic) and a
**visual pass** (Claude reads the cropped sprites, judges quality —
slower, qualitative). The mechanical pass gates the visual pass: if it
fails, regenerate before wasting tokens on visual judgment.

### Mechanical pass — atlas

Run `scripts/extract_atlas.py <atlas-path>`. It writes
`sprite-bboxes.json` next to the atlas and prints a summary. The atlas
**passes** when:

| Check | Pass condition |
|---|---|
| File size | > 50 KB (anything tiny is an error response, not an image) |
| Dimensions | Match what was requested (e.g. 1024×1024) |
| Background | Truly transparent — alpha < 8 in at least 50% of the corner pixels |
| Sprite count | Detected count equals expected count from Phase 1 ± 1 |
| No text bands | No detected bbox is a long thin horizontal strip near the edges (heuristic: aspect ratio > 6:1 in the top or bottom band ⇒ likely a baked-in label) |
| Cell size variance | Within ±25% across detected sprites — large variance means cells got merged or split |

Any mechanical failure → go to Phase 5 with the specific failure noted
(don't bother with visual inspection of an atlas that's already broken).

### Mechanical pass — background

| Check | Pass condition |
|---|---|
| File size | > 100 KB |
| Dimensions | Match request (e.g. 1536×1024) |
| Mode | Opaque (RGB, NOT RGBA — `Pillow.Image.mode == "RGB"`) |
| Bottom band | Bottom 8% has low color variance — a single ground-tone area, not busy detail |
| No text | Quick OCR-like heuristic: look for high-contrast horizontal strokes confined to small regions (≥3 of them clustered together suggests text; the bundled validator just flags suspicious patterns for human review) |

### Sprite-bbox detection algorithm

### Sprite-bbox detection algorithm

The atlas is a PNG with sprites surrounded by transparent space. Find
each sprite's bounding box via alpha-channel analysis:

1. **Load the image** as RGBA. Read the alpha channel as a 2D array of
   `H × W` bytes (0 = transparent, 255 = opaque).
2. **Find vertical row bands.** For each row `y` in `[0, H)`, compute
   `row_alpha_sum[y] = sum of alpha[y][:]`. A row is "content-bearing"
   if `row_alpha_sum[y] > ROW_SUM_THRESHOLD` (~10 or higher — needs to
   be above anti-aliasing fringe noise but below the smallest real
   sprite). Group consecutive content-bearing rows into bands.
3. **Within each band, find horizontal sprite runs.** For each column
   `x`, check if `any(alpha[y][x] > ALPHA_THRESHOLD for y in band)`. A
   column is content-bearing if any pixel in the band's vertical extent
   has alpha above the threshold. Group consecutive content-bearing
   columns into runs. Each run is one sprite.
4. **Tighten each sprite's y-bounds.** The band's y-range covers the
   whole row of sprites; individual sprites within may not span the
   full band height. For each sprite's `(x0, x1)` window inside the
   band, scan rows for alpha > threshold to find the sprite's actual
   `(y0, y1)` content bounds.
5. **Filter noise.** Discard any bbox smaller than `MIN_SPRITE_DIM`
   (~20 px) in either dimension — these are stray pixels, not sprites.
6. **Output** a list of `{ x, y, w, h, row, name }` records sorted by
   `(row, x)`. The `name` field is initially `null`; a human assigns
   names in the next sub-step.

This is a simple connected-band approach. It assumes:
- Sprites are reasonably separated by transparent space
- Each row of sprites doesn't overlap vertically with other rows
- The atlas has a roughly grid-like layout (not arbitrary placement)

For atlases that violate these assumptions (e.g. tightly packed irregular
layouts), use a stricter connected-component analysis on the binary alpha
mask.

### Cropping for visual inspection

For each detected bbox, crop the source image and save it as its own PNG.
Then read each crop and judge:

| Check | Question |
|---|---|
| Count | Did every requirement-table entity appear? |
| Order | Are sprites in the expected positional order? |
| Orientation | Player faces up? Boss faces down? |
| Style consistency | Same art direction across all sprites? |
| Tier differentiation | Are weak/medium/strong visually distinct? |
| Background | Truly transparent (alpha = 0 in empty space)? |
| Labels | Any baked-in text/numbers (Image Gen leaks)? |

### Output the labeled sprite map

For each detected box, assign a canonical name from the requirements
table. Save as a JSON file alongside the atlas:

```json
[
  { "x": 47, "y": 26, "w": 150, "h": 158, "row": 0, "name": "player_level" },
  { "x": 238, "y": 36, "w": 132, "h": 129, "row": 0, "name": "player_tilt" },
  { "x": 435, "y": 27, "w": 164, "h": 156, "row": 0, "name": "player_shield_level" }
]
```

Unused or extra sprites get names like `_unused_0`, `_unused_1` so the
count matches the extractor output but the wire-in code skips them.

---

## Phase 5 — Iterate (refine, don't restart)

**Hard cap: 3 generation rounds.** Image Gen drift is real, but each
regen costs money + time, and after round 3 you're rarely making
progress. If round 3 still doesn't pass, **accept what you have and
compensate in code** (Phase 6's tinting / scaling / mirroring tools
cover most gaps). Code-side compensation is faster, cheaper, and more
predictable than chasing a perfect atlas.

If validation flagged real gaps:

- **Single missing sprite, everything else good:** code around it. Use a
  near-equivalent (banking-left as the idle if idle is missing).
  Document the adaptation inline so future-you knows why.
- **Significant gaps but right style:** refine the prompt with specific
  fixes ("the previous output was missing the asteroid size 1 — add it
  as the smallest in the asteroid row") and regenerate.
- **Wrong style entirely:** rewrite the style block of the prompt and
  regenerate.
- **Variant whose result doesn't compose well in-game** (size mismatch,
  position drift you can't tune away, art that looks bad next to the
  base): consider just *not using it* and falling back to a simpler
  treatment. A particle burst + screen shake is often a better
  hit-feedback than a poorly-aligned hit-state sprite swap.

Don't iterate forever. After 2–3 prompt rounds, accept the atlas as-is
and compensate in code. Code-side compensation is faster, cheaper, and
more predictable than chasing a perfect atlas.

---

## Phase 6 — Process and integrate

### Embed the sprite map in the game

Paste the labeled sprite map as a JS literal:

```js
var ATLAS = new Image();
ATLAS.src = './assets/<game>-atlas.png';

var SPRITES = {
  player_level: { x: 47, y: 26, w: 150, h: 158 },
  player_tilt:  { x: 238, y: 36, w: 132, h: 129 },
  // ...
};
```

Where `./assets/<game>-atlas.png` is relative to the game's HTML file.

### Add the rendering helpers

```js
function drawSprite(name, dx, dy, dw, dh) {
  var s = SPRITES[name];
  if (!ATLAS.complete || ATLAS.naturalWidth === 0 || !s) return false;
  ctx.drawImage(ATLAS, s.x, s.y, s.w, s.h, dx, dy, dw, dh);
  return true;
}

function drawSpriteCentered(name, cx, cy, dw, dh) {
  return drawSprite(name, cx - dw / 2, cy - dh / 2, dw, dh);
}
```

### bbox-ratio scaling for related sprite pairs

When two sprites represent the same entity in different states (e.g.
unshielded vs shielded player), their source bounding boxes may differ
because the variant adds visual elements (the bubble extends beyond the
ship). Scaling both at the same destination size makes the entity
inside appear smaller in the variant.

Add a helper that scales the destination by the ratio of source bboxes:

```js
function drawSpriteRel(refName, name, cx, cy, baseDW, baseDH) {
  var ref = SPRITES[refName];
  var s = SPRITES[name];
  if (!ref || !s) return drawSpriteCentered(name, cx, cy, baseDW, baseDH);
  var dw = baseDW * (s.w / ref.w);
  var dh = baseDH * (s.h / ref.h);
  return drawSpriteCentered(name, cx, cy, dw, dh);
}
```

Pick a "canonical" sprite as the reference (`player_level`, `boss_base`)
and pass it as `refName` for all variants of the same entity.

### Per-sprite render overrides for the cases bbox-ratio gets wrong

bbox-ratio assumes the entity inside each sprite is at the same pixel
scale and just has decorations extending the bbox. This isn't always
true — sometimes Image Gen draws the entity inside a variant slightly
larger or smaller than the canonical sprite, OR the variant's bbox is
clipped (height-truncated) rather than extended.

For these cases, add a per-sprite override table:

```js
var SPRITE_RENDER_OVERRIDES = {
  // Shield variants: bbox-ratio alone left the ship looking too small
  // because the bubble doesn't fully account for its bbox extension.
  // Empirical bumps applied on top of the bbox-ratio result.
  player_shield_level: { wMul: 1.20, hMul: 1.30 },
  player_shield_left:  { wMul: 1.23, hMul: 1.30 },
  player_shield_right: { wMul: 1.22, hMul: 1.29 },
  // Hit-state where the bbox is actually CLIPPED (height-truncated)
  // rather than extended. Renders at the canonical destination + small
  // y-offset to compensate for the boss sitting higher in the clipped
  // bbox.
  boss_base_hit: { wMul: 1.0, hMul: 1.0, yOffset: 5 },
};
```

Update `drawSpriteRel` to consult the override table before falling
through to bbox-ratio:

```js
function drawSpriteRel(refName, name, cx, cy, baseDW, baseDH) {
  var ov = SPRITE_RENDER_OVERRIDES[name];
  if (ov) {
    var ox = ov.xOffset || 0, oy = ov.yOffset || 0;
    return drawSpriteCentered(name, cx + ox, cy + oy, baseDW * ov.wMul, baseDH * ov.hMul);
  }
  // bbox-ratio fallback
  var ref = SPRITES[refName], s = SPRITES[name];
  if (!ref || !s) return drawSpriteCentered(name, cx, cy, baseDW, baseDH);
  return drawSpriteCentered(name, cx, cy, baseDW * (s.w / ref.w), baseDH * (s.h / ref.h));
}
```

Override values are **empirical** — derived from side-by-side visual
comparison of the rendered output, not from math on the bboxes alone.
Math gives you a starting point; final values come from "does this look
right when the kid plays it".

### Update each `drawX` function

For each entity:

1. Replace the canvas-shape/emoji block with `drawSprite*` calls.
2. Wrap in a fallback: if the sprite isn't loaded yet (atlas still
   downloading or failed to load entirely), fall through to the
   original shape-drawing code. The user never sees a broken image.
3. For **animations**, store a frame counter on the entity and pick
   the right sprite from a sequence:
   ```js
   var idx = Math.min(frameCount - 1, Math.floor(entity.animFrame / FRAMES_PER_TICK));
   drawSpriteCentered('explosion_' + (idx + 1), x, y, dw, dh);
   ```
4. For **state swaps** (hit-flash, shielded), pick the sprite based on
   a state field:
   ```js
   var name = entity.shieldFrames > 0 ? 'player_shield_level' : 'player_level';
   ```
5. For **mirroring**, wrap the draw in a scale:
   ```js
   if (vx > 0) ctx.scale(-1, 1);
   drawSpriteCentered('player_tilt', 0, 0, dw, dh);
   if (vx > 0) ctx.scale(-1, 1);
   ```
6. For **tier scaling/tinting**, scale + composite-fill:
   ```js
   var scale = b.tier === 1 ? 1.0 : (b.tier === 2 ? 1.15 : 1.30);
   ctx.scale(scale, scale);
   drawSpriteCentered('boss_base', 0, 0, dw, dh);
   if (tier >= 2) {
     ctx.globalCompositeOperation = 'multiply';
     ctx.globalAlpha = tier === 2 ? 0.30 : 0.55;
     ctx.fillStyle = tier === 2 ? '#ff8060' : '#ff3030';
     ctx.beginPath(); ctx.arc(0, 0, 80 * scale, 0, Math.PI * 2); ctx.fill();
     ctx.globalCompositeOperation = 'source-over';
   }
   ```
7. For **damage tinting** (e.g. asteroid that turns red as it takes
   hits), use an **offscreen canvas** to produce a tinted version of the
   sprite, then overlay it on top of the original at alpha proportional
   to damage. Don't use `ctx.filter` — iOS Safari < 17 ignores it
   silently, leaving the kid's tablet showing no tint.
   ```js
   // One-time setup (module-level, reused each frame):
   var TINT_CANVAS = document.createElement('canvas');
   TINT_CANVAS.width = 512;   // ≥ largest sprite render size
   TINT_CANVAS.height = 512;
   var TINT_CTX = TINT_CANVAS.getContext('2d');

   function drawSpriteTinted(name, cx, cy, dw, dh, tintFill) {
     var s = SPRITES[name];
     if (!ATLAS.complete || ATLAS.naturalWidth === 0 || !s) return false;
     // 1. Draw sprite to offscreen (offscreen bg is transparent)
     TINT_CTX.clearRect(0, 0, TINT_CANVAS.width, TINT_CANVAS.height);
     TINT_CTX.drawImage(ATLAS, s.x, s.y, s.w, s.h, 0, 0, dw, dh);
     // 2. Paint tint over sprite-shaped region only — source-atop draws
     //    only where existing pixels are opaque, masking by sprite alpha
     TINT_CTX.globalCompositeOperation = 'source-atop';
     TINT_CTX.fillStyle = tintFill;
     TINT_CTX.fillRect(0, 0, dw, dh);
     TINT_CTX.globalCompositeOperation = 'source-over';
     // 3. Composite tinted result back to main canvas
     ctx.drawImage(TINT_CANVAS, 0, 0, dw, dh, cx - dw / 2, cy - dh / 2, dw, dh);
     return true;
   }

   // Per-frame in drawX:
   if (entity.hp < entity.maxHp) {
     ctx.save();
     ctx.globalAlpha = 1 - entity.hp / entity.maxHp;
     drawSpriteTinted(spriteName, 0, 0, dw, dh, 'rgba(255, 60, 30, 0.92)');
     ctx.restore();
   }
   ```
   Why offscreen: applying tint directly on the main canvas with
   `source-atop` would also paint over any non-transparent pixels in
   the rectangle (background, stars, particles), producing a red
   square. The offscreen canvas's transparent background means
   `source-atop` masks cleanly to the sprite alone. The progressive
   `globalAlpha` on the main composite makes undamaged sprites look
   normal, fully-damaged sprites look fully red, with smooth
   interpolation between.

---

## Phase 6B — Wire up the background

Backgrounds plug into the render loop in three specific spots:

### Step 1 — load the image

```js
var bgImg = new Image();
bgImg.src = './assets/bg-<world-or-name>.png';
```

Don't gate gameplay on the bg loading — the parallax helper has a
`complete && naturalWidth` guard and the renderer falls back to a flat
color until the image arrives.

### Step 2 — replace the canvas-clear with a parallax cover-fit draw

This is the core helper. Mirrors `red-ball/drawBgImage` and
`robot-factory-rumble/drawParallaxBg`:

```js
function drawParallaxBg(img, scrollSpan) {
  // scrollSpan = total horizontal scroll distance (e.g. levelLength - W).
  // For non-scrolling games, pass 0 — the bg renders centered.
  if (!img.complete || !img.naturalWidth) {
    ctx.fillStyle = '#1a1a1a'; // sane fallback
    ctx.fillRect(0, 0, W, H);
    return;
  }
  var iw = img.naturalWidth, ih = img.naturalHeight;
  var canvasAR = W / H, imgAR = iw / ih;
  var dw, dh, dx, dy;
  if (imgAR > canvasAR) { dh = H; dw = H * imgAR; }
  else                  { dw = W; dh = W / imgAR; }
  dx = (W - dw) / 2;
  dy = (H - dh) / 2;
  var slack = Math.max(0, dw - W);
  if (slack > 0 && scrollSpan > 0) {
    var t = Math.max(0, Math.min(1, camera.x / scrollSpan));
    dx = -slack * t;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}
```

Replace the per-frame `ctx.fillStyle = '#xxx'; ctx.fillRect(0,0,W,H);`
with `drawParallaxBg(bgImg, levelLength - W);` at the top of `draw()`.

### Step 3 — pitfall visual treatment (the red-ball recipe)

If the level has pits/holes the player can fall into, draw a
transparent-at-rim → opaque-black-at-bottom gradient over each pit
**before** the floor draws. The bg shows through the rim and fades to
darkness as the eye travels down — reads instantly as "a deep void you
should not fall into" while keeping the parallax scenery visible.

```js
function drawPits() {
  var topY = GROUND_Y;             // the y of the floor's top edge
  var botY = H + 100;              // anywhere off the bottom of canvas
  for (var i = 0; i < level.pits.length; i++) {
    var p = level.pits[i];
    var grad = ctx.createLinearGradient(0, topY, 0, botY);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(p.x, topY, p.w, botY - topY);
  }
}
```

Call order in `draw()`:

```js
drawParallaxBg(bgImg, levelLength - W);  // 1. bg fills the canvas
ctx.translate(-camera.x, 0);             // 2. enter world coords
drawPits();                              // 3. void gradient over each pit
drawFloor();                             // 4. floor segments (skipping pits)
// ... rest of the world ...
```

The floor's pit-edge accents (e.g. red danger walls) draw as part of
`drawFloor` and naturally cap the top of the gradient.

### Multi-world variants

If the game has a `state.world` index and one bg per world, fan out:

```js
var BGS = [bgW1, bgW2, bgW3];
function drawBackground() {
  drawParallaxBg(BGS[state.world] || BGS[0], current.width - W);
}
```

Procedural fallbacks (the original canvas-drawn hills/cave/lab) stay
as the flat-color path inside `drawParallaxBg` — kids whose tablets
hit a slow connection still see *something*.

---

## Phase 7 — QA loop

The reskin is complete when an automated smoke test passes (mechanical
gate) AND a quick human-eye review of a gameplay screenshot agrees the
art is in place (qualitative gate). Run them in that order — no point
eyeballing a screenshot of a broken page.

**Hard cap: 3 fix rounds.** After 3 iterations of the test/fix loop,
escalate to the human with what's still broken. Most lingering issues
at that point are bbox/scale tuning or atlas content gaps, both of
which need human judgment to dial in.

### Mechanical pass — automated reskin verification

The bundled `scripts/verify_reskin.py` does everything below in one
shot. Use it whenever Playwright tools aren't available, the page is
behind a server you can't expose to the MCP, or you want CI-style
exit codes:

```bash
/opt/homebrew/bin/python3.13 \
  .claude/skills/game-assets/scripts/verify_reskin.py \
  --url http://localhost:3000/games/<slug>/ \
  --out /tmp/<slug>-verify
```

The script: (1) waits for the page to load, (2) waits for the atlas
image to report `complete && naturalWidth>0`, (3) drives past the
menu if there's a Start button, (4) captures a gameplay screenshot,
(5) dumps console errors and 4xx/5xx network responses to a JSON
report. It exits non-zero if any of the following fail:

- HTTP 200 on the page itself
- HTTP 200 on every same-origin asset request observed during load
- Zero JS errors in `console.error` or unhandled promise rejections
- Atlas image actually loaded (`naturalWidth > 0`)

### Mechanical pass — Playwright MCP path

When the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`)
are available, prefer them — same checks, no script subprocess.
Schemas are deferred; load them once with:

```
ToolSearch query="mcp__plugin_playwright_playwright" max_results=20
```

Then drive:

1. `browser_navigate` to the game URL.
2. `browser_console_messages` after first paint — must contain zero
   `error` entries.
3. `browser_evaluate` with `() => assetsReady === true && atlas?.complete && atlas.naturalWidth > 0`
   to confirm the atlas loaded.
4. Click the Start button if present (`browser_click`), wait for the
   gameplay scene to settle.
5. `browser_take_screenshot` and present it to the user.

### Static checks

- HTML parses without JS errors (the verifier covers this).
- Atlas reachable at the expected URL (verifier covers this).
- All required sprite names defined in the `SPRITES` literal (grep).
- Fallback paths exist (`if (!ok)` blocks) in every `drawX`.
- Game's existing test suite still passes (`bun test` if applicable).

**Don't use `node --check <file.html>` to syntax-check the game.** On
this machine `node` is shimmed to `bun`, and `bun <file.html>`
silently starts a frontend dev server on port 3000 — which then binds
to `[::1]:3000` and *shadows the guardian* for any
`http://localhost:3000/...` request. If you need a JS syntax check,
extract the inline script(s) to a `.js` file first, then run a real
JS parser against that. The reskin verifier above tests something
more useful (no runtime errors) without this trap.

### Visual playtest

Open the game in a browser. Verify each entity renders correctly through
its full state space:

- Player tilts when moving, returns level when stationary.
- Hit-flash shows the right variant for the right number of frames.
- Multi-frame animations play smoothly without skipping or repeating.
- Tier variants are visually distinct (size + color + glow).
- Mirroring doesn't cause visual jumps.
- State swaps don't cause size jumps (this is where bbox-ratio /
  override math gets dialed in).
- Damage tints scale smoothly with HP.

### Iterate

Bugs caught in QA generally fall into:

1. **Wrong sprite size on state swap** → adjust the override `wMul` /
   `hMul` for the variant.
2. **Position drift on state swap** → add `xOffset` / `yOffset` to the
   override.
3. **Animation frame timing off** → tune `FRAMES_PER_TICK`.
4. **Missing fallback** → game errors when atlas fails to load; add the
   `if (!ok)` branch with the canvas-drawn fallback.
5. **Wrong sprite picked** → bug in the swap logic (e.g. condition
   inverted, frame counter not reset).
6. **Variant looks bad despite tuning** → consider removing the
   variant entirely. Particles + screen shake usually carry hit-feedback
   well enough on their own; a poorly-aligned sprite swap can look
   worse than no swap.

### When to escalate

If after 2–3 QA iterations a visual bug isn't resolving, escalate to the
human:

- Atlas content is fundamentally wrong (wrong art style, wrong scale)
  → regenerate atlas (back to Phase 3).
- Math doesn't reconcile (sprite center is at a non-obvious offset
  inside the bbox) → ask the human to manually pick override values
  from a side-by-side render comparison.
- Game's animation system needs structural changes (e.g. requires
  entity state the game doesn't currently track) → propose the refactor
  and pause for sign-off.

---

## Asset organization

Each game owns its assets in its own folder, with relative references
from the HTML:

```
<game-folder>/
├── index.html
├── assets/
│   └── <game>-atlas.png        # the sprite atlas
└── sprite-map.json             # build artifact: detected bboxes + names
```

Reference assets in code with relative paths inside the game folder:

```js
ATLAS.src = './assets/<game>-atlas.png';
```

Do NOT use paths like `../../assets/...` that reach outside the game
folder. Per-game asset folders mean each game is independently movable,
clonable, and publishable.

The `sprite-map.json` is a build artifact — useful for regenerating the
embedded JS literal if the atlas is regenerated, but not needed at
runtime since the literal is embedded in `index.html`. If the game is
deployed to a public host, filter `sprite-map.json` and similar dev
artifacts out of the upload.

---

## Common pitfalls

- **Don't generate the atlas first.** Phase 1 (the audit) determines
  what you ask for; skipping it produces atlases that don't match the
  game.
- **Don't trust the first generation.** Budget for 1–2 regens.
- **Don't pixel-align the grid in your math.** Image Gen rarely
  respects exact grid coordinates; use alpha-detection instead.
- **Don't make tier variants too similar in the prompt.** Spell out the
  visual differences concretely.
- **Don't forget animations.** Multi-frame sequences need explicit
  frame-by-frame description in the prompt.
- **Don't skip the fallback.** Atlas can fail to load; the canvas-shape
  fallback keeps the game playable.
- **Don't iterate past 2–3 prompt rounds.** Accept what you have and
  compensate in code — that's faster and more predictable than chasing
  a perfect atlas.
- **Don't compute override values from bboxes alone.** They're
  empirical. Render side-by-side comparisons and dial in by eye.
- **Don't hesitate to drop a variant that doesn't work.** If a state
  swap looks worse than no swap, particles and screen shake carry
  feedback fine on their own. Less is sometimes more.
- **Don't bake in dev artifacts to a public deployment.** The atlas's
  source sheet, design notes, sprite-map.json — these belong in the
  source repo but not on the production server.
- **Don't use the system Python 3.6 to call OpenAI.** Its bundled SSL
  cert chain fails handshake against `api.openai.com` with
  `CERTIFICATE_VERIFY_FAILED`. Use `/opt/homebrew/bin/python3.13` (or
  any 3.11+) for `gen_image.py` invocations. The shell+curl fallback
  works because system curl uses the OS keychain, not Python's
  bundled certifi.
- **Don't `node --check <file.html>` to syntax-check.** `node` is
  shimmed to `bun` in this environment, and `bun <file.html>` starts a
  frontend dev server on port 3000 that shadows the guardian for
  `http://localhost:3000/...` requests. Symptom: every guardian route
  suddenly returns the game's HTML. To recover, find the rogue process
  with `lsof -nP -iTCP:3000 -sTCP:LISTEN` and kill it.
