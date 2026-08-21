# Pricing

**Source of truth: GrimelineCRM (Firestore).** All historical pricing was
migrated from Flyra and Invoice Fly and lives in the CRM. Query it — do not
work from memory or from this file.

Setup: `scripts/README-firestore.md`

## How to get a real number

```bash
python3 scripts/crm-query.py pricing --service pressure_washing
```

Returns min / p25 / median / p75 / max over completed jobs for that service,
plus accepted quotes and the quote win rate. `--since 2026-03-01` narrows it
to this season. Services: `pressure_washing`, `landscaping`, `snow_removal`.

**Run it before answering any price question.** The figures are historical,
not a quote — they are the ground a quote is built on.

Where the CRM has no priced records for a service, the query says so and the
answer is `UNKNOWN — no priced records in CRM`. Do not estimate. Do not
extrapolate. Snow removal in particular may have thin history.

Setup and the collection map: `scripts/README-firestore.md`.

## What the CRM cannot tell you

Pre-migration line-item detail does not exist in Firestore. The Invoice Fly
history came across as customer lifetime value; the Flyra history came across
as jobs and quotes. So per-job totals are real and queryable, but a breakdown
of what went into a 2025 job is not there. Do not promise one.

## Quoting rules

- Ranges are allowed when a firm number isn't available, **clearly flagged as
  an estimate pending a property walk** (D1)
- Anything with a price goes to Nicolas before it goes to a customer (D5)
- Line items by service. **No unit costs, no material costs** (D6, interim)
- Round, clean totals on customer-facing quotes
- Below minimum: decline politely, unless buying signal suggests a bundle (D3)
- Outside 25 miles: flag to Nicolas, no customer reply (D2)

## TODO — Nicolas to fill or confirm via CRM
- [ ] Minimum job size
- [ ] Travel surcharge threshold and rate
- [ ] Commercial vs residential rate difference
- [ ] Recurring / contract discount structure
