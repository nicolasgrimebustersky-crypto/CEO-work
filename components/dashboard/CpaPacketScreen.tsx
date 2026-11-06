"use client";

import { useEffect, useMemo, useState } from "react";

import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { BUSINESS } from "@/lib/business";
import { buildPacket, packetCsv, type PacketExpense } from "@/lib/cpaPacket";
import { subscribePayRuns, type StoredPayRun } from "@/lib/db/crewPay";
import { subscribeExpenses, type Expense } from "@/lib/db/expenses";
import { fetchJobsBetween } from "@/lib/db/jobs";
import { subscribeTrips, type Trip } from "@/lib/db/mileage";
import { useMileageSettings } from "@/lib/db/settings";
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, PROOF_BADGE, type ExpenseCategory, type PaymentMethod, type ProofKind } from "@/lib/expenses";
import { formatMoneyExact } from "@/lib/format";
import { rateFor } from "@/lib/mileage";
import { grossFor } from "@/lib/money/summary";
import { periodContaining, taxByPeriod } from "@/lib/salesTax";
import type { Job } from "@/lib/types";

const money = (v: number) => formatMoneyExact(v);
const label = (c: string) => EXPENSE_CATEGORY_LABEL[c as ExpenseCategory] ?? c;

/**
 * The year-end packet for the accountant, owner only. One page that prints
 * (or saves as PDF from the print dialog, on a phone too) with the receipts
 * on it, and the same figures as one CSV. Built by lib/cpaPacket.ts from what
 * the app already holds; nothing is stored.
 */
