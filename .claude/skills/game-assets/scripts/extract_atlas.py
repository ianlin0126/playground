#!/usr/bin/env python3
"""Detect sprite bounding boxes in a generated atlas via alpha analysis,
then run the mechanical-pass checks from Phase 4 of the game-assets skill.

Outputs:
  <atlas>-bboxes.json    — list of {x, y, w, h, row} bbox records
  <atlas>-crops/         — one PNG per detected sprite (for visual review)
  stdout                 — pass/fail summary; exits non-zero on failure

Usage:
  extract_atlas.py path/to/atlas.png
  extract_atlas.py path/to/atlas.png --expected 19  # gate on count
"""
import argparse, json, sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Install Pillow first: /opt/homebrew/bin/python3.13 -m pip install --break-system-packages Pillow")

ROW_SUM_THRESHOLD = 200
ALPHA_THRESHOLD = 16
MIN_SPRITE_DIM = 30
MIN_FILE_KB = 50

def detect(path):
    img = Image.open(path).convert("RGBA")
    W, H = img.size
    px = img.load()
    alpha = [[px[x, y][3] for x in range(W)] for y in range(H)]
    row_sum = [sum(alpha[y]) for y in range(H)]

    bands = []
    in_band = False
    y0 = 0
    for y in range(H):
        content = row_sum[y] > ROW_SUM_THRESHOLD
        if content and not in_band:
            in_band = True; y0 = y
        elif not content and in_band:
            in_band = False
            if y - y0 >= MIN_SPRITE_DIM:
                bands.append((y0, y))
    if in_band and H - y0 >= MIN_SPRITE_DIM:
        bands.append((y0, H))

    sprites = []
    for row_idx, (yb0, yb1) in enumerate(bands):
        col_content = [any(alpha[y][x] > ALPHA_THRESHOLD for y in range(yb0, yb1)) for x in range(W)]
        runs = []
        in_run = False; x0 = 0
        for x in range(W):
            if col_content[x] and not in_run:
                in_run = True; x0 = x
            elif not col_content[x] and in_run:
                in_run = False
                if x - x0 >= MIN_SPRITE_DIM:
                    runs.append((x0, x))
        if in_run and W - x0 >= MIN_SPRITE_DIM:
            runs.append((x0, W))
        for x0, x1 in runs:
            ty0 = yb0; ty1 = yb1
            for y in range(yb0, yb1):
                if any(alpha[y][x] > ALPHA_THRESHOLD for x in range(x0, x1)):
                    ty0 = y; break
            for y in range(yb1 - 1, yb0 - 1, -1):
                if any(alpha[y][x] > ALPHA_THRESHOLD for x in range(x0, x1)):
                    ty1 = y + 1; break
            sprites.append({"x": x0, "y": ty0, "w": x1 - x0, "h": ty1 - ty0, "row": row_idx})
    return sprites, (W, H), img

def crop_all(img, sprites, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(sprites):
        crop = img.crop((s["x"], s["y"], s["x"] + s["w"], s["y"] + s["h"]))
        crop.save(out_dir / f"sprite_{i:02d}_r{s['row']}.png")

def mechanical_pass(path, sprites, dims, expected):
    W, H = dims
    failures = []

    file_kb = path.stat().st_size // 1024
    if file_kb < MIN_FILE_KB:
        failures.append(f"file size {file_kb} KB < {MIN_FILE_KB} KB threshold (likely an error response, not an image)")

    if not sprites:
        failures.append("no sprites detected — atlas may be blank or alpha was rendered as solid white")

    # Text-band heuristic: sprites with extreme aspect ratios near top/bottom are probably labels.
    band_top = H * 0.10
    band_bot = H * 0.90
    for s in sprites:
        ratio = s["w"] / max(1, s["h"])
        if ratio > 6 and (s["y"] < band_top or s["y"] + s["h"] > band_bot):
            failures.append(f"suspected baked-in text/label: bbox at ({s['x']},{s['y']}) {s['w']}x{s['h']} (ratio {ratio:.1f})")

    # Cell-size variance
    if len(sprites) >= 4:
        ws = [s["w"] for s in sprites]
        hs = [s["h"] for s in sprites]
        for label, vals in [("widths", ws), ("heights", hs)]:
            mean = sum(vals) / len(vals)
            spread = (max(vals) - min(vals)) / mean if mean else 0
            if spread > 1.5:  # 150% of mean — much higher than ±25%
                failures.append(f"sprite {label} variance is large (spread {spread*100:.0f}% of mean) — cells may have merged or split")

    if expected is not None:
        if abs(len(sprites) - expected) > 1:
            failures.append(f"detected {len(sprites)} sprites; expected {expected} ± 1")

    return failures

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("atlas", help="Path to the atlas PNG.")
    ap.add_argument("--expected", type=int, default=None, help="Expected sprite count from Phase 1; gates on ±1 match.")
    ap.add_argument("--no-crops", action="store_true", help="Skip writing per-sprite crop PNGs.")
    args = ap.parse_args()

    path = Path(args.atlas)
    if not path.is_file():
        sys.exit(f"Atlas not found: {path}")

    sprites, dims, img = detect(path)
    print(f"atlas {dims[0]}x{dims[1]}: detected {len(sprites)} sprites")
    for i, s in enumerate(sprites):
        print(f"  [{i:02d}] r{s['row']}  x={s['x']:4d} y={s['y']:4d}  w={s['w']:4d} h={s['h']:4d}")

    bboxes_path = path.with_name(path.stem + "-bboxes.json")
    bboxes_path.write_text(json.dumps(sprites, indent=2))
    print(f"wrote {bboxes_path}")

    if not args.no_crops:
        crops_dir = path.with_name(path.stem + "-crops")
        crop_all(img, sprites, crops_dir)
        print(f"wrote {len(sprites)} crops to {crops_dir}/")

    failures = mechanical_pass(path, sprites, dims, args.expected)
    if failures:
        print("\nMECHANICAL PASS: FAIL")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)

    print("\nMECHANICAL PASS: OK")

if __name__ == "__main__":
    main()
