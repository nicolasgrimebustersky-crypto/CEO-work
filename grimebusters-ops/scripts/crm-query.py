#!/usr/bin/env python3
"""Read-only GrimelineCRM query tool. Marcus uses this for real pricing.

The CRM is the Firestore database behind grimebusters-crm (this repository).
Collections and field names below come from `lib/types.ts`, not from guesses.

    python3 scripts/crm-query.py pricing
    python3 scripts/crm-query.py pricing --service pressure_washing
    python3 scripts/crm-query.py list jobs --limit 20 --since 2026-07-01
    python3 scripts/crm-query.py doc customers <id>

Reads only. Nothing here writes to the CRM, and the service account it runs
under should be Cloud Datastore Viewer so it could not if it tried.
"""
import argparse
import json
import os
import statistics
import sys
from datetime import datetime, timezone

# The collections that actually exist, per firestore.rules. Querying a name
# that is not here is a typo, and a typo returns an empty list rather than an
# error — which Marcus would read as "no data" and answer from.
COLLECTIONS = {
    "customers",
    "jobs",
    "quotes",
    "services",
    "conversations",
    "knockRoutes",
    "territories",
    "users",
}

SERVICE_TYPES = ("pressure_washing", "landscaping", "snow_removal")

# Customer records carry names, phone numbers, emails and street addresses.
# Output from this script ends up in an agent's context and sometimes in a
# Telegram message, so contact details are dropped unless asked for.
PII_FIELDS = ("phone", "email", "address", "notes")


def open_db():
    # Imported here rather than at module scope so --help, argument validation
    # and the unit tests all work on a machine that has not installed the SDK.
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        sys.exit("pip install firebase-admin")

    # FIRESTORE_EMULATOR_HOST points every read at a local emulator, which
    # needs no credential and cannot reach the real CRM. That is how the
    # queries below get tested without a production key on the machine.
    if os.environ.get("FIRESTORE_EMULATOR_HOST"):
        # An explicit anonymous credential, because initialize_app() with no
        # credential still goes looking for application-default ones and fails
        # on a machine that has never run `gcloud auth`.
        from google.auth.credentials import AnonymousCredentials
        from google.cloud import firestore as gcf

        return gcf.Client(
            project=os.environ.get("GCLOUD_PROJECT", "demo-gb"),
            credentials=AnonymousCredentials(),
        )

    key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "./firebase-readonly.json")
    if not os.path.exists(key):
        sys.exit(f"Missing {key}. See scripts/README-firestore.md")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(key))
    return firestore.client()


def parse_since(value):
    """ISO date or datetime -> aware datetime.

    Firestore stores these fields as timestamps, so comparing them against a
    string silently matches nothing. That failure is the dangerous kind: an
    empty result reads as "no jobs" rather than as a broken query.
    """
    text = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        sys.exit(f"--since wants an ISO date like 2026-07-01, got {value!r}")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def scrub(doc_dict, keep_pii):
    if keep_pii:
        return doc_dict
    return {k: v for k, v in doc_dict.items() if k not in PII_FIELDS}


def fetch(db, collection, limit=None, since=None, since_field="createdAt", filters=()):
    from google.cloud.firestore_v1.base_query import FieldFilter

    q = db.collection(collection)
    for f in filters:
        field, _, value = f.partition("=")
        if not value:
            sys.exit(f"--field wants field=value, got {f!r}")
        # Numbers arrive as strings from argv and would never match a numeric
        # field stored in Firestore.
        if value.isdigit():
            value = int(value)
        elif value in ("true", "false"):
            value = value == "true"
        q = q.where(filter=FieldFilter(field, "==", value))
    if since:
        q = q.where(filter=FieldFilter(since_field, ">=", since))
    if limit:
        q = q.limit(limit)
    out = []
    for doc in q.stream():
        d = doc.to_dict()
        d["_id"] = doc.id
        out.append(d)
    return out


