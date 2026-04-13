# Mobile-Responsive Design Spec

**Date:** 2026-04-13
**Scope:** `index.html` (hub page) and `games/uno/style.css` (UNO game)
**Approach:** CSS custom properties + fluid scaling (Option A)

---

## Goals

Make all existing UI fit correctly on mobile phones and tablets in both portrait and landscape orientations, with no JS changes required.

---

## Breakpoints

| Name | Condition | Card size |
|---|---|---|
| Desktop (default) | > 1024px wide | 66×98px |
| Tablet landscape | 601–1024px + landscape | 72×107px |
| Tablet portrait | 601–1024px + portrait | 80×118px |
| Phone portrait | ≤ 600px | 52×78px |
| Phone portrait small | ≤ 390px | 44×65px |
| Phone landscape | max-height ≤ 500px + landscape | 44×65px + horizontal layout |

---

## CSS Variables

Defined on `:root`, overridden at each breakpoint:

```css
:root {
  --card-w: 66px;
  --card-h: 98px;
  --pile-w: 74px;   /* draw pile and discard pile */
  --pile-h: 110px;
}
```

All `.card`, `#deck-pile`, and `#discard-top .card` dimensions reference these variables. No duplicated numbers across breakpoints.

---

## UNO Game — Portrait Layouts

The existing vertical stack (turn banner → CPU hand → play area → player hand → message bar) is preserved across all portrait breakpoints. Only card sizes and gaps adjust via CSS variables.

The existing `@media (max-width: 520px)` block is replaced by the new breakpoint system.

---

## UNO Game — Phone Landscape Layout

When `orientation: landscape` and `max-height: 500px`, `#app` switches from flex column to CSS Grid:

```
grid-template-areas:
  "banner  banner  banner"
  "cpu     play    player"
  "msg     msg     msg"
grid-template-columns: 1fr  auto  1fr
grid-template-rows:    auto  1fr  auto
```

Grid area assignments:
- `#turn-banner` → `banner`
- `#cpu-section` → `cpu`
- `#play-section` → `play`
- `#player-section` → `player`
- `#message-bar` → `msg`

Additional landscape rules:
- Turn banner and message bar: height ~32px, font-size reduced to ~0.85em
- CPU and player `.hand` containers: `flex-wrap: nowrap`, `overflow-x: auto` — cards scroll horizontally rather than wrapping vertically
- Play section: flex-direction switches to `column` (stacks draw pile, discard, color dot vertically in center column)
- `#play-section` gap reduces to 12px

---

## Hub Page (`index.html`)

Three targeted changes — no structural changes:

1. Game card width: `200px` → `min(200px, 80vw)` — prevents clipping on narrow phones
2. `h1` font-size: `48px` → `clamp(32px, 8vw, 48px)` — smooth scaling
3. Subtitle font-size: `22px` → `clamp(16px, 4vw, 22px)` — smooth scaling

---

## Files Changed

| File | Changes |
|---|---|
| `games/uno/style.css` | Replace existing `@media (max-width: 520px)` block with full breakpoint system using CSS variables; add landscape grid layout |
| `index.html` | Update `h1`, subtitle, and game card widths with fluid/clamped values |

---

## Out of Scope

- JS changes
- New games or features
- Animations or transitions changes
- Accessibility improvements beyond what responsive layout provides
