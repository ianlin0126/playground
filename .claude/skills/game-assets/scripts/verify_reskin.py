#!/usr/bin/env python3
"""Drive a game URL in headless Chrome via the DevTools Protocol, then
report on console errors, network failures, and asset-loading state.
Used by Phase 7 of the game-assets skill as the mechanical pass for
"is the reskinned game actually working?"

Outputs (under <out-dir>/):
  report.json   — structured pass/fail with everything observed
  screen.png    — a gameplay screenshot (post-Start, if a Start button exists)

Exit codes:
  0  — page loaded, atlas loaded, zero JS errors, zero 4xx/5xx
  1  — any failure; details in report.json

Usage:
  verify_reskin.py --url http://localhost:3000/games/<slug>/ --out /tmp/<slug>-verify

Requirements:
  - Google Chrome.app installed at /Applications/Google Chrome.app/
  - Python 3.11+ with `websockets` (auto-installed via pip --break-system-packages
    if missing, since the script needs to be runnable in fresh sessions)
"""
import argparse, base64, json, os, signal, subprocess, sys, time
from pathlib import Path
from urllib import request as ureq

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

def ensure_websockets():
    try:
        from websockets.sync.client import connect  # noqa
    except ImportError:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "--break-system-packages", "websockets"],
            check=True,
        )

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True, help="Game URL (must be reachable from this host).")
    ap.add_argument("--out", required=True, help="Directory to write report.json + screen.png.")
    ap.add_argument("--port", type=int, default=9234, help="Chrome remote-debugging port.")
    ap.add_argument("--asset-check", default=None, help="JS expression that must eval to true once assets load (default: assetsReady or atlas?.complete).")
    args = ap.parse_args()

    ensure_websockets()
    from websockets.sync.client import connect

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    profile_dir = out_dir / "chrome-profile"
    log_path = out_dir / "chrome.log"

    chrome = subprocess.Popen(
        [
            CHROME, "--headless=new", "--disable-gpu",
            f"--remote-debugging-port={args.port}",
            f"--user-data-dir={profile_dir}",
            "--window-size=1280,800",
            args.url,
        ],
        stdout=open(log_path, "wb"), stderr=subprocess.STDOUT,
    )

    try:
        # Wait for the devtools endpoint to come up.
        ws_url = None
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                targets = json.loads(ureq.urlopen(f"http://127.0.0.1:{args.port}/json", timeout=1).read())
                pages = [t for t in targets if t.get("type") == "page"]
                if pages:
                    ws_url = pages[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                pass
            time.sleep(0.25)
        if not ws_url:
            raise RuntimeError("Chrome devtools did not become reachable")

        with connect(ws_url, max_size=64 * 1024 * 1024) as ws:
            msg_id = 0
            def send(method, params=None):
                nonlocal msg_id
                msg_id += 1
                ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
                # Drain events; return when our id comes back
                while True:
                    m = json.loads(ws.recv())
                    if m.get("id") == msg_id:
                        return m
                    events.append(m)
            events = []  # captured CDP events for later filtering

            send("Network.enable")
            send("Page.enable")
            send("Runtime.enable")
            send("Log.enable")
            # Navigate (already loaded, but this captures the lifecycle event)
            send("Page.navigate", {"url": args.url})

            # Drain pending events for ~5s while page settles. websockets'
            # sync API exposes per-call timeouts; using them avoids touching
            # the underlying socket (which has unstable behavior across
            # versions and leaves the connection in a bad state if poked).
            t_end = time.time() + 5
            while time.time() < t_end:
                try:
                    m = json.loads(ws.recv(timeout=0.2))
                    events.append(m)
                except TimeoutError:
                    continue
                except Exception:
                    break

            # Asset readiness check
            asset_expr = args.asset_check or (
                "(typeof assetsReady !== 'undefined' ? !!assetsReady : "
                "(typeof atlas !== 'undefined' ? !!(atlas && atlas.complete && atlas.naturalWidth > 0) : true))"
            )
            atlas_ready = False
            for _ in range(40):
                r = send("Runtime.evaluate", {"expression": asset_expr})
                if r.get("result", {}).get("result", {}).get("value") is True:
                    atlas_ready = True
                    break
                time.sleep(0.25)

            # Click Start if it exists
            send("Runtime.evaluate", {"expression": "var b=document.querySelector('#start-btn,#startBtn,#start, .big-btn.play, button[data-start]'); if(b) b.click(); !!b"})
            time.sleep(0.6)

            # Screenshot
            r = send("Page.captureScreenshot", {"format": "png"})
            shot_data = r.get("result", {}).get("data")
            if shot_data:
                (out_dir / "screen.png").write_bytes(base64.b64decode(shot_data))

            # Filter events for console errors + bad responses
            console_errors = []
            bad_responses = []
            for ev in events:
                method = ev.get("method", "")
                params = ev.get("params", {})
                if method == "Runtime.consoleAPICalled" and params.get("type") in ("error", "assert"):
                    console_errors.append(_text_of(params.get("args", [])))
                elif method == "Runtime.exceptionThrown":
                    console_errors.append(params.get("exceptionDetails", {}).get("text", "exception"))
                elif method == "Log.entryAdded" and params.get("entry", {}).get("level") == "error":
                    console_errors.append(params["entry"].get("text", "log error"))
                elif method == "Network.responseReceived":
                    resp = params.get("response", {})
                    status = resp.get("status", 0)
                    url = resp.get("url", "")
                    if status >= 400 and url.startswith(args.url.split("//")[0]):
                        bad_responses.append({"url": url, "status": status})

            report = {
                "url": args.url,
                "atlas_ready": atlas_ready,
                "console_errors": console_errors,
                "bad_responses": bad_responses,
                "screenshot": str((out_dir / "screen.png").resolve()) if shot_data else None,
            }
            (out_dir / "report.json").write_text(json.dumps(report, indent=2))

            failed = (
                not atlas_ready
                or console_errors
                or bad_responses
            )
            if failed:
                print(json.dumps(report, indent=2))
                sys.exit(1)
            print(f"OK — atlas_ready={atlas_ready}, no console errors, no failed responses; report at {out_dir}/report.json")

    finally:
        chrome.send_signal(signal.SIGTERM)
        try:
            chrome.wait(timeout=5)
        except subprocess.TimeoutExpired:
            chrome.kill()


def _text_of(args):
    parts = []
    for a in args:
        if "value" in a:
            parts.append(str(a["value"]))
        elif "description" in a:
            parts.append(str(a["description"]))
    return " ".join(parts) or "<error>"

if __name__ == "__main__":
    main()