def cmd_list(db, a):
    if a.collection not in COLLECTIONS:
        sys.exit(f"Unknown collection {a.collection!r}. Known: {', '.join(sorted(COLLECTIONS))}")
    rows = fetch(
        db,
        a.collection,
        limit=a.limit,
        since=parse_since(a.since) if a.since else None,
        filters=a.field or [],
    )
    rows = [scrub(r, a.pii) for r in rows]
    print(json.dumps(rows, indent=2, default=str, ensure_ascii=False))
    print(f"\n{len(rows)} document(s)", file=sys.stderr)


def cmd_doc(db, a):
    if a.collection not in COLLECTIONS:
        sys.exit(f"Unknown collection {a.collection!r}. Known: {', '.join(sorted(COLLECTIONS))}")
    snap = db.collection(a.collection).document(a.doc_id).get()
    if not snap.exists:
        sys.exit(f"No {a.collection}/{a.doc_id}")
    d = scrub(snap.to_dict(), a.pii)
    d["_id"] = snap.id
    print(json.dumps(d, indent=2, default=str, ensure_ascii=False))


def summarise(label, amounts):
    amounts = sorted(a for a in amounts if isinstance(a, (int, float)) and a > 0)
    if not amounts:
        return {"basis": label, "n": 0, "note": "UNKNOWN — no priced records"}
    return {
        "basis": label,
        "n": len(amounts),
        "min": amounts[0],
        "p25": statistics.quantiles(amounts, n=4)[0] if len(amounts) >= 4 else amounts[0],
        "median": statistics.median(amounts),
        "p75": statistics.quantiles(amounts, n=4)[2] if len(amounts) >= 4 else amounts[-1],
        "max": amounts[-1],
    }


def cmd_pricing(db, a):
    """What the business has actually charged, by service.

    Completed jobs are the honest basis — a quote is what was asked for, a
    completed job is what was agreed to and worked. Accepted quotes are shown
    alongside because early history has quotes where the job record is thin.
    """
    since = parse_since(a.since) if a.since else None
    services = [a.service] if a.service else list(SERVICE_TYPES)
    if a.service and a.service not in SERVICE_TYPES:
        sys.exit(f"Unknown service {a.service!r}. Known: {', '.join(SERVICE_TYPES)}")

    report = {"generatedAt": datetime.now(timezone.utc).isoformat(), "services": {}}
    for service in services:
        jobs = fetch(db, "jobs", since=since, filters=[f"serviceType={service}"])
        done = [j for j in jobs if j.get("status") == "complete"]
        quotes = fetch(db, "quotes", since=since, since_field="sentAt",
                       filters=[f"serviceType={service}"])
        accepted = [q for q in quotes if q.get("status") == "accepted"]
        report["services"][service] = {
            "completedJobs": summarise("completed jobs", [j.get("price") for j in done]),
            "acceptedQuotes": summarise("accepted quotes", [q.get("amount") for q in accepted]),
            "quoteWinRate": (
                round(len(accepted) / len(quotes), 3) if quotes else None
            ),
        }

    print(json.dumps(report, indent=2, default=str, ensure_ascii=False))
    print(
        "\nThese are historical figures, not a quote. Every price goes to "
        "Nicolas before it goes to a customer.",
        file=sys.stderr,
    )


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pii", action="store_true",
                   help="include phone, email, address and notes (off by default)")
    sub = p.add_subparsers(dest="cmd", required=True)

    lst = sub.add_parser("list", help="dump documents from one collection")
    lst.add_argument("collection")
    lst.add_argument("--limit", type=int, default=25)
    lst.add_argument("--since", help="ISO date, filters on createdAt")
    lst.add_argument("--field", action="append", help="field=value filter, repeatable")
    lst.set_defaults(fn=cmd_list)

    one = sub.add_parser("doc", help="fetch one document by id")
    one.add_argument("collection")
    one.add_argument("doc_id")
    one.set_defaults(fn=cmd_doc)

    pr = sub.add_parser("pricing", help="what we have actually charged, by service")
    pr.add_argument("--service", help=" | ".join(SERVICE_TYPES))
    pr.add_argument("--since", help="ISO date, e.g. last season's start")
    pr.set_defaults(fn=cmd_pricing)

    a = p.parse_args()
    a.fn(open_db(), a)


if __name__ == "__main__":
    main()
