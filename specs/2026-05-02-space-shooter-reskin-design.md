# Space Shooter Reskin — Design

**Status:** approved (brainstorming complete, awaiting implementation plan)
**Date:** 2026-05-02
**Target:** `games/space-shooter/index.html` (overwrites the existing 883-line game; `games/space-shooter-2/` is left untouched as a fallback)
**Audience:** kid-friendly mobile-first browser game (target age ~8)

## Goal

Replace the older `games/space-shooter/` Kenney-asset game with a polished reskin built on top of the better-architected `games/space-shooter-2/` codebase, using a custom-generated sprite atlas at `assets/space-shooter-atlas.png`. Use every gameplay-meaningful asset in the atlas (player tilts, shield bubble, multi-frame death, alien hit-flash, three boss tiers) and apply code-side polish so the result feels designed, not just swapped.

## Non-goals

- Sound effects or background music (no audio assets sourced; would be a separate project)
- Settings/options screen
- High-score persistence across sessions
- Multiple ship skins
- Refactoring `space-shooter-2/` itself

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope tier | **B — Reskin + full sprite-sheet usage** | Use everything in the atlas (shield, multi-frame death, 3-tier bosses, alien hit-flash); skip player-tilt cinematic and other "C-tier" extras |
| Target location | **Replace `games/space-shooter/` in place** | Old Kenney-art game is dated; `space-shooter-2` stays as a fallback in case the reskin underperforms |
| Boss tier mapping | **Cap at tier 3** (`bossNum` 1 → t1, 2 → t2, 3+ → t3) | Natural escalation; final form stays on screen as the "big bad" |
| Atlas iteration | **Accept v2 as-is with code-side gap-filling** | Two GPT Image 2.0 iterations; further iterations unlikely to fix layout drift |
| Asset distribution | **Single atlas + inline JS sprite-coordinate map** | Single-file HTML game stays portable; ~25-entry JS literal is ~1.5 KB |

## Atlas inventory (current state)

The accepted atlas at `assets/space-shooter-atlas.png` is 1024×1024 RGBA with transparent background. Sprite count: ~24–26 of 25 expected.

**Confirmed present:**
- 5 explosion frames (player destruction)
- 5 asteroid sizes
- Alien attacker + alien hit
- At least one pristine boss base sprite + multiple hit-state variants
- Bonus glowing star/coin sprite
- Two unshielded silver player ships + three shielded variants

**Gaps to fill in code:**
1. **Player idle (no-tilt)** — only ~5 player sprites; both unshielded silver ships look subtly tilted
2. **Boss tier color differentiation** — bosses are mostly green-tinted; tiers 2 and 3 are not visually distinct from tier 1 by base sprite alone
3. **Bullets/lasers** — not in the atlas

## Section 1 — Sprite atlas (existing asset)

The atlas at `assets/space-shooter-atlas.png` is the source of truth for art. The original GPT Image 2.0 prompt is preserved in this design doc for reference and for future regeneration if needed (see Appendix A). The sprite-coordinate map in code is the single point of integration; if the atlas is regenerated with a different layout, only the sprite-coordinate map needs updating.

## Section 2 — Animation timeline + gap-filling

### Gap 1: Player idle

Use the closest-to-level silver ship sprite as `player_level`. Use the more-tilted silver sprite as `player_tilt`, and mirror it via `ctx.scale(-1, 1)` for the right-tilt direction. Selection is driven by frame-to-frame `vx = ship.x - ship.prevX`:

| Condition | Sprite | Transform |
|---|---|---|
| `\|vx\| < 0.5` | `player_level` | none |
| `vx < 0` | `player_tilt` | none |
| `vx > 0` | `player_tilt` | `ctx.scale(-1, 1)` |

Same logic for the shielded variants when `shieldFrames > 0`.

### Gap 2: Boss tier visual escalation

Pick a single pristine boss base sprite (and its matching hit variant). Code applies a stacking effect per tier so the three tiers feel distinctly more dangerous despite using the same base art:

| Tier | Scale | Color tint | Glow ring | HP-bar palette |
|---|---|---|---|---|
| 1 | 1.00× | none | 0–6 px white | green → yellow |
| 2 | 1.15× | subtle red (`globalCompositeOperation: 'multiply'` with `#ff8060`) | 0–14 px orange | yellow → orange |
| 3 | 1.30× | strong red shift, slight pulse | 0–24 px red, pulsing | red, fast pulse |

If the boss row turns out to have two visually-distinct base sprites (green and darker), use the darker one for tier 3 and apply the technique above for tiers 1/2.

### Gap 3: Bullets/lasers

Continue drawing on canvas (already in the existing code). Retune to match the new palette:

| Bullet | Color | Glow | Shape |
|---|---|---|---|
| Player | cyan-blue `#42d7f5` | 12 px | tall capsule |
| Alien | hot orange `#ff6d00` | 10 px | smaller capsule |
| Boss | magenta `#ff4081` | 18 px | wider capsule, pulsing |

### Animation timeline

