#!/usr/bin/env python3
"""
Bakes the current agent-system state into the M.A.R.C.U.S console page.

    .venv/bin/python scripts/console-state.py --out /tmp/state.json
    python3 scripts/build-console.py --state /tmp/state.json --out /tmp/console.html

The published console is a snapshot: a page on claude.ai cannot reach
Firestore, so the state is read here and embedded. Rebuild and republish to
refresh it — the page prints the capture time so nobody mistakes an old
snapshot for a live feed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "console-template.html"


def arg(name: str, default: str | None = None) -> str | None:
    if f"--{name}" in sys.argv:
        return sys.argv[sys.argv.index(f"--{name}") + 1]
    return default


def main() -> int:
    state_path = arg("state")
    out_path = arg("out")
    if not state_path or not out_path:
        print("usage: build-console.py --state state.json --out console.html")
        return 1

    state = json.loads(Path(state_path).read_text(encoding="utf-8"))
    html = TEMPLATE.read_text(encoding="utf-8")

    # </script> inside a JSON string would close the page's own script tag.
    blob = json.dumps(state, separators=(",", ":")).replace("</", "<\\/")
    if "__STATE__" not in html:
        print("FAILED: template has no __STATE__ placeholder")
        return 1

    Path(out_path).write_text(html.replace("__STATE__", blob), encoding="utf-8")
    print(f"wrote {out_path} ({len(html) + len(blob)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
