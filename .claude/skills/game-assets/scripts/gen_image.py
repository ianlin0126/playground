#!/usr/bin/env python3
"""Generate a sprite atlas (transparent square) or background (opaque
landscape) via OpenAI's image API. Used by the game-assets skill.

Usage:
  gen_image.py --mode atlas --prompt-file prompt.txt --out out.png
  gen_image.py --mode bg    --prompt-file prompt.txt --out out.png

Modes pick sane defaults for size + transparency:
  atlas → 1024x1024, background:"transparent"
  bg    → 1536x1024, opaque (transparent param omitted)

Override defaults with --size and --no-transparent / --transparent.

Environment:
  OPENAI_API_KEY must be set. Source from .env first:
    set -a; . ./.env; set +a; python3.13 gen_image.py ...

Python:
  Use 3.11+. macOS system Python 3.6 fails SSL handshake against
  api.openai.com — the script will exit with a clear error if that
  happens.
"""
import argparse, base64, json, os, sys
from pathlib import Path
from urllib import request, error

DEFAULTS = {
    "atlas": {"size": "1024x1024", "transparent": True},
    "bg":    {"size": "1536x1024", "transparent": False},
}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["atlas", "bg"], required=True)
    ap.add_argument("--prompt-file", required=True, help="Path to a UTF-8 text file containing the full prompt.")
    ap.add_argument("--out", required=True, help="Path to write the resulting PNG.")
    ap.add_argument("--model", default="gpt-image-1", help="OpenAI image model id (default: gpt-image-1).")
    ap.add_argument("--size", default=None, help="Override the mode default (e.g. 2048x2048).")
    ap.add_argument("--transparent", dest="transparent", action="store_true", default=None)
    ap.add_argument("--no-transparent", dest="transparent", action="store_false")
    args = ap.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit("OPENAI_API_KEY is not set. Source .env first: `set -a; . ./.env; set +a`.")

    prompt_path = Path(args.prompt_file)
    if not prompt_path.is_file():
        sys.exit(f"Prompt file not found: {prompt_path}")
    prompt = prompt_path.read_text(encoding="utf-8").strip()
    if len(prompt) < 50:
        sys.exit(f"Prompt looks too short ({len(prompt)} chars). Write a substantive prompt before generating.")

    defaults = DEFAULTS[args.mode]
    size = args.size or defaults["size"]
    transparent = defaults["transparent"] if args.transparent is None else args.transparent

    body = {
        "model": args.model,
        "prompt": prompt,
        "size": size,
        "n": 1,
    }
    if transparent:
        body["background"] = "transparent"

    req = request.Request(
        "https://api.openai.com/v1/images/generations",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with request.urlopen(req, timeout=240) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")
        sys.exit(f"OpenAI HTTP {e.code}: {msg}")
    except (error.URLError, OSError) as e:
        if "CERTIFICATE_VERIFY_FAILED" in str(e):
            sys.exit("SSL handshake failed (likely macOS system Python 3.6). Use /opt/homebrew/bin/python3.13 or any 3.11+.")
        sys.exit(f"Network error: {e}")

    data = payload.get("data") or []
    if not data or "b64_json" not in data[0]:
        sys.exit(f"Unexpected response shape: {json.dumps(payload)[:500]}")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    png = base64.b64decode(data[0]["b64_json"])
    out.write_bytes(png)

    size_kb = len(png) // 1024
    if size_kb < 50:
        sys.exit(f"Wrote {out} but it is only {size_kb} KB — likely an error response, inspect it.")
    print(f"wrote {out} ({size_kb} KB) via {args.model} {size} mode={args.mode} transparent={transparent}")

if __name__ == "__main__":
    main()
