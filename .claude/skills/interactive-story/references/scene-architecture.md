# Scene architecture

This is the layered scene model the template uses, and why each layer exists. Read this when you're laying out new hotspots, debugging a tap that doesn't fire, or deciding whether something belongs as part of the background or as a separate element PNG.

## The layered scene

Every scene is composed of these layers, stacked from bottom to top inside `#scene-frame`:

```
[ background image (#scene-bg) ]      ← full-bleed painted scene, NO moving things in it
[ tap zones (left/right invisible) ]  ← prev/next page navigation
[ hotspot elements (#hotspots > .hotspot) ]
                                      ← 3-5 transparent PNGs positioned absolutely
                                      ← each runs an ambient infinite loop
                                      ← tap → stronger one-off animation, then settles back
[ narrator paper strip (#narrator) ]  ← bottom of frame, watercolor paper texture, large text
[ chrome (home, scene dots, title) ]  ← always-visible navigation, stays fixed during transitions
```

The whole `#scene-content` block (background + tap zones + hotspots + narrator) slides horizontally during page transitions. The chrome stays put.

## Why moving things must be SEPARATE from the background

This is the single most important architectural decision. When the kid taps the swing and the painted swing in the background can't move, the tap feels broken. So the background is painted **without** the moving things, and each moving thing is generated as its own transparent PNG positioned absolutely over the background.

That's why the asset pipeline produces 1 background + N element PNGs per scene rather than one big composite scene. Each element gets its own `<img>` inside a `<button class="hotspot">`, free to ambient-bob and tap-flap independently.

When you write the background prompt, **explicitly tell the image generator which elements NOT to paint in**. Otherwise it'll paint them anyway and you'll have ghost-doubles when the element PNG composites on top.

## Frame aspect ratio

The `#scene-frame` is locked to a 2:3 portrait letterbox via the `min(...)` calc in CSS. This is mobile-first — kids hold tablets in portrait mode while reading bedtime stories. The frame:

- Caps at 720×1080 on desktop so it doesn't look like a giant billboard
- Uses `100dvh` (dynamic viewport height) to play nicely with the iOS Safari address-bar dance
- Centers in a dark background (`#2b2018`) that simulates a dim bedroom

If the kid asked for landscape (e.g., a comic strip), flip the constants to 3:2:

```css
width:  min(100vw, calc(100dvh * 3 / 2), 1080px);
height: min(100dvh, calc(100vw * 2 / 3), 720px);
```

And generate landscape backgrounds (1536×1024 source) instead of portrait (1024×1536 source).

## Scene data schema

Each scene in the `SCENES` array is a plain object:

```js
{
  id: 1,                                     // 1-based, matches asset filenames
  bg: 'assets/scene-1-bg.png',               // background image
  alt: 'Description of scene for screen readers',
  text: 'Narrator text shown on the paper strip.',
  hotspots: [
    {
      slug: 'rocket',                        // used for assets/scene-1-rocket.png AND aria-label
      x: 0.05, y: 0.05, w: 0.13,             // fractional position [0..1] of scene-frame; w sets size
      ambient: 'flutter',                    // ambient class (without "ambient-" prefix)
      tap: 'rocket-fly',                     // tap class
      opacity: 0.85,                         // optional — for translucent elements like glows
      blend: 'screen',                       // optional — 'screen' for glows over dark, 'multiply' for shadows
    },
  ],
}
```

`x`, `y`, `w` are fractions of the scene frame, not pixels. The element's height is computed automatically from the image's natural aspect ratio (`height: auto` in CSS). Pick `w` to feel right; if the element looks too tall, the image's aspect ratio is what's making it tall — re-crop the source PNG.

## Hotspot count and placement

**3-5 hotspots per scene is the sweet spot.** Fewer feels under-decorated; more crowds the scene and makes any one tap feel less rewarding. Each hotspot is an opportunity for delight — make every one count.

Place hotspots **away from the main character.** If the kid taps "the kid in the painting," nothing happens (the kid is part of the background) — that's confusing. Put taps on environment, props, sky elements, glows, secondary characters. The painted main character should feel like the camera, not a button.

Touch targets should be ≥ 44×44 px after the frame scales. With `w: 0.13` on a 720px-wide frame, that's ~94px wide — well over the threshold. If you find yourself using `w: 0.05` or smaller, the element will be hard to tap. Either crop the source PNG tighter so a larger `w` still looks proportional, or pick a different element.

### Positioning heuristics — when you can't see the background yet

In unattended (guardian build job) flow, you're picking `x`/`y`/`w` for hotspots before any background image exists. Use these zone heuristics — they tend to produce sensible layouts most of the time, and the kid won't notice 5% offsets:

- **Sky / atmospheric elements** (clouds, sun, stars, moon, kites, balloons, flying things) — place along `y ∈ [0.04, 0.20]`, with `x` spread across the top half of the frame
- **Mid-scene companions** (a friendly creature, a glowing orb, a doorway) — `y ∈ [0.30, 0.50]`, often `x ∈ [0.55, 0.85]` so they're visible alongside (not on top of) the painted main character
- **Foreground props** (flowers, bushes, lily pads, small ground critters) — `y ∈ [0.55, 0.78]`, spread across the bottom half
- **Bottom decorations** (water sparkles, grass tufts) — `y ∈ [0.78, 0.92]`, never below `y: 0.92` because the narrator strip sits at the bottom 4-12% of the frame
- **Avoid the rectangle `x ∈ [0.20, 0.55], y ∈ [0.30, 0.70]`** — that's where the painted main character usually lands. Read the bg-prompt's composition notes to confirm.
- **Width**: 0.10-0.16 for small props, 0.16-0.30 for mid-size things, 0.30-0.45 for big drifting elements (whale-clouds, big floating islands)

