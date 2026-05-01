"""Tests for atlas extraction.

Runs against the actual project atlas. Asserts on count and structure;
exact coordinates are unstable across regenerations so we don't pin them.
"""
import json
import subprocess
import sys
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ATLAS = REPO_ROOT / "assets" / "space-shooter-atlas.png"
SCRIPT = REPO_ROOT / "tools" / "atlas-extract.py"


def run_extract():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(ATLAS)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def test_atlas_exists():
    assert ATLAS.exists(), f"missing atlas at {ATLAS}"


def test_extracts_at_least_20_sprites():
    boxes = run_extract()
    assert len(boxes) >= 20, f"expected >=20 sprites, got {len(boxes)}"


def test_each_box_has_required_fields():
    boxes = run_extract()
    for i, b in enumerate(boxes):
        for field in ("x", "y", "w", "h", "row", "name"):
            assert field in b, f"box {i} missing field {field!r}: {b}"
        assert b["w"] > 20 and b["h"] > 20, f"box {i} too small: {b}"
        assert b["name"] is None, f"box {i} should have null name initially: {b}"


def test_boxes_sorted_by_row_then_x():
    boxes = run_extract()
    keys = [(b["row"], b["x"]) for b in boxes]
    assert keys == sorted(keys), "boxes not sorted by (row, x)"


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
