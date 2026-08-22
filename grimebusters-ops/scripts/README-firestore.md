# Wiring Marcus to GrimelineCRM (read-only)

This is load-bearing. All pricing lives in the CRM. Until this works, every
price question returns UNKNOWN.

GrimelineCRM is the Firestore database behind the `grimebusters-crm` app —
the repository this folder sits in. The collection and field names below are
taken from `lib/types.ts` and `firestore.rules`, so they are the real ones.

## 1. Create a read-only service account

Firebase Console → the GrimelineCRM project → Project Settings → Service
Accounts → Generate new private key. Save as `firebase-readonly.json` inside
`grimebusters-ops/`.

**It's already in .gitignore. Verify before your first commit:**
```bash
git check-ignore -v grimebusters-ops/firebase-readonly.json
```

## 2. Lock it down

In Firebase Console → IAM, give this service account **Cloud Datastore
Viewer** only. Not Editor. Not Owner. Marcus reads; he never writes to the
CRM.

This matters more than the usual least-privilege argument. The CRM is the
live book of customers and money for a running business — a key that can
write is a key that can quietly corrupt the record Marcus is supposed to be
reporting on.

## 3. Install

```bash
pip install firebase-admin
```

## 4. Query script

`scripts/crm-query.py`. Three modes:

```bash
# What we have actually charged, by service. This is the pricing answer.
python3 scripts/crm-query.py pricing
python3 scripts/crm-query.py pricing --service pressure_washing
python3 scripts/crm-query.py pricing --since 2026-03-01   # this season only

# Raw documents.
python3 scripts/crm-query.py list jobs --limit 20 --since 2026-07-01
python3 scripts/crm-query.py list quotes --field status=accepted
python3 scripts/crm-query.py doc customers <id>
```

`pricing` reports min / p25 / median / p75 / max over **completed jobs**,
with accepted quotes and the quote win rate alongside. Completed jobs are the
honest basis: a quote is what was asked for, a completed job is what was
agreed to and worked.

Where a service has no priced records, that service comes back
`UNKNOWN — no priced records` rather than a number built from nothing.

Contact details — `phone`, `email`, `address`, `notes` — are stripped from
output unless you pass `--pii`. Query results end up in an agent's context
window and sometimes in a Telegram message; customer phone numbers do not
need to be in either.

## 5. Verify

```bash
python3 scripts/crm-query.py list jobs --limit 1
python3 scripts/crm-query.py pricing --service pressure_washing
```

If those return real figures, Marcus has pricing.

## Testing without a production key

Set `FIRESTORE_EMULATOR_HOST` and the script talks to a local emulator
instead, needing no credential and unable to reach the real CRM:

```bash
npm run emulators                                  # from the repo root
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-gb \
  python3 grimebusters-ops/scripts/crm-query.py pricing
```

## The collections

Confirmed against `firestore.rules`:

| Collection | Holds | Fields that matter for pricing |
|---|---|---|
| `jobs` | Work scheduled, done, or cancelled | `price`, `serviceType`, `status` (`scheduled` / `in_progress` / `complete` / `cancelled`), `customerId`, `completedAt`, `paidAt`, `createdAt` |
| `quotes` | What was sent to a customer | `amount`, `serviceType`, `status` (`sent` / `accepted` / `declined` / `no_response`), `sentAt`, `followUpCount` |
| `customers` | The book | `status`, `pipelineStage`, `pipelineValue`, `lifetimeValue`, `serviceTypes`, `source`, `lastContactedAt` |
| `services` | The service catalogue | — |
| `conversations` | SMS threads, `messages` beneath each | — |
| `knockRoutes`, `territories` | Door-knocking ground | — |
| `users` | Crew | — |

`serviceType` is always one of `pressure_washing`, `landscaping`,
`snow_removal`.

**There is no `invoices` or `lineItems` collection.** The Invoice Fly history
was folded into `customers` as `lifetimeValue` by
`scripts/import-legacy-invoices.mjs`; the Flyra history was written into
`jobs` and `quotes` by `scripts/import-flyra.mjs`. So per-job pricing history
is real and queryable, but pre-migration line-item detail is not — do not
promise a breakdown that only exists in a PDF somewhere.
