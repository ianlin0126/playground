# Mobile-Responsive Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `games/uno/style.css` and `index.html` fully responsive across phones and tablets in portrait and landscape orientations using CSS custom properties and a six-breakpoint system.

**Architecture:** CSS variables define card/pile dimensions at `:root`; each breakpoint overrides them. Phone landscape flips `#app` from a flex column to a named-area CSS Grid. Hub page gets three targeted fluid-sizing changes. No JS touched.

**Tech Stack:** Plain CSS (custom properties, CSS Grid, `clamp()`, `min()`). No build tools.

---

## Files

| File | Change |
|---|---|
| `games/uno/style.css` | Add `:root` CSS variables; wire card/pile sizes to them; replace `@media (max-width: 520px)` with full breakpoint set; add phone landscape grid layout |
| `index.html` | Update `h1`, subtitle, and `.game-card` width with fluid values |

---

## Task 1: Introduce CSS variables for card and pile dimensions

**Files:**
- Modify: `games/uno/style.css`

- [ ] **Step 1: Add `:root` variable block at the top of the responsive section**

Open `games/uno/style.css`. Find the line `/* ── Responsive ─────────────────────────────────────────────── */` (currently near the bottom). Replace everything from that comment to the end of the file with:

```css
/* ── Responsive ─────────────────────────────────────────────── */

:root {
  --card-w: 66px;
  --card-h: 98px;
  --pile-w: 74px;
  --pile-h: 110px;
}
```

- [ ] **Step 2: Wire `.card` dimensions to variables**

Find the `.card` rule (currently `width: 66px; height: 98px`). Update those two lines:

```css
.card {
  width: var(--card-w);
  height: var(--card-h);
  border-radius: 10px;
  border: 3px solid rgba(255,255,255,.75);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: stretch;
  padding: 4px 6px;
  font-weight: 900;
  box-shadow: 2px 3px 8px rgba(0,0,0,.5);
  position: relative;
  transition: transform .15s, box-shadow .15s;
  flex-shrink: 0;
  user-select: none;
}
```

- [ ] **Step 3: Wire `#deck-pile` dimensions to variables**

Find `#deck-pile` (currently `width: 74px; height: 110px`). Update those two lines:

```css
#deck-pile {
  width: var(--pile-w);
  height: var(--pile-h);
  border-radius: 10px;
  border: 3px dashed rgba(255,255,255,.35);
  background: repeating-linear-gradient(
    45deg,
    #c0392b 0px, #c0392b 9px,
    #e74c3c 9px, #e74c3c 18px
  );
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .12s, opacity .3s;
  box-shadow: 2px 3px 8px rgba(0,0,0,.5);
}
```

- [ ] **Step 4: Wire `#discard-top .card` dimensions to variables**

Find `#discard-top .card { width: 74px; height: 110px; }`. Update it:

```css
#discard-top .card { width: var(--pile-w); height: var(--pile-h); }
```

- [ ] **Step 5: Add grid-area names to app children**

These declarations are harmless in flex mode — they only activate when `#app` becomes a grid. Add `grid-area` to each of these five existing rules:

```css
#turn-banner {
  grid-area: banner;
  /* rest of existing properties unchanged */
}

#cpu-section {
  grid-area: cpu;
  /* rest of existing properties unchanged */
}

#play-section {
  grid-area: play;
  /* rest of existing properties unchanged */
}

#player-section {
  grid-area: player;
  /* rest of existing properties unchanged */
}

#message-bar {
  grid-area: msg;
  /* rest of existing properties unchanged */
}
```

- [ ] **Step 6: Verify desktop looks unchanged**

Open `games/uno/index.html` in a browser. Play a few turns. Cards, draw pile, and discard pile should look exactly as before. No layout shift.

- [ ] **Step 7: Commit**

```bash
git add games/uno/style.css
git commit -m "refactor(uno): introduce CSS variables for card and pile dimensions"
```

---

## Task 2: Add portrait breakpoints

**Files:**
- Modify: `games/uno/style.css`

- [ ] **Step 1: Add all portrait breakpoints after the `:root` block**

After the `:root` block added in Task 1, append the following. This replaces the old `@media (max-width: 520px)` block (which was deleted in Task 1 Step 1):

```css
/* ── Tablet portrait: 601–1024px ─── */
@media (min-width: 601px) and (max-width: 1024px) and (orientation: portrait) {
  :root {
    --card-w: 80px;
    --card-h: 118px;
    --pile-w: 90px;
    --pile-h: 132px;
  }
  #discard-top .card .c-mid { font-size: 2.5em; }
  .card .c-mid { font-size: 2.1em; }
}

/* ── Tablet landscape: 601–1024px ─── */
@media (min-width: 601px) and (max-width: 1024px) and (orientation: landscape) {
  :root {
    --card-w: 72px;
    --card-h: 107px;
    --pile-w: 80px;
    --pile-h: 118px;
  }
}

/* ── Phone portrait: ≤ 600px ─── */
@media (max-width: 600px) {
  :root {
    --card-w: 52px;
    --card-h: 78px;
    --pile-w: 60px;
    --pile-h: 90px;
  }
  .card .c-mid { font-size: 1.5em; }
  .card .c-tl, .card .c-br { font-size: 0.7em; }
  #discard-top .card .c-mid { font-size: 1.8em; }
  #play-section { gap: 16px; padding: 12px 16px; }
  .modal-box { padding: 28px 24px; }
}

/* ── Phone portrait small: ≤ 390px ─── */
@media (max-width: 390px) {
  :root {
    --card-w: 44px;
    --card-h: 65px;
    --pile-w: 52px;
    --pile-h: 76px;
  }
  .card .c-mid { font-size: 1.2em; }
  .card .c-tl, .card .c-br { font-size: 0.6em; }
  #discard-top .card .c-mid { font-size: 1.5em; }
  #play-section { gap: 10px; }
}
```