| Animation | Trigger | Frames | Duration | Notes |
|---|---|---|---|---|
| Player tilt | `vx` change | 1 frame | instant | swaps to nearest direction every frame |
| Shield bubble | `loseLife()` | hold | 60 frames (1 s) i-frames | shield-state sprite shown for the duration; player invincible |
| Death explosion | lives → 0 | 5 sequential frames | 6 frames each = 30 frames (0.5 s) | runs before game-over overlay |
| Alien hit-flash | bullet hits alien | hold | 6 frames (0.1 s) | swap to `alien_hit` sprite for the flash window |
| Boss hit-flash | bullet hits boss | hold | 6 frames (0.1 s) | swap to matching `boss_hit_tN` sprite |
| Boss arrival | spawn | slide + flash | 130 frames | reuse existing `bossAnnounceTimer`, retime visual cues |
| Coin pickup | asteroid death | continuous | spin + bob | star sprite replaces canvas-drawn `$` circle |

The 1-second shield-on-hit is real gameplay benefit — reduces "spam-death" feeling when asteroids cluster and matches what the asset implies.

## Section 3 — Asset extraction pipeline

### `tools/atlas-extract.py` (one-off dev tool)

Loads the atlas, runs alpha-channel connected-component detection to find each sprite's tight bounding box, and outputs a JSON template with `null` placeholder names. The human (developer) fills in the names by eyeballing rendered crops, then pastes the completed map as a JS literal into `index.html`.

```
python3 tools/atlas-extract.py assets/space-shooter-atlas.png \
  > /tmp/atlas-template.json
# … human labels each detected box
# Final labeled map is pasted into index.html as `var SPRITES = { ... }`
```

### Sprite map (final form, embedded)

```js
var SPRITES = {
  player_level:        { x: ..., y: ..., w: ..., h: ... },
  player_tilt:         { x: ..., y: ..., w: ..., h: ... },
  player_shield_level: { x: ..., y: ..., w: ..., h: ... },
  player_shield_left:  { x: ..., y: ..., w: ..., h: ... },
  player_shield_right: { x: ..., y: ..., w: ..., h: ... },
  explosion_1:         { ... },
  explosion_2:         { ... },
  explosion_3:         { ... },
  explosion_4:         { ... },
  explosion_5:         { ... },
  asteroid_1:          { ... },
  asteroid_2:          { ... },
  asteroid_3:          { ... },
  asteroid_4:          { ... },
  asteroid_5:          { ... },
  alien_normal:        { ... },
  alien_hit:           { ... },
  boss_base:           { ... },
  boss_base_hit:       { ... },
  // optionally boss_alt and boss_alt_hit if a second distinct base sprite is identified
  coin_star:           { ... },
};
```

### Drawing helper

```js
function drawSprite(name, dx, dy, dw, dh) {
  var s = SPRITES[name];
  if (!atlas.complete || atlas.naturalWidth === 0 || !s) {
    return false; // caller should fall back to canvas-drawn shape
  }
  ctx.drawImage(atlas, s.x, s.y, s.w, s.h, dx, dy, dw, dh);
  return true;
}
```

Game logic never references pixel coordinates directly — only sprite names. Existing `drawShip` / `drawAsteroid` / `drawAlien` / `drawBoss` functions are extended to call `drawSprite(name, ...)` first and fall back to their existing canvas paths if the atlas hasn't loaded.

## Section 4 — Polish features

### MUST (committed for the first PR)

| # | Item | What changes |
|---|---|---|
| 1 | Particle palette retune | bullet hit → cyan; asteroid death → orange + brown; alien death → purple + green; player damage → cyan + white; boss death → magenta + gold + white |
| 2 | Coin sprite | bonus star replaces canvas-drawn `$` circle, slow spin + gentle bob, gold glow on pickup |
| 3 | Boss tier escalation | scale + tint + glow ring + HP-bar color per tier (Section 2 detail) |
| 4 | Death sequence | 5-frame explosion plays at ship position before end-screen; ship sprite hidden during the animation |
| 5 | Boss arrival cinematic | screen darkens to 40 % black during the 130-frame announce, "BOSS INCOMING" pulses; tier 2/3 add small "TIER 2" / "TIER 3" subtext |
| 6 | Player tilt feedback | velocity-driven sprite swap with horizontal mirroring |
| 7 | Shield i-frames | 60-frame invincibility window; shield sprite shown for the duration |
| 8 | Screen shake retuning | small for bullet hits, medium for player damage, 30-frame strong shake on boss death |

### NICE (deferred)

| # | Item |
|---|---|
| 9 | Score-up floating text ("+5" rising and fading on score change) |
| 10 | 2-layer parallax stars (back: slow-dim, front: fast-bright) |
| 11 | Splash screen art refresh (boss sprite as hero image, retro chunky title) |
| 12 | HUD icon polish (hearts → mini shield bubbles, coin counter uses mini star) |

## File touch list

- **Created** `games/space-shooter/index.html` — the new game (overwrites existing)
- **Created** `tools/atlas-extract.py` — dev script for sprite extraction
- **Updated** `games/manifest.json` — `builtAt` timestamp on the `space-shooter` entry
- **Existing** `assets/space-shooter-atlas.png` — already saved
- **Untouched** `games/space-shooter-2/index.html` — fallback
- **Untouched** `assets/kenney_space-shooter-remastered/` — no longer used by `space-shooter/` but kept for `space-shooter-2/`

