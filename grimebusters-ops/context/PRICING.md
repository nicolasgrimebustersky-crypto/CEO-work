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
extrapolate. Snow removal is the one exception, and it has its own section
below — the CRM holds zero priced snow records, so the rate there comes from
Nicolas directly, not from a query.

Setup and the collection map: `scripts/README-firestore.md`.

## Snow removal

**$60–100 per visit, scaling with driveway size.** Small or standard
driveways sit at the $60 end; $100 is the top of the range and uncommon,
reserved for large or long ones. The range tracks property size — it is not
a bundle price and not a per-extra add-on.

This number is from Nicolas (2026-08-23), not from the CRM. A `pricing
--service snow_removal` query returns `UNKNOWN — no priced records`, and that
is correct: the migration brought across no priced snow jobs. Quote from this
section, and say the figure is the standard rate rather than a historical
median. If the CRM starts carrying completed snow jobs, query it and prefer
what it says over this paragraph.

**The $250 minimum job size does not apply to snow.** Snow clearing is a
per-visit recurring service, not a one-off job — declining a $75 driveway
because it misses a floor written for pressure washing would be wrong.

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
- **Minimum job size: $250.** Below that, decline politely — unless the
  customer's responses suggest buying signal, in which case offer a bundle to
  clear the minimum. Judgment call, state which way you went (D3).
  **Snow removal is exempt** — see the snow section above.
- **Travel surcharge: 15+ miles from Crestwood, $50–100.** Exact figure in
  that range is Nicolas's call per job — flag the distance and let him set
  the number, don't pick one yourself.
- **Outside 25 miles: flag to Nicolas, no customer reply at all** (D2). The
  travel surcharge only applies inside that radius, between 15 and 25 miles.
- **Commercial tends to run higher than residential.** No fixed multiplier —
  scope and scale drive it case by case. Don't apply a flat percentage bump.
- **No discounts, ever, without Nicolas's explicit sign-off on that specific
  instance.** Not a discount tier, not a standing referral rate, not a
  recurring-contract structure — every discount is a one-off he approves.
  Default assumption is full price.