- [ ] **Step 2: Verify portrait layouts in browser DevTools**

Open `games/uno/index.html` in Chrome. Open DevTools → Toggle Device Toolbar (Ctrl+Shift+M / Cmd+Shift+M). Check each of these presets and confirm cards are visible and the layout is not clipped:

| Device preset | Expected |
|---|---|
| iPhone SE (375×667) | 52×78px cards, vertical stack fits |
| iPhone 14 Pro (393×852) | 52×78px cards, comfortable spacing |
| Galaxy S8+ (360×740) | 52×78px cards |
| iPad Mini (768×1024 portrait) | 80×118px cards, visible scale-up |
| iPad Air (820×1180 portrait) | 80×118px cards |

- [ ] **Step 3: Commit**

```bash
git add games/uno/style.css
git commit -m "feat(uno): add portrait breakpoints with CSS variable overrides"
```

---

## Task 3: Add phone landscape grid layout

**Files:**
- Modify: `games/uno/style.css`

- [ ] **Step 1: Append the phone landscape media query**

After the `@media (max-width: 390px)` block, append:

```css
/* ── Phone landscape: short viewport ─── */
@media (max-height: 500px) and (orientation: landscape) {
  :root {
    --card-w: 44px;
    --card-h: 65px;
    --pile-w: 52px;
    --pile-h: 76px;
  }

  #app {
    display: grid;
    grid-template-areas:
      "banner banner banner"
      "cpu    play   player"
      "msg    msg    msg";
    grid-template-columns: 1fr auto 1fr;
    grid-template-rows: auto 1fr auto;
    gap: 6px;
    height: 100vh;
    padding: 4px 8px;
  }

  #turn-banner,
  #message-bar {
    font-size: 0.85em;
    padding: 4px 16px;
    min-height: auto;
  }

  #cpu-section,
  #player-section {
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .hand {
    flex-wrap: nowrap;
    overflow-x: auto;
    min-height: auto;
    gap: 3px;
  }

  #play-section {
    flex-direction: column;
    gap: 8px;
    padding: 6px 12px;
  }

  .card .c-mid { font-size: 1.2em; }
  .card .c-tl, .card .c-br { font-size: 0.6em; }
  #discard-top .card .c-mid { font-size: 1.5em; }
}
```

- [ ] **Step 2: Verify landscape layout in browser DevTools**

In Chrome DevTools Device Toolbar, check these landscape presets:

| Device | Orientation | Expected |
|---|---|---|
| iPhone SE (667×375) | Landscape | 3-column grid: CPU left, play center, player right |
| iPhone 14 Pro (844×390) | Landscape | Same grid; hands scroll horizontally if many cards |
| Galaxy S8+ (740×360) | Landscape | Same grid |
| iPad Mini (1024×768) | Landscape | Tablet breakpoint applies (not this one — height > 500px) |

For the phone landscape cases: deal cards to both players, confirm the hand scrolls sideways rather than wrapping off-screen.

- [ ] **Step 3: Commit**

```bash
git add games/uno/style.css
git commit -m "feat(uno): add phone landscape CSS Grid layout"
```

---

## Task 4: Update hub page fluid sizing

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Update `h1` font-size**

In `index.html`, find:

```css
    h1 {
      font-size: 48px;
```

Change to:

```css
    h1 {
      font-size: clamp(32px, 8vw, 48px);
```

- [ ] **Step 2: Update subtitle font-size**

Find:

```css
    p.subtitle {
      font-size: 22px;
```

Change to:

```css
    p.subtitle {
      font-size: clamp(16px, 4vw, 22px);
```

- [ ] **Step 3: Update game card width**

Find:

```css
    a.game-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #fff;
      border-radius: 20px;
      width: 200px;
```

Change `width: 200px` to:

```css
      width: min(200px, 80vw);
```

- [ ] **Step 4: Verify hub page in DevTools**

Check these presets in Chrome DevTools:

| Device | Expected |
|---|---|
| iPhone SE (375 portrait) | Title and subtitle scale down, UNO card fills ~300px (80vw), no horizontal scroll |
| iPhone 14 Pro (393 portrait) | Similar, card ~314px wide |
| iPad Mini (768 portrait) | Title full 48px, card 200px centered |
| Desktop (1280px) | Unchanged from original |

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(hub): fluid font sizes and game card width for mobile"
```

---

## Task 5: Final cross-device smoke test

**Files:** None (verification only)

- [ ] **Step 1: Open both pages in DevTools and walk through all device presets**

Open `games/uno/index.html`. In DevTools Device Toolbar, cycle through:

- iPhone SE portrait → play a full game turn
- iPhone SE landscape → play a full game turn; draw 3+ cards and confirm hand scrolls
- iPhone 14 Pro portrait → play a turn
- iPhone 14 Pro landscape → play a turn
- iPad Mini portrait → verify cards are visibly larger than phone
- iPad Mini landscape → verify tablet landscape sizing (not the phone landscape grid)
- Desktop (no device emulation) → verify unchanged

Open `index.html`. Check:
- iPhone SE portrait → no horizontal scroll, title visible
- iPad → card centered at 200px

- [ ] **Step 2: Check color picker modal on phone landscape**

In phone landscape mode, trigger a Wild card play. Confirm the color picker modal is fully visible and the four color buttons are tappable (not clipped by the short viewport).

- [ ] **Step 3: Commit if any fixes were needed**

If Step 1 or 2 revealed issues, fix and commit before closing out:

```bash
git add games/uno/style.css index.html
git commit -m "fix(responsive): address smoke test findings"
```
