"use client";

import { useEffect, useMemo, useState } from "react";

import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { saveSalesTaxSettings, useSalesTaxSettings } from "@/lib/db/settings";
import { formatMoney, formatMoneyExact } from "@/lib/format";
import {
  FILING_FREQUENCIES,
  FILING_FREQUENCY_LABEL,
  recentPeriods,
  taxByPeriod,
  type FilingFrequency,
} from "@/lib/salesTax";

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Sales tax, owner only: the settings, and tax charged and collected per
 * filing period with each return's due date. Mounted by ReportsScreen for
 * the owner; firestore.rules lets only the owner save the settings.
 */
export function SalesTaxSection() {
  const { documents } = useDocuments();
  const { author } = useTeam();
  const settings = useSalesTaxSettings();

  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [permit, setPermit] = useState(settings.permitNumber);
  const [frequency, setFrequency] = useState<FilingFrequency>(settings.filingFrequency);
  const [rate, setRate] = useState(String(settings.defaultRatePct));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setEnabled(settings.enabled);
    setPermit(settings.permitNumber);
    setFrequency(settings.filingFrequency);
    setRate(String(settings.defaultRatePct));
  }, [settings, editing]);

  const rows = useMemo(
    () => taxByPeriod(documents, recentPeriods(new Date(), settings.filingFrequency, 6)),
    [documents, settings.filingFrequency],
  );
  // The return due next is for the period that ended most recently.
  const lastClosed = rows[1];
  const current = rows[0];

  async function save() {
    if (!author) return;
    const pct = Number(rate);
    if (!Number.isFinite(pct) || pct < 0 || pct > 20) {
      setError("Enter a tax rate between 0 and 20%.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveSalesTaxSettings(
        { enabled, permitNumber: permit, filingFrequency: frequency, defaultRatePct: pct },
        author,
      );
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-lg font-bold text-ink">Sales tax</h2>

      {settings.enabled && lastClosed ? (
        <div className="rounded-2xl border border-warn/60 bg-warn/10 p-3">
          <p className="text-sm font-bold tracking-wide text-warn uppercase">
            Return due {fmtDate(lastClosed.period.dueMs)}
          </p>
          <p className="mt-0.5 text-3xl font-extrabold text-ink tabular-nums">
            {formatMoneyExact(lastClosed.charged)}
          </p>
          <p className="mt-1 text-sm font-semibold text-muted">
            Tax charged on invoices issued in {lastClosed.period.label}. {formatMoneyExact(lastClosed.collected)} of
            tax came in from payments that period.
          </p>
          <p className="mt-1 text-sm font-semibold text-muted">
            So far in {current.period.label}: {formatMoney(current.charged)} charged.
          </p>
        </div>
      ) : null}

      {settings.enabled ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.period.key}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block text-base font-bold text-ink">{row.period.label}</span>
                <span className="block text-sm font-semibold text-muted">
                  Due {fmtDate(row.period.dueMs)} · {row.invoiceCount} taxed invoice
                  {row.invoiceCount === 1 ? "" : "s"} · {formatMoney(row.collected)} collected
                </span>
              </span>
              <span className="shrink-0 text-base font-extrabold text-ink tabular-nums">
                {formatMoney(row.charged)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-3 text-base font-semibold text-muted">
          Sales tax tracking is off. New estimates and invoices still start at {settings.defaultRatePct}% tax.
        </p>
      )}

      {editing ? (
        <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap gap-2">
            <Chip active={enabled} onClick={() => setEnabled(true)}>
              Track sales tax
            </Chip>
            <Chip active={!enabled} onClick={() => setEnabled(false)}>
              Off
            </Chip>
          </div>
          <TextField
            label="Kentucky sales tax permit number (printed on invoices)"
            maxLength={40}
            value={permit}
            onChange={(e) => setPermit(e.target.value)}
          />
          <div>
            <p className="mb-1.5 text-sm font-semibold text-muted">Filing frequency (the state assigns it)</p>
            <div className="flex flex-wrap gap-2">
              {FILING_FREQUENCIES.map((f) => (
                <Chip key={f} active={frequency === f} onClick={() => setFrequency(f)}>
                  {FILING_FREQUENCY_LABEL[f]}
                </Chip>
              ))}
            </div>
          </div>
          <TextField
            label="Tax rate new estimates and invoices start with (%)"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <p className="text-sm font-semibold text-muted">
            Changes apply to documents created from now on. Invoices already written keep the rate and
            permit they were issued with.
          </p>
          {error ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button full onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save sales tax settings"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button full variant="secondary" onClick={() => setEditing(true)}>
            Sales tax settings
            {settings.enabled && !settings.permitNumber ? " — add your permit number" : ""}
          </Button>
        </div>
      )}

      <p className="mt-3 text-sm font-semibold text-muted">
        Kentucky charges 6% sales tax on some services, landscaping among them (103 KAR 26:131). Whether
        window cleaning and pressure washing are taxable is a question for your accountant before turning
        tracking on. Returns are due the 20th of the month after each period.
      </p>
    </section>
  );
}
