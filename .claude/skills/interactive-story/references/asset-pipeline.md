# Asset pipeline

How to generate the images this skill needs: a character sheet (if there's a recurring character), one painted background per scene, and a handful of transparent PNGs for the moving elements in each scene.

The default art direction is **warm watercolor children's storybook**, but every prompt below has a "STYLE PROMPT" line you can swap to change the look — comic-book ink, pastel digital, paper-cutout collage, photorealistic-but-dreamy, etc. The architecture stays the same; only the style words change.

## What this skill uses

OpenAI's Image API (`gpt-image-1`) called directly via curl. The same API used by the `game-assets` skill, but here we use it differently:

- `game-assets` builds **one big atlas** with all sprites on a grid. Right for canvas games where one image gets sliced and re-drawn many times.
- `interactive-story` builds **one PNG per asset** — each scene's background is its own file, each moving element is its own transparent PNG. Right for stories because each element is positioned with CSS and animated independently.

If the user has `OPENAI_API_KEY` in `.env`, generate via API. If not, write the prompts to disk and tell the user how to paste them into ChatGPT / their tool of choice.

## Style prompt

This is the watercolor anchor. Append it verbatim to **every** image prompt — backgrounds AND elements — to keep the look consistent across all scenes:

> "warm watercolor children's storybook illustration, soft edges, painted paper texture, gentle natural light, dreamy palette of pastels and warm earth tones, no harsh outlines, hand-painted look, in the style of classic award-winning picture books like those by Komako Sakai or Jon Klassen."

If the kid asked for a different style, replace the words but keep the *structure* (a couple of style adjectives + a "in the style of [reference]" line + a palette anchor). Examples:

- **Comic strip:** "bold cartoon comic-book illustration, thick clean ink outlines, flat color fills, halftone shading, in the style of Calvin and Hobbes or classic newspaper Sunday strips, palette: bright primary colors with cream paper backgrounds."
- **Paper cutout / collage:** "construction-paper cutout collage, visible torn paper edges, layered flat shapes, gentle drop shadows, in the style of Eric Carle's The Very Hungry Caterpillar, palette: saturated reds, oranges, greens, blues."
- **Pixel art:** "16-bit pixel art picture book scene, soft dithering, limited 32-color palette, painterly lighting, in the style of late-90s SNES adventure games, palette: warm sunset oranges and dusk purples."

## Asset-generation order

Generate cheaply and check often. The order matters because errors cascade — a character that looks wrong in scene 1 will look wrong in all 8 scenes if you batch.

1. **Character sheet** (if there's a recurring character — kid, pet, mascot)
2. **Scene 1 background** + scene 1's element PNGs
3. **Show the user.** Stop. The user looks at scene 1 and approves the look-and-feel. If anything's off, iterate before continuing.
4. **Scenes 2-N backgrounds** in batch (one per call)
5. **Scenes 2-N element PNGs** in batch
6. **Wire everything into the SCENES array** and verify

Don't batch all backgrounds before showing the user scene 1. The full atlas costs ~40 generations; if the style is wrong you've wasted half of them.

## Step 1 — Character sheet (if applicable)

If the story has a recurring character, generate a single watercolor portrait first. If the kid provided a reference photo (e.g., the parent uploaded a photo of their child), pass it as a reference image so the character looks like them.

**Prompt structure:**

```
Watercolor children's storybook portrait of [character description: age, hair, clothes, distinguishing features].
The character is centered, full body, facing forward, neutral pose, soft warm lighting.
Plain cream paper background with no other elements, no text.
[STYLE PROMPT — appended verbatim]
```

**API call** (writes the result to `games/<slug>/assets/<character>-sheet.png`):

```bash
set -a; . ./.env; set +a    # load OPENAI_API_KEY

SLUG="<story-slug>"
CHAR="<character-name-slug>"   # e.g., "clive"
PROMPT_FILE="/tmp/${SLUG}-${CHAR}-sheet-prompt.txt"
OUT="games/${SLUG}/assets/${CHAR}-character-sheet.png"
REF="games/${SLUG}/assets/${CHAR}-reference.png"   # optional source photo

mkdir -p "$(dirname "$OUT")"

# Write the prompt to disk first; --rawfile reads it as a literal string
# without shell-quoting hell.

if [ -f "$REF" ]; then
  # Reference-image path — uses the edits endpoint
  curl -sS https://api.openai.com/v1/images/edits \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F "model=gpt-image-1" \
    -F "image[]=@${REF}" \
    -F "prompt=$(cat $PROMPT_FILE)" \
    -F "size=1024x1024" \
    | tee /tmp/${SLUG}-${CHAR}-sheet-response.json \
    | jq -r '.data[0].b64_json' \
    | base64 -d > "$OUT"
else
  # No reference — use the generations endpoint
  curl -sS https://api.openai.com/v1/images/generations \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --rawfile p "$PROMPT_FILE" \
          '{model:"gpt-image-1", prompt:$p, size:"1024x1024", n:1}')" \
    | tee /tmp/${SLUG}-${CHAR}-sheet-response.json \
    | jq -r '.data[0].b64_json' \
    | base64 -d > "$OUT"
fi

# Sanity check — a successful PNG is > ~50 KB. A few hundred bytes means the
# API returned an error JSON; inspect /tmp/<slug>-<char>-sheet-response.json.
ls -lh "$OUT"
```

**Show the user the result.** If the character doesn't look right, regenerate. Iterate up to 5 times — character likeness is the single most expensive thing to get wrong.

## Step 2 — Scene 1: background + element PNGs

### Background prompt

The background is **the painted scene WITHOUT the moving things.** This is the most important rule. If the swing is painted in, the swing-PNG that animates on top will create a ghost-double.

Prompt structure:

```
Watercolor children's storybook illustration of [scene description].
[Composition notes: where the main character is, what's in the background, the time of day, the mood.]
DO NOT include: [list of every moving element you'll generate as a separate PNG, by name].
Soft natural light. Painted paper texture visible.
Aspect ratio: 2:3 portrait (or 3:2 landscape — match your frame setup).
Wide composition, full bleed, no text or labels.
[STYLE PROMPT]
```

If the scene contains a recurring character, **pass the character sheet as a reference image** via the edits endpoint so the character is the same kid every scene:

```bash
SCENE=1
PROMPT_FILE="/tmp/${SLUG}-scene-${SCENE}-bg-prompt.txt"
OUT="games/${SLUG}/assets/scene-${SCENE}-bg.png"
CHAR_SHEET="games/${SLUG}/assets/${CHAR}-character-sheet.png"

curl -sS https://api.openai.com/v1/images/edits \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "model=gpt-image-1" \
  -F "image[]=@${CHAR_SHEET}" \
  -F "prompt=$(cat $PROMPT_FILE)" \
  -F "size=1024x1536" \
  | jq -r '.data[0].b64_json' \
  | base64 -d > "$OUT"
```

Use `1024x1536` for portrait (2:3) and `1536x1024` for landscape (3:2). The displayed image is downscaled by the browser; source size doesn't need to match `#scene-frame` exactly.

### Element PNG prompts

Each element is a transparent PNG of a single thing. Keep the prompts SHORT — long prompts make the image generator hallucinate extra context.

```
Watercolor children's storybook illustration of a single [element, e.g., paper rocket, glowing lamp, swing seat on ropes].
[Pose / orientation, e.g., facing right; pointed up].
On a fully transparent background.
No background scene. No other objects. No text.
[STYLE PROMPT]
```

API call uses `background: "transparent"`:

```bash
SCENE=1
ELEMENT="rocket"
PROMPT_FILE="/tmp/${SLUG}-scene-${SCENE}-${ELEMENT}-prompt.txt"
OUT="games/${SLUG}/assets/scene-${SCENE}-${ELEMENT}.png"

curl -sS https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile p "$PROMPT_FILE" \
        '{model:"gpt-image-1", prompt:$p, size:"1024x1024", background:"transparent", n:1}')" \
  | jq -r '.data[0].b64_json' \
  | base64 -d > "$OUT"
```

**Common element-PNG quirks:**
- **Returns a solid white background** even with `background:"transparent"` set. Re-run; if it persists, add "transparent PNG, alpha channel, no white background, no checker pattern" to the prompt.
- **Adds a tiny scene under the element** (a swing on a small painted ground). Add "no ground, no shadow, no scene context" to the prompt and re-run.
- **Element is much smaller than the canvas** with whitespace around it. Fine — CSS scales the rendered element via the hotspot's `w` value. Leave the source generous.

### Show the user

After scene 1's background + element PNGs are generated, **stop and show the user.** Open the page (drop the assets in place, fill in scene 1 in `SCENES`, open in a browser). Confirm:

- Background looks right; the moving things are NOT painted in
- Element PNGs composite cleanly (no white halos, no ghost-doubles)
- The character looks like the same character (if applicable)
- The watercolor style is the kid's style

If any of those is off, iterate **on scene 1** before generating scenes 2-N. Style drift between batches is the most expensive bug to fix later.

## Step 3 — Scenes 2-N in batch

Once scene 1 is locked, generate the remaining scenes by looping through them. Same prompt structure, with the character sheet as the reference image for any scene containing the character.

```bash
for SCENE in 2 3 4 5 6 7 8; do
  PROMPT_FILE="/tmp/${SLUG}-scene-${SCENE}-bg-prompt.txt"
  OUT="games/${SLUG}/assets/scene-${SCENE}-bg.png"
  # Write the per-scene prompt to disk before this loop

  curl -sS https://api.openai.com/v1/images/edits \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F "model=gpt-image-1" \
    -F "image[]=@games/${SLUG}/assets/${CHAR}-character-sheet.png" \
    -F "prompt=$(cat $PROMPT_FILE)" \
    -F "size=1024x1536" \
    | jq -r '.data[0].b64_json' \
    | base64 -d > "$OUT"
done
```

For element PNGs, similar loop with `--background transparent`. Don't run them in parallel via shell `&` — the API rate-limits and you'll get sporadic failures. Sequential is fine; ~15 seconds per image, ~30 images total = ~7 minutes for the full asset set.

## File layout

After the pipeline completes, the per-game folder looks like:

```
games/<slug>/
├── index.html                           # the playable story
├── design.md                            # the design spec
├── assets/
│   ├── <char>-reference.png             # source photo (optional, kept private if sensitive)
│   ├── <char>-character-sheet.png       # the watercolor portrait, used as ref
│   ├── scene-1-bg.png ... scene-N-bg.png
│   ├── scene-1-<elem>.png, scene-1-<elem2>.png, ...
│   └── ...
```

## Cost ceiling

For the canonical 8-scene template with 4 hotspots/scene (Clive Imagines):
- 1 character sheet
- 8 backgrounds
- ~32 element PNGs
- + ~5-10 iteration generations for the character sheet and scene 1 (style locking)

Total: ~50 calls × $0.04 each (gpt-image-1) ≈ **$2.00** for a polished 8-scene book. Comic strips with 4 scenes ≈ **$1.00**.

This is dirt cheap relative to the kid's smile, but worth knowing for parents who haven't budgeted API spend.

## When the API isn't available

If `OPENAI_API_KEY` is missing or the user explicitly asks to do it manually:

1. Write every prompt to `games/<slug>/assets/_prompts/<asset-name>.txt`. Naming convention:
   - Character sheet → `<character>-character-sheet.txt` (e.g., `mochi-character-sheet.txt`)
   - Backgrounds → `scene-<N>-bg.txt` (e.g., `scene-1-bg.txt`)
   - Elements → `scene-<N>-<element>.txt` (e.g., `scene-1-rocket.txt`)
2. Tell the user the path and that they should paste each prompt into ChatGPT, Midjourney, or whatever they prefer; download the PNG; save to the matching path under `assets/` (without the `_prompts/` segment — e.g., the prompt `_prompts/scene-1-rocket.txt` produces the PNG `assets/scene-1-rocket.png`).
3. Once they say "all assets are in," wire up the SCENES array and verify.

This loses the cost benefit and the unattended workflow, but the architecture still works.

**Character-consistency caveat in manual mode.** The API path passes the character sheet as a reference image to the edits endpoint, which keeps the character looking like the same kid across scenes. Manual tools usually don't take a reference image the same way — the parent has to either (a) upload the character sheet alongside each scene prompt where their tool supports it, or (b) accept some character drift between scenes and pick the takes that look most similar. Call this trade-off out when handing prompts to the parent.

## Unattended-mode generation order

When there's no human in the loop (guardian build job), you can't pause for "show the user, iterate." Generate sequentially through this order, regenerate any single asset that comes back broken (file < 50 KB, error JSON, etc.), and ship:

1. Character sheet (if applicable) — must succeed before backgrounds, since later prompts use it as a reference image.
2. Backgrounds — generate sequentially (the API rate-limits parallel calls).
3. Element PNGs — sequentially.

Don't try to "iterate on style" without a human reviewer; trust the first plausible output. The kid + parent will provide feedback through the next round if anything looks off.

## Verification checklist

After all assets are generated:

- [ ] Open the page in a browser, scroll through all scenes
- [ ] Confirm no element PNGs have white halos or chunky edges
- [ ] Confirm the character looks like the same character across scenes (if applicable)
- [ ] Confirm backgrounds don't have ghost-doubles of the moving elements
- [ ] Tap every hotspot, confirm ambient + tap animations play
- [ ] Test on a phone-sized viewport (≤ 400px wide) — scale should still feel right