When a background does exist (attended flow, scene 1 review), open the page in a browser and eyeball the positions — these heuristics get you 80% of the way; visual tuning gets the last 20%.

## Ambient + tap pattern

The page is **alive** even when nothing is tapped. Every hotspot runs an ambient infinite-loop (a bob, sway, glow-pulse, flutter, drift). Without ambient motion, the scene feels like a static screenshot.

When tapped, the ambient class stays applied, and a `tap-*` class is added on top for ~3-4 seconds. The tap class uses `forwards` fill mode and a stronger transform (rocket flies away, dragon flaps wings, lamp flickers). After the tap class is removed, the ambient loop resumes.

Pick the ambient + tap pair by the element's character:
- **Solid floating thing** (rocket, balloon, kite) — `ambient: flutter` or `bob-soft`, `tap: rocket-fly` or `balloons-up` or `bird-fly`
- **Pendulum-y thing** (swing, lamp on chain, hanging sign) — `ambient: sway-soft`, `tap: swing-arc`
- **Glowing thing** (orb, lamp, magic sparkles) — `ambient: glow-pulse`, `tap: lamp-flicker` or `sparkle-burst`
- **Small detail** (pencil on a desk, cup on a table) — `ambient: sway-soft` or `bob-soft`, `tap: wiggle`
- **Ambient particles** (dust, fog, snow) — `ambient: drift-slow`, `tap: sparkle-burst`
- **Door / page / window** — `ambient: glow-pulse` (subtle), `tap: door-open` / `page-turn` / `window-glow`
- **Water / fountain** — `ambient: sway-soft`, `tap: splash`
- **Vehicle** (train, tram, car) — `ambient: bob-soft`, `tap: train-go`

Each animation in the template is documented inline by name. To add a new one, append a `@keyframes` block plus a `.<name> { animation: ... }` rule to the CSS, then reference it from the scene data. Tap classes should use `forwards` so they hold their final visual state momentarily before the JS removes the class and the ambient loop resumes.

## The "tap me" hint

After 4.5 seconds of inactivity on a fresh scene, a random hotspot gets a `hint-pulse` class for ~3 seconds — a soft scale + glow. This is the single most important UX-discoverability moment in the story: kids who don't immediately tap need a cue. The hint clears the moment they tap anything (the timer is canceled in `triggerTap`).

Don't make the hint too aggressive. The pulse is meant to be a wink, not a billboard. If a tester says "I felt nagged," soften the keyframes.

## Glow / particle elements

For elements meant to *radiate* light (a glowing orb, drifting magical particles), use:

```js
{ slug: 'orb', x: 0.62, y: 0.13, w: 0.18, ambient: 'glow-pulse', tap: 'sparkle-burst', opacity: 0.65, blend: 'screen' }
```

The `blend: 'screen'` causes the element's bright pixels to add to the background rather than replace it — soft glows look much more natural this way. The trade-off: dark pixels in the element become invisible. So the source PNG should be a glow on a dark/transparent background, with no dark outlines you want preserved.

`opacity` < 1 is useful when the element is meant to be a faint ambient effect (drifting particles, distant stars) rather than a solid object.

## Title overlay

Every story opens with a title card overlay. The kid taps anywhere (or presses any key) to dismiss. The card uses watercolor paper styling and fades out smoothly.

Edit `<h1>` in `#title-overlay .title-card` to set the title. The subtitle ("Tap to begin") can be customized to match the story's voice ("Open the book", "Once upon a time...", "Begin →").

## Navigation behavior

- **Tap left/right edge** (`#tap-prev`, `#tap-next` — invisible 25%-wide buttons): prev/next page
- **Swipe left/right** (touchstart/touchend): prev/next page; threshold is 50px to avoid accidental swipes
- **Arrow keys** (← / →): prev/next page
- **Scene dots** at top: visual indicator of which page you're on (decorative, not clickable — kids tend to find them by accident otherwise)
- **🏠 home button** at top-left: back to `/` (the lobby)
- **Page transitions:** scene-content slides off, snaps to the opposite side, slides back to center. ~280ms total. The chrome stays in place.

## What to NOT add

- **Audio** — feasible but out of scope for the v1 template. If the kid asks for sound, you can add it, but the template doesn't ship audio support.
- **Branching narrative** — every kid sees the same pages in the same order. If the kid asks for "choose your own adventure," that's a different skill.
- **Drag interactions** — the template only supports taps. Adding drag breaks the touch-swipe gesture.
- **Persistent state** — no save-progress, no accounts, no cookies. The story starts fresh every time.
- **Fail states** — no "wrong answer," no "you lose," no negative framing. Kids cannot get stuck.

## Failure modes

- **Element PNG fails to load** → background still works, the hotspot button is still there but invisible. The kid can still navigate. Log the failure but don't break the page.
- **Background fails to load** → the loading overlay stays up. The kid sees "Loading..." until the timeout triggers. Add a friendly fallback if you want to be polished.
- **No scenes loaded** → narrator says "No scenes yet — check back soon!" Kid can't navigate but isn't broken.
