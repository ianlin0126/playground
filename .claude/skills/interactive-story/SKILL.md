---
name: interactive-story
description: >
  Build interactive watercolor picture books for kids — single-file HTML with
  tap-able animated hotspots, ambient motion, narrator text, and gentle page
  navigation. Use whenever building a "story", "picture book", "storybook",
  "bedtime book", "illustrated story", "tap-through story", "kids book",
  "interactive narrative", or "scene-by-scene tale" — anything where the kid
  taps through painted scenes without win/lose mechanics. Also triggers when
  processing a guardian build job whose spec.md describes a narrative
  experience (a beginning/middle/end, a character moving through scenes)
  rather than a game (score, levels, win condition). Defaults to watercolor +
  8 scenes + 3-5 hotspots per scene; bends to fit other formats (4-scene
  comics, fewer hotspots, other art styles like comic-book ink or paper
  cutout). Output is one self-contained `games/<slug>/index.html` plus
  per-scene background and element PNGs in `games/<slug>/assets/`.
---

# Interactive Story Builder

A skill for building tap-through illustrated stories that feel like bedtime picture books. Each scene is a painted background with 3-5 transparent-PNG elements layered on top, each running an ambient animation and a stronger one-off animation when tapped. The kid swipes (or taps the edges, or presses arrow keys) to turn pages.

This is the architecture used to build [Clive Imagines](../../../games/clive-imagines/) — a watercolor 8-scene story about a kid whose imagination becomes real. Re-read that game's `design.md` and `index.html` if you want a worked example to anchor on.

## When to use

Reach for this skill any time the kid is asking for a *story* rather than a *game*. Specifically:

- Direct asks: "build me a storybook," "make a picture book about a dragon," "an interactive story about my dog," "a bedtime book where I'm the main character"
- Spec.md cues: the `## Concept` section talks about a character experiencing something across scenes, with no win/lose condition, no score, no levels-as-difficulty
- Indirect cues: the kid wants to "read" or "tap through" something rather than "play" it; they describe the *story* not the *mechanics*; they ask for "scenes" or "pages" or "chapters"

If the kid asks for something genuinely game-like (jumping, scoring, dodging, racing, fighting), you're in the wrong skill. Stop and use the regular game-building flow instead.

## Two contexts you might be running in

The behavior of "show the user, iterate, approve" later in the recipe depends on whether there's a human in the loop:

- **Unattended — guardian build job.** A `.guardian/jobs/<id>.json` arrived; the kid is on Telegram waiting; nobody can review intermediate output. Read `games/<slug>/spec.md` (the synthesizer wrote it), generate every asset in one pass, write everything, ship it. Skip the "show the user" pauses. If a generation looks bad (response < 50 KB, broken file), regenerate that one asset; don't try to "iterate on style." Trust the first plausible output and let the kid + parent give feedback through the next round.
- **Attended — parent in Claude Code.** A parent ran `claude` and said "build a storybook for [kid]" or similar. There's no spec.md yet; you talk through it directly. Pause for approval after the character sheet and after scene 1; iterate freely on style; THEN batch the rest.

The recipe below is written for the attended case (more steps, more pauses). When you're in the unattended case, collapse the "show the user" steps into a single pass and proceed.

## What this skill produces

```
games/<slug>/
├── index.html                          # one self-contained file, no build step
├── design.md                           # the design spec (what scenes, what hotspots)
└── assets/
    ├── <character>-character-sheet.png # if the story has a recurring character
    ├── scene-1-bg.png, scene-2-bg.png, ...
    └── scene-1-<element>.png, ...      # one transparent PNG per moving thing
```

The `index.html` is built from `assets/story-template.html` in this skill — copy it, then fill in the title, the SCENES array, and (optionally) any new ambient/tap CSS animations the kid's story needs.

## The high-level recipe

