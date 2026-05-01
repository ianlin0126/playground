#!/usr/bin/env python3
"""Extract sprite bounding boxes from a transparent-background atlas.

Detects vertical row bands (gaps in alpha), then within each band finds
horizontal sprite runs. Outputs a JSON list of { x, y, w, h, row, name }
sorted by (row, x). Names are null — a human labels them post-hoc.

Usage: python3 tools/atlas-extract.py <atlas.png>
"""
import json
import sys
from PIL import Image
import numpy as np


ALPHA_THRESHOLD = 16
ROW_SUM_THRESHOLD = 10  # min columns-with-alpha per row to count as content
MIN_SPRITE_DIM = 20  # filter out single-pixel noise


def find_col_bands(alpha_2d):
    """Return list of (start, end) for column runs where any row in the
    slice has alpha above threshold."""
    has_content = (alpha_2d > ALPHA_THRESHOLD).any(axis=0)
    bands, in_band = [], False
    for i, v in enumerate(has_content):
        if v and not in_band:
            bands.append([i])
            in_band = True
        elif not v and in_band:
            bands[-1].append(i)
            in_band = False
    if in_band:
        bands[-1].append(len(has_content))
    return bands


def find_row_bands(alpha_2d):
    """Return list of (start, end) for row runs where the number of
    alpha-bearing columns exceeds ROW_SUM_THRESHOLD.

    Using a sum threshold instead of any() prevents anti-aliasing
    fringe pixels that span the full height of the atlas from merging
    vertically-adjacent sprite rows into a single band.
    """
    row_sums = (alpha_2d > ALPHA_THRESHOLD).sum(axis=1)
    has_content = row_sums > ROW_SUM_THRESHOLD
    bands, in_band = [], False
    for i, v in enumerate(has_content):
        if v and not in_band:
            bands.append([i])
            in_band = True
        elif not v and in_band:
            bands[-1].append(i)
            in_band = False
    if in_band:
        bands[-1].append(len(has_content))
    return bands


def extract_boxes(img):
    a = np.array(img)
    if a.shape[2] == 4:
        alpha = a[:, :, 3]
    else:
        alpha = np.full(a.shape[:2], 255, dtype=np.uint8)

    rows = find_row_bands(alpha)
    boxes = []
    for row_idx, (y0, y1) in enumerate(rows):
        if y1 - y0 < MIN_SPRITE_DIM:
            continue
        band_alpha = alpha[y0:y1, :]
        cols = find_col_bands(band_alpha)
        for x0, x1 in cols:
            w = x1 - x0
            if w < MIN_SPRITE_DIM:
                continue
            # Tighten y-bounds to this sprite's actual content
            sprite_alpha = alpha[y0:y1, x0:x1]
            row_has = (sprite_alpha > ALPHA_THRESHOLD).any(axis=1)
            ys = np.where(row_has)[0]
            if len(ys) == 0:
                continue
            tight_y0 = y0 + int(ys[0])
            tight_y1 = y0 + int(ys[-1]) + 1
            boxes.append({
                "x": int(x0),
                "y": tight_y0,
                "w": int(w),
                "h": tight_y1 - tight_y0,
                "row": row_idx,
                "name": None,
            })
    return boxes


def main(argv):
    if len(argv) != 2:
        print("usage: atlas-extract.py <atlas.png>", file=sys.stderr)
        return 1
    img = Image.open(argv[1])
    boxes = extract_boxes(img)
    boxes.sort(key=lambda b: (b["row"], b["x"]))
    json.dump(boxes, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