## Success criteria

The reskin is "done" when **all** of the following are true:

1. Game loads without console errors on iOS Safari and on a desktop browser.
2. Player ship visually tilts when moving left/right, returns level when stationary.
3. Hitting an asteroid or alien laser triggers the shield bubble for 1 second; player takes no damage during that window.
4. Losing the last life plays the 5-frame death explosion before the end screen appears.
5. Boss #1 visibly differs from boss #3 (size + color + glow + HP-bar palette).
6. Coin pickups use the star sprite (no canvas-drawn `$`).
7. Particle colors match the new palette in every collision context.
8. Boss arrival darkens the screen and pulses "BOSS INCOMING".
9. Atlas-coordinate map is generated by `tools/atlas-extract.py` (script committed) and embedded as a JS literal.
10. Game gracefully falls back to canvas-drawn shapes if `space-shooter-atlas.png` fails to load (no broken-image squares).

## Appendix A — GPT Image 2.0 prompt used for atlas v2

The atlas was generated with the following prompt; preserved here so it can be re-run if the atlas is ever regenerated.

```
Generate a 1024×1024 px PNG sprite atlas for a 2D space shooter
mobile game. The image MUST have a fully transparent background
(alpha channel) — no white, no color fill, no checker pattern.
The image MUST contain NO text, NO numbers, NO labels, NO captions,
NO legend, NO row or column headers — only the sprites themselves
and transparent space.

LAYOUT: a strict 5-row × 5-column grid. The image is divided into
25 cells of EXACTLY 204×204 pixels each. Every cell MUST contain
exactly one sprite — there are NO empty cells in this atlas. Each
sprite is centered in its cell with small consistent padding around
it. The sprites are listed below in reading order (left to right,
top to bottom), labeled by cell position (row, column) using zero-
based indexing.

CELLS — exactly one sprite per cell:

(0,0) Player ship, silver/gunmetal sci-fi fighter with glowing blue
      cockpit, FACING UP, perfectly level (no tilt, no banking).
(0,1) Same player ship, banking 15 degrees to the LEFT.
(0,2) Same player ship, banking 15 degrees to the RIGHT.
(0,3) The (0,0) level player ship wrapped in a translucent cyan
      hexagonal energy shield bubble surrounding the entire ship.
(0,4) The (0,1) banking-left ship wrapped in the same shield bubble.

(1,0) The (0,2) banking-right ship wrapped in the same shield bubble.
(1,1) Player destruction frame 1: small initial pop with sparks,
      ship still partially visible.
(1,2) Player destruction frame 2: bright orange and yellow primary
      explosion, ship gone.
(1,3) Player destruction frame 3: peak burst with debris flying out
      from the center.
(1,4) Player destruction frame 4: smoke and dim flames, fading.

(2,0) Player destruction frame 5: thin gray smoke and ash, mostly
      transparent, end of explosion sequence.
(2,1) Asteroid SIZE 1 — smallest pebble (~30% of cell), brown/gray
      rock with deep crater detail and irregular silhouette.
(2,2) Asteroid SIZE 2 — small (~50% of cell), same rocky style.
(2,3) Asteroid SIZE 3 — medium (~70% of cell), same rocky style.
(2,4) Asteroid SIZE 4 — large (~85% of cell), same rocky style.

(3,0) Asteroid SIZE 5 — largest, nearly fills the cell, same rocky
      style.
(3,1) Alien attacker — purple insectoid biomechanical ship, FACING
      DOWN (toward bottom of cell), with a jagged forward spike.
(3,2) Same alien attacker as (3,1), with a bright yellow-white
      impact flash overlay layered on top showing it taking damage.
(3,3) Boss tier 1 — green/teal fortress-style alien battleship,
      FACING DOWN, intimidating but the smallest of the three boss
      tiers, NO damage overlay.
(3,4) The same boss tier 1 from (3,3), with an orange explosion and
      damage-flash overlay layered on top showing it taking damage.

(4,0) Boss tier 2 — purple/red massive alien battleship, FACING
      DOWN, with multiple gun turrets, larger and more imposing
      than tier 1, NO damage overlay.
(4,1) The same boss tier 2 from (4,0), with the same orange
      explosion + damage flash overlay as in (3,4).
(4,2) Boss tier 3 — largest alien battleship, FACING DOWN, deepest
      red/black coloration, the most weapons and most threatening
      silhouette of the three tiers, NO damage overlay.
(4,3) The same boss tier 3 from (4,2), with the same orange
      explosion + damage flash overlay as in (3,4) and (4,1).
(4,4) Power-up icon — a glowing yellow-gold star with rays,
      generic collectible/coin pickup design.

STYLE: detailed digital painting / sci-fi illustration, sharp
outlines, dramatic rim lighting, saturated colors, consistent art
direction across all 25 sprites. NO drop shadows under sprites
(they composite cleanly on a black space background). NO
backgrounds within cells — only the sprite plus transparent empty
space. Every cell has roughly the same level of polish and detail.
```