1. **Capture intent.** Read the spec.md (if processing a guardian build job) or talk through what the kid wants directly. Decide:
   - **Title** of the story
   - **Slug** (kebab-case, used for the folder and asset filenames)
   - **Number of scenes** — default 8; adjust to 4 for comic strips, 12 for longer books
   - **Hotspots per scene** — default 3-5
   - **Recurring character** — is there one? Who? Do you have a reference photo?
   - **Art style** — default warm watercolor; bend if the kid asked for comic-book / pixel-art / paper-cutout / etc.
   - **Aspect ratio** — default 2:3 portrait (mobile-first); flip to 3:2 landscape if the kid asked for a comic strip

2. **Write the design spec.** Lay out each scene as a row in a table (see Clive Imagines's `design.md` for the canonical format). For each scene capture: scene description, narrator text (1-2 short sentences), and the 3-5 hotspot elements. This is the artifact the asset pipeline operates on. Save to `games/<slug>/design.md`.

3. **Scaffold the page.** Copy `assets/story-template.html` from this skill to `games/<slug>/index.html`. Update the `<title>`, the title-overlay `<h1>`, and leave the `SCENES = []` array empty for now. **If aspect ratio is non-default** (e.g., 3:2 landscape for a comic strip), flip the `#scene-frame` `width` and `height` `min(...)` calc constants now — see `references/scene-architecture.md` §Frame aspect ratio. Add a manifest entry — read the existing `games/manifest.json` to learn the entry shape and append a row in the same format. Open the URL — you should see a "No scenes yet" message inside the empty letterbox.

4. **Generate the character sheet** (if applicable). Skip this if there's no recurring character. Otherwise, see `references/asset-pipeline.md` for the prompt structure and curl call. **Show the user the result and iterate** until the character looks right. This step matters — every later scene uses this image as a reference, so a wrong character here multiplies its mistake N times.

5. **Generate scene 1.** One painted background (with the moving things explicitly excluded) plus 3-5 transparent-PNG elements. **Show the user.** Confirm the watercolor style locks in; confirm the elements composite cleanly; confirm the character is consistent. Iterate on scene 1 before continuing — style drift is the most expensive bug to fix later.

6. **Wire scene 1 into the SCENES array.** Pick `x`, `y`, `w` for each hotspot to position it nicely over the background. Pick `ambient:` and `tap:` classes that match each element's character (rocket → flutter + rocket-fly; lamp → glow-pulse + lamp-flicker). See `references/scene-architecture.md` for the matchings.

7. **Verify scene 1 in a browser.** Open it on the LAN URL or `http://localhost:3000/games/<slug>/`. Tap every hotspot. Confirm ambient motion is gentle, tap motion is rewarding, and the page transitions to a "No more scenes" state when you swipe past it.

8. **Generate scenes 2-N in batch.** Loop through the remaining scenes generating background + element PNGs. The asset pipeline reference has a worked bash loop. Don't run in parallel — the API rate-limits.

9. **Wire scenes 2-N.** Add each to the SCENES array. Test as you go.

10. **Final polish.** Verify on a phone-sized viewport (≤ 400px wide), confirm all images load without console errors, confirm the title overlay dismisses smoothly, confirm the home button returns to `/`. Add the manifest entry if you haven't yet.

## Reference files

| File | Read when |
|---|---|
| `assets/story-template.html` | At step 3 — copy as the starting point for `index.html`. The CSS animation library (ambient + tap keyframes) is inline; pick from there or extend. |
| `references/scene-architecture.md` | At step 6 — when picking hotspot positions, opacity/blend modes, ambient + tap pairings, and understanding why elements must be separate from backgrounds. |
| `references/asset-pipeline.md` | At steps 4, 5, 8 — the curl-based generation calls, the watercolor style prompt, the reference-image flow for character consistency, and the manual-fallback path when no API key is configured. |

## Defaults to start from

When the kid hasn't specified, use these defaults. They're not rules; they're a starting point that produces something polished, and you bend any of them when the kid's request points elsewhere.

| Knob | Default | When to change |
|---|---|---|
| Aspect ratio | 2:3 portrait | Comic strip → 3:2 landscape |
| Scene count | 8 | Bedtime quickie → 4-6; sprawling story → 10-12 |
| Hotspots per scene | 3-5 | Younger kid (4-5yo) → 2-3 (less to track); older kid (9-10yo) → 5-7 |
| Art style | Warm watercolor | Comic strip → bold ink + flat color; sci-fi → digital painting; collage → paper cutout |
| Frame size cap | 720×1080 desktop | Larger if the audience is sitting back from a big tablet |
| Page transition | 280ms slide | Slower (450ms) if the kid is ≤ 5; gentler feels less jumpy |

## What makes a good story for this format

The single biggest authoring decision is **what happens between pages**. The format is a sequence of static-ish scenes; it can't render continuous motion. Stories that work:

- **Episodic journeys** — each scene is a stop on a trip (Clive Imagines: bedroom → sketchbook → AI appears → playground → city → world → bed)
- **Day-in-the-life** — morning, noon, afternoon, evening, bedtime
- **Building / growing** — each scene shows more of something appearing
- **Visiting friends** — each scene is a different friend's place
- **Discovering** — each scene reveals more of a mystery

Stories that *don't* work in this format:

- **Continuous chase / battle / race** — needs frame-by-frame motion, not snapshots
- **Branching choices** — every kid sees the same scenes in the same order
- **Open exploration** — there's a fixed sequence; the kid can't go off-trail

If the kid is asking for something the format can't do, suggest the closest thing it CAN do. "Want to chase a shark? I can make a 6-scene book where each scene shows a different sea creature you swim past — would that work?"

## Voice — narrator text

The narrator strip is small and the text is large. Aim for **1-2 short sentences per scene, max ~150 characters.** Read the text out loud — if it doesn't fit a parent's bedtime cadence, it's too long.

Match the kid's language register. Use simple words; ~Grade 1-2 reading level for ages 6-8. Avoid abstractions. Concrete actions and concrete things. Past tense feels more storybook-y than present tense, but either works.

The narrator's voice should feel **warm and quiet**, not hyperactive. This is bedtime media. Save the high-energy emoji + caps for the guardian's chat replies; the story itself reads like a real picture book.

## Verification (definition of done)

Before you tell the kid the story is ready, confirm:

- [ ] Every scene has a background, narrator text, and 3-5 hotspots that all load
- [ ] Tapping every hotspot triggers a tap animation that visibly differs from the ambient loop, then settles back
- [ ] Swipe / arrow / tap-zone navigation all work; you reach the last page and stop there cleanly
- [ ] The character (if any) looks like the same kid across every scene
- [ ] No console errors; no broken image icons
- [ ] On phone-sized viewport (≤ 400px), the frame still feels right (not crushed, not letterboxed weirdly)
- [ ] Manifest entry added; the story shows up at `/` (the lobby) with the right name
- [ ] Title overlay dismisses on tap or any keypress
- [ ] Returning to `/` from the home button works

## Failure recovery

- **API generation produces a janky element** (white halos, ghost double, weird limbs) → regenerate just that one PNG. Don't regen the whole scene.
- **Character drifts between scenes** → tighten the character-sheet prompt, regenerate the character sheet, then regenerate any scene where the drift is visible. Don't try to "fix" it in code.
- **Backgrounds have the moving things painted in** → re-prompt explicitly listing every moving element under "DO NOT include" and regenerate the background.
- **Style drift between scenes** → check that the STYLE PROMPT is appended verbatim to every prompt. Even a one-word change can shift the output noticeably.
- **A hotspot is too small to tap reliably** → increase its `w` value (the source PNG can crop tighter); or drop it and add a larger element.

## What this skill does NOT do

- **Audio** (background music, narration, tap SFX) — feasible to add but not in the v1 template. Don't ship audio without explicit user request.
- **Branching narrative** — every kid sees the same scenes in the same order. Save "choose your own adventure" for a different skill.
- **User-generated content** — the kid can't draw their own scenes or add their own pages. Persistence is intentionally not part of the format.
- **Game mechanics** — no scoring, no fail states, no timers, no levels. If the kid is asking for those, you want a different skill.
- **Multi-language** — text is in whatever language the kid asked for, but localization (multiple languages in one file) isn't supported.