export function CpaPacketScreen() {
  const { author, isAdmin } = useTeam();
  const { documents } = useDocuments();
  const mileage = useMileageSettings();
  const uid = author?.uid ?? "";
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [payRuns, setPayRuns] = useState<StoredPayRun[]>([]);

  useEffect(() => {
    setJobs(null);
    fetchJobsBetween(new Date(year, 0, 1), new Date(year + 1, 0, 1))
      .then(setJobs)
      .catch(() => setJobs([]));
  }, [year]);
  useEffect(() => {
    if (!uid || !isAdmin) return;
    const a = subscribeExpenses({ uid, isOwner: true }, setExpenses, () => setExpenses([]));
    const b = subscribeTrips({ uid, isOwner: true }, setTrips, () => setTrips([]));
    const c = subscribePayRuns({ uid, isOwner: true }, setPayRuns, () => setPayRuns([]));
    return () => {
      a();
      b();
      c();
    };
  }, [uid, isAdmin]);

  const packet = useMemo(() => {
    if (!jobs) return null;
    const [tax] = taxByPeriod(documents, [periodContaining(new Date(year, 6, 1), "annual")]);
    return buildPacket({
      year,
      grossReceipts: grossFor(year, jobs, documents).total,
      expenses: expenses.map(
        (e): PacketExpense => ({
          id: e.id,
          date: e.date,
          amount: e.amount,
          category: e.category,
          vendor: e.vendor,
          forWhat: e.forWhat,
          paymentMethod: e.paymentMethod,
          proof: e.proof,
          notes: e.notes,
          createdByName: e.createdByName,
          receiptUrl: e.receipt?.url ?? null,
        }),
      ),
      trips: trips.map((t) => ({
        date: t.date,
        miles: t.miles,
        reason: t.reason,
        createdByName: t.createdByName,
        estimated: t.estimated,
        value: (t.miles * rateFor(t.date)) / 100,
      })),
      salesTax: { charged: tax?.charged ?? 0, collected: tax?.collected ?? 0 },
      mileageMethod: mileage.method,
      payRuns: payRuns.map((r) => ({ name: r.name, gross: r.gross, classification: r.classification, paidOn: r.paidOn })),
    });
  }, [jobs, documents, expenses, trips, payRuns, year, mileage.method]);

  function downloadCsv() {
    if (!packet) return;
    const blob = new Blob([packetCsv(packet, BUSINESS.name)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${BUSINESS.name.replace(/[^A-Za-z0-9]+/g, "-")}-${year}-year-end.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!isAdmin) {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title="Year-end packet" />
        <p className="m-4 rounded-xl border border-line bg-surface-2 px-3 py-4 font-semibold text-muted">
          Only the owner can open the year-end packet.
        </p>
      </div>
    );
  }

  const withReceipts = packet?.expenses.filter((e) => e.receiptUrl) ?? [];

  return (
    <div className="flex h-full flex-col print:block print:h-auto">
      <div className="print:hidden">
        <ScreenHeader title="Year-end packet" subtitle="For your accountant">
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {[thisYear, thisYear - 1].map((y) => (
              <Chip key={y} active={year === y} onClick={() => setYear(y)}>
                {y}
              </Chip>
            ))}
            <span className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={downloadCsv} disabled={!packet}>
                CSV
              </Button>
              <Button onClick={() => window.print()} disabled={!packet}>
                Save PDF
              </Button>
            </span>
          </div>
        </ScreenHeader>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-4 text-black print:overflow-visible print:p-0">
        {!packet ? (
          <Spinner label="Putting the year together…" />
        ) : (
          <div className="mx-auto max-w-3xl text-sm">
            <h1 className="text-2xl font-extrabold">{BUSINESS.name} — {year}</h1>
            <p className="text-gray-600">
              Year-end packet. Money in is what was received in {year}. Line numbers follow Schedule C as a
              starting point; the accountant has the final say.
            </p>

            <Section title="Profit and loss (Schedule C)">
              <Table
                head={["Line", "Description", "Amount"]}
                rows={[
                  ...packet.lines.map((l) => [l.line, l.label, money(l.amount)]),
                  ["", "Total expenses", money(packet.totalExpenses)],
                  ["31", "Net profit", money(packet.netProfit)],
                ]}
                right={[2]}
              />
              {packet.paperless > 0 ? (
                <p className="mt-1 text-gray-600">
                  {money(packet.paperless)} of expenses are confirmed in person only, with no receipt or statement.
                </p>
              ) : null}
            </Section>

            <Section title="Sales tax">
              <Table
                head={["", "Amount"]}
                rows={[
                  ["Charged on invoices issued", money(packet.salesTax.charged)],
                  ["Collected in payments received", money(packet.salesTax.collected)],
                  ["Paid to the state", money(packet.salesTax.remitted)],
                ]}
                right={[1]}
              />
            </Section>

            <Section title={`Contractors (1099-NEC from ${money(packet.contractorThreshold)})`}>
              {packet.contractors.length === 0 ? (
                <p className="text-gray-600">No payments logged as help or subcontractors.</p>
              ) : (
                <Table
                  head={["Name", "Paid", "Payments", "1099-NEC"]}
                  rows={packet.contractors.map((c) => [c.name, money(c.paid), String(c.payments), c.needs1099 ? "Needed" : "—"])}
                  right={[1, 2]}
                />
              )}
              <p className="mt-1 text-gray-600">
                Help logged as expenses and 1099 crew pay. A W-9 is needed from anyone who will get a 1099; W-2
                wages are on line 26 and their W-2s come from the payroll service.
              </p>
            </Section>

            <Section title="Estimated tax payments">
              {packet.estimatedPayments.length === 0 ? (
                <p className="text-gray-600">None logged.</p>
              ) : (
                <Table
                  head={["Date", "Paid to", "Amount"]}
                  rows={[...packet.estimatedPayments.map((e) => [e.date, e.vendor, money(e.amount)]), ["", "Total", money(packet.estimatedPaid)]]}
                  right={[2]}
                />
              )}
            </Section>

            <Section title={`Mileage log — ${packet.miles} mi${mileage.method === "standard" ? `, ${money(packet.mileageValue)} at the IRS rate` : " (actual-cost method: shown for the record)"}`}>
              {packet.trips.length === 0 ? (
                <p className="text-gray-600">No trips logged.</p>
              ) : (
                <Table
                  head={["Date", "Miles", "Reason", "Driver"]}
                  rows={packet.trips.map((t) => [t.date, `${t.miles}${t.estimated ? "*" : ""}`, t.reason, t.createdByName])}
                  right={[1]}
                />
              )}
              {packet.trips.some((t) => t.estimated) ? <p className="mt-1 text-gray-600">* estimated from a straight line, not road distance.</p> : null}
            </Section>

            <Section title="Every expense">
              <Table
                head={["Date", "What", "Where", "Paid with", "Proof", "Amount"]}
                rows={packet.expenses.map((e) => [
                  e.date,
                  `${label(e.category)}${e.forWhat ? ` · ${e.forWhat}` : ""}`,
                  e.vendor,
                  PAYMENT_METHOD_LABEL[e.paymentMethod as PaymentMethod] ?? e.paymentMethod,
                  PROOF_BADGE[e.proof as ProofKind] ?? e.proof,
                  money(e.amount),
                ])}
                right={[5]}
              />
            </Section>

            {withReceipts.length > 0 ? (
              <Section title="Receipts">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {withReceipts.map((e) => (
                    <figure key={e.id} className="break-inside-avoid">
                      {e.receiptUrl && !e.receiptUrl.includes(".pdf") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.receiptUrl} alt="" className="max-h-64 w-full border border-gray-300 object-contain" />
                      ) : (
                        <a href={e.receiptUrl ?? "#"} className="block border border-gray-300 p-6 text-center font-bold">
                          PDF receipt
                        </a>
                      )}
                      <figcaption className="mt-1 text-xs text-gray-700">
                        {e.date} · {e.vendor || label(e.category)} · {money(e.amount)}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </Section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid-page">
      <h2 className="mb-2 border-b border-gray-300 pb-1 text-base font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows, right = [] }: { head: string[]; rows: string[][]; right?: number[] }) {
  return (
    <table className="w-full border-collapse text-left text-xs">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} className={`border-b border-gray-300 py-1 pr-2 font-bold ${right.includes(i) ? "text-right" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="break-inside-avoid">
            {r.map((c, i) => (
              <td key={i} className={`border-b border-gray-100 py-1 pr-2 align-top ${right.includes(i) ? "text-right tabular-nums" : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
