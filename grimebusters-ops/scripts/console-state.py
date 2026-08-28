#!/usr/bin/env python3
"""
Collects the live state of the agent system for the M.A.R.C.U.S console.

The console is a published Claude artifact. A page there cannot reach
Firestore — the viewer sandbox blocks outbound requests — so the state is
gathered here and baked into the page each time it is republished. That makes
freshness a real property of the board rather than an assumption: every number
carries the timestamp of the run that produced it, and the page says so.

Sources, all real, none invented:

  agents      .claude/agents/*.md front matter, plus Marcus from CLAUDE.md.
              These are the agent definitions themselves — name, remit, model,
              and the tools each one is actually granted.
  status      Firestore opsAgents/opsFeed/opsApprovals, written by
              scripts/ops-publish.ts. Empty until an agent publishes, and the
              console shows that as "not reporting" rather than filling in.
  telemetry   The CRM's own jobs, quotes and customers, read with the
              read-only key. Completed work only — a quote is what was asked
              for, not what was earned.
  activity    git log over grimebusters-ops/, which is the one record of what
              the two sessions actually changed.

Usage:
  .venv/bin/python scripts/console-state.py [--out state.json]

Read-only throughout. It holds no credential that can write anything.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

OPS_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = OPS_DIR.parent
KEY_PATH = OPS_DIR / "firebase-readonly.json"

# Marcus is not in .claude/agents — he is the session that reads CLAUDE.md and
# delegates to the rest, so his remit is stated here from that file.
MARCUS = {
    "id": "marcus",
    "name": "Marcus",
    "short": "CEO",
    "role": "CEO — routes everything",
    "remit": (
        "Single point of contact. Delegates to the five specialists, names who "
        "contributed, escalates every disagreement with both positions intact, "
        "and never commits money."
    ),
    "model": "fable",
    "tools": [],
}

# Roster order follows the delegation table in CLAUDE.md, not the filesystem —
# the board should read the way the system is actually organised.
ROSTER_ORDER = ["grant", "cole", "reese", "avery", "tyler"]

SHORT = {
    "grant": ("WEB", "Website · SEO · GBP · forms"),
    "cole": ("LEADS", "Lead triage · outreach · follow-up"),
    "reese": ("OFFERS", "Offers · campaigns · retention"),
    "avery": ("INTEL", "Research · trends · performance"),
    "tyler": ("MEDIA", "Reels · captions · shot lists"),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_agents() -> list[dict]:
    """The roster, from the agent definition files themselves."""
    agents = [MARCUS]
    paths = sorted(
        (OPS_DIR / ".claude" / "agents").glob("*.md"),
        key=lambda p: ROSTER_ORDER.index(p.stem)
        if p.stem in ROSTER_ORDER
        else len(ROSTER_ORDER),
    )
    for path in paths:
        text = path.read_text(encoding="utf-8", errors="replace")
        match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
        if not match:
            continue
        front = {}
        for line in match.group(1).split("\n"):
            if ":" in line and not line.startswith(" "):
                key, _, value = line.partition(":")
                front[key.strip()] = value.strip()
        agent_id = front.get("name", path.stem)
        short, role = SHORT.get(agent_id, ("AGENT", ""))
        # The description is one long sentence written for dispatch. The first
        # clause is the remit; the rest is trigger wording the board does not
        # need.
        description = front.get("description", "")
        remit = description.split(". Use for")[0].strip()
        triggers = ""
        if ". Use for" in description:
            triggers = description.split(". Use for", 1)[1].strip().rstrip(".")
        agents.append(
            {
                "id": agent_id,
                "name": agent_id.capitalize(),
                "short": short,
                "role": role or remit,
                "remit": remit,
                "triggers": triggers,
                "model": front.get("model", ""),
                "tools": [t.strip() for t in front.get("tools", "").split(",") if t.strip()],
            }
        )
    return agents


def read_activity(limit: int = 40) -> list[dict]:
    """What the sessions actually changed, from git."""
    try:
        out = subprocess.run(
            [
                "git",
                "-C",
                str(REPO_DIR),
                "log",
                f"-{limit}",
                "--date=iso-strict",
                "--pretty=format:%H%x1f%ad%x1f%an%x1f%s",
                "--",
                "grimebusters-ops",
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    rows = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) != 4:
            continue
        sha, date, author, subject = parts
        rows.append(
            {"sha": sha[:7], "date": date, "author": author, "subject": subject}
        )
    return rows


def read_firestore() -> dict:
    """Live CRM and ops state. Returns what it could read, and says what it could not."""
    result: dict = {
        "available": False,
        "error": None,
        "opsAgents": [],
        "opsFeed": [],
        "opsApprovals": [],
        "telemetry": None,
    }
    if not KEY_PATH.exists():
        result["error"] = f"no read-only key at {KEY_PATH}"
        return result

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        result["error"] = "firebase-admin is not installed in this interpreter"
        return result

    try:
        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(str(KEY_PATH)))
        db = firestore.client()
    except Exception as error:  # noqa: BLE001 — reported, never swallowed
        result["error"] = f"could not connect: {error}"
        return result

    def stamp(value):
        try:
            return value.isoformat()
        except AttributeError:
            return None

    try:
        for doc in db.collection("opsAgents").stream():
            data = doc.to_dict() or {}
            result["opsAgents"].append(
                {
                    "id": doc.id,
                    "status": data.get("status"),
                    "task": data.get("task"),
                    "heartbeatAt": stamp(data.get("heartbeatAt")),
                }
            )

        feed = (
            db.collection("opsFeed")
            .order_by("createdAt", direction=firestore.Query.DESCENDING)
            .limit(40)
            .stream()
        )
        for doc in feed:
            data = doc.to_dict() or {}
            result["opsFeed"].append(
                {
                    "who": data.get("who"),
                    "text": data.get("text"),
                    "createdAt": stamp(data.get("createdAt")),
                }
            )

        for doc in db.collection("opsApprovals").stream():
            data = doc.to_dict() or {}
            result["opsApprovals"].append(
                {
                    "id": doc.id,
                    "kind": data.get("kind"),
                    "who": data.get("who"),
                    "title": data.get("title"),
                    "detail": data.get("detail"),
                    "cost": data.get("cost"),
                    "positionA": data.get("positionA"),
                    "positionB": data.get("positionB"),
                    "marcusRead": data.get("marcusRead"),
                    "status": data.get("status"),
                    "createdAt": stamp(data.get("createdAt")),
                    "decidedByName": data.get("decidedByName"),
                    "decidedAt": stamp(data.get("decidedAt")),
                }
            )

        # Telemetry: completed work only. A quote is what was asked for.
        jobs = [d.to_dict() or {} for d in db.collection("jobs").stream()]
        quotes = [d.to_dict() or {} for d in db.collection("quotes").stream()]
        customers = [d.to_dict() or {} for d in db.collection("customers").stream()]

        def month_key(value):
            try:
                return value.strftime("%Y-%m")
            except AttributeError:
                return None

        completed = [
            job
            for job in jobs
            if job.get("status") == "complete" and job.get("completedAt") is not None
        ]
        by_month: dict[str, float] = {}
        for job in completed:
            key = month_key(job.get("completedAt"))
            if key:
                by_month[key] = by_month.get(key, 0) + float(job.get("price") or 0)

        accepted = [q for q in quotes if q.get("status") == "accepted"]
        outstanding = [
            q for q in quotes if q.get("status") in ("sent", "no_response")
        ]

        result["telemetry"] = {
            "jobsTotal": len(jobs),
            "jobsCompleted": len(completed),
            "customers": len(customers),
            "quotesTotal": len(quotes),
            "quotesAccepted": len(accepted),
            "quotesOutstanding": len(outstanding),
            "outstandingValue": sum(float(q.get("amount") or 0) for q in outstanding),
            "revenueByMonth": [
                {"month": key, "total": round(value, 2)}
                for key, value in sorted(by_month.items())
            ],
            "lifetimeCompletedRevenue": round(
                sum(float(j.get("price") or 0) for j in completed), 2
            ),
        }
        result["available"] = True
    except Exception as error:  # noqa: BLE001
        result["error"] = f"read failed: {error}"

    return result


def main() -> int:
    state = {
        "generatedAt": now_iso(),
        "agents": read_agents(),
        "activity": read_activity(),
        "firestore": read_firestore(),
    }
    out = None
    if "--out" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--out") + 1])
    text = json.dumps(state, indent=2)
    if out:
        out.write_text(text, encoding="utf-8")
        print(f"wrote {out} ({len(text)} bytes)")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
