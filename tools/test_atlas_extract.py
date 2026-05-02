"""Tests for atlas extraction.

Generates a synthetic 3-sprite atlas in a temp dir and runs the extractor
against it. Self-contained — does not depend on any specific game's
custom artwork existing in the repo.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "tools" / "atlas-extract.py"


@pytest.fixture(scope="module")
def synthetic_atlas(tmp_path_factory):
    """A 256x256 atlas with 3 solid-colored squares — two in row 0, one in row 1.

    Layout (transparent background):
      row 0: red square at (20-70, 20-70), green square at (100-150, 20-70)
      row 1: blue square at (20-70, 120-170)

    Expected extractor output: 3 boxes, 2 row bands.
    """
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, 70, 70], fill=(255, 0, 0, 255))
    d.rectangle([100, 20, 150, 70], fill=(0, 255, 0, 255))
    d.rectangle([20, 120, 70, 170], fill=(0, 0, 255, 255))
    path = tmp_path_factory.mktemp("atlas") / "fixture.png"
    img.save(path)
    return path


def run_extract(atlas_path):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(atlas_path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def test_extracts_three_sprites_from_synthetic_atlas(synthetic_atlas):
    boxes = run_extract(synthetic_atlas)
    assert len(boxes) == 3, f"expected 3 sprites, got {len(boxes)}: {boxes}"


def test_each_box_has_required_fields(synthetic_atlas):
    boxes = run_extract(synthetic_atlas)
    for i, b in enumerate(boxes):
        for field in ("x", "y", "w", "h", "row", "name"):
            assert field in b, f"box {i} missing field {field!r}: {b}"
        assert b["w"] > 20 and b["h"] > 20, f"box {i} too small: {b}"
        assert b["name"] is None, f"box {i} should have null name initially: {b}"


def test_boxes_sorted_by_row_then_x(synthetic_atlas):
    boxes = run_extract(synthetic_atlas)
    keys = [(b["row"], b["x"]) for b in boxes]
    assert keys == sorted(keys), "boxes not sorted by (row, x)"


def test_two_distinct_row_bands_detected(synthetic_atlas):
    boxes = run_extract(synthetic_atlas)
    rows = sorted({b["row"] for b in boxes})
    assert rows == [0, 1], f"expected 2 row bands, got {rows}"


def test_row_zero_has_two_sprites_row_one_has_one(synthetic_atlas):
    boxes = run_extract(synthetic_atlas)
    by_row = {}
    for b in boxes:
        by_row.setdefault(b["row"], []).append(b)
    assert len(by_row[0]) == 2, f"row 0 should have 2 sprites, got {len(by_row[0])}"
    assert len(by_row[1]) == 1, f"row 1 should have 1 sprite, got {len(by_row[1])}"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
