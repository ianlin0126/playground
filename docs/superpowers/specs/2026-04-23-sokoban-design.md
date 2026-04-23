# Sokoban — Design Spec
**Date:** 2026-04-23
**Target player:** Clive, age 7

---

## Overview

A single-file browser Sokoban game. The player guides a 🐱 cat around a grid, pushing 📦 boxes onto 🐟 fish targets. All visuals are emoji and CSS — zero image assets. 12 hand-crafted levels with a smooth difficulty ramp. Built to the same standards as other playground games: self-contained `index.html`, mobile-first, kid-friendly tone, positive-only feedback.

---

## Gameplay Mechanics

**Goal:** Push every 📦 box onto a 🐟 fish target. When all targets are covered, the level is complete.

**Rules:**
- The cat moves one cell per input, in the four cardinal directions.
- If a box is in the direction of movement and the cell beyond it is empty floor, the box slides one cell.
- Boxes cannot be pulled — only pushed.
- A box pushed into a corner with no exit is permanently stuck. The player must undo or restart.
- Walls (`🧱`) block all movement.

**Cell types:**

| Symbol | Meaning |
|--------|---------|
| `#` | Wall |
| `.` | Empty floor |
| `@` | Cat start position |
| `$` | Box |
| `X` | Fish target (empty) |
| `*` | Box already on target |
| `+` | Cat standing on a target |

---

## Controls

**Mobile (primary):** Swipe anywhere on the board — dominant axis wins. `touchstart` records position; `touchend` computes `dx`/`dy`; whichever absolute value is larger determines direction; cat moves one cell.

**Keyboard (desktop):** Arrow keys and WASD, bound via `keydown`.

**No pointer/click movement** — swipe only on touch, keys on desktop.

---

## Viewport & Auto-Follow

The board is a CSS grid inside a fixed-size `overflow: hidden` wrapper sized to the available screen area. The inner grid div is positioned with `CSS transform: translate(x, y)` to pan it. After every move, the translate values are recalculated to keep the cat cell centered in the wrapper. The player never manually scrolls — the map follows the cat automatically. Using `transform` rather than `scrollLeft`/`scrollTop` is required because `overflow: hidden` containers are not scrollable, and `transform` is also hardware-accelerated and smooth on iOS Safari.

---

## Undo & Restart

**Undo (↩):** Maintains an array of `{ playerRow, playerCol, boxes: [[r,c], ...] }` snapshots. Each valid move pushes a snapshot before applying the move. Undo pops the last snapshot and restores state. Capped at 200 entries. The undo button is always visible and prominent.

**Restart (🔄):** Resets the current level to its initial state and clears the undo stack.

---

## Level Progression

12 hand-crafted levels in four difficulty bands. Each level is stored as an array of strings using standard Sokoban notation.

| Band | Levels | Grid size | Boxes | Focus |
|------|--------|-----------|-------|-------|
| Intro | 1–3 | 5×5 | 1 | Teaches pushing; no traps possible |
| Easy | 4–6 | 6×6 | 2 | Introduces planning; one gentle corner trap |
| Medium | 7–9 | 7×7 | 2–3 | Corner traps, tight corridors |
| Hard | 10–12 | 8–10 × 8–10 | 3–4 | Scrollable board, multi-step sequences |

Levels are stored as a JS array at the top of the script. Each entry:
```js
{
  id: 1,
  name: "Fishy Snack",          // short flavour name
  grid: [
    "#####",
    "#@$X#",
    "#####",
  ]
}
```

---

## UI Layout

```
┌─────────────────────────────────┐
│  Level 4/12  🐱 Find the fish!  Moves: 14  │  ← HUD (fixed)
├─────────────────────────────────┤
│                                 │
│         Board (scrollable       │
│         container, cat-centred) │
│                                 │
├─────────────────────────────────┤
│  [↩ Undo]  [🔄 Restart]  [📋 Levels]  │  ← Controls (fixed)
└─────────────────────────────────┘
```

- **HUD:** level counter, flavour message, move count. Fixed at top.
- **Board:** flex-centered, `overflow: hidden`, auto-scroll to cat after each move.
- **Controls bar:** fixed at bottom. Undo (red accent), Restart (neutral), Levels (neutral).

---

## Level Select Overlay

Triggered by the 📋 Levels button. Full-screen overlay showing 12 level buttons in a grid:
- Completed levels: show ✅ and are tappable.
- Current level: highlighted.
- Future locked levels: show 🔒 and are not tappable.
- Tapping a completed level loads it immediately.

---

## Win Screen

On completing a level, a cheerful overlay appears:
- Levels 1–11: "🎉 Nice one! Ready for the next?" + **Next Level** button.
- Level 12 (final): "🏆 You're a Sokoban master! Amazing!" + **Play Again** (goes to level 1) button.
- Move count shown ("You did it in 23 moves!").
- Positive language only — no "Game Over", no "Failed".

---

## Architecture

Single `games/sokoban/index.html` — all CSS and JS inline, zero external dependencies. IIFE wrapping all JS. All event handlers via `addEventListener` — no `onclick=` attributes. Works on iOS Safari.

**Key data structures:**
```js
var level      // current parsed level: { rows, cols, walls, targets, boxes, playerRow, playerCol }
var undoStack  // array of { playerRow, playerCol, boxes } snapshots
var moves      // integer move counter
var won        // boolean
```

**Render loop:** Called after every state change. Rebuilds the board DOM (clears `innerHTML`, re-renders all cells as `div` elements with emoji text content). Immediately followed by the auto-scroll centering call.

---

## File Location

`games/sokoban/index.html`

Update `games/manifest.json` to include `{ "name": "Sokoban", "slug": "sokoban" }`.
