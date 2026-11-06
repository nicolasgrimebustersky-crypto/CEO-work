"use client";

import { useEffect, useMemo, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { subscribeExpenses, type Expense } from "@/lib/db/expenses";
import {
  EXPENSE_CATEGORY_LABEL,
  PAYMENT_METHOD_LABEL,
  PROOF_BADGE,
  expenseTotals,
  isTaxRemittance,
  knownAssets,
  type ProofKind,
} from "@/lib/expenses";
import { formatMoney, formatMoneyExact } from "@/lib/format";

import { ExpenseSheet } from "./ExpenseSheet";

type Filter = "year" | "no_receipt" | "all";

const PROOF_STYLE: Record<ProofKind, string> = {
  receipt: "border-money/60 bg-money/15 text-money",
  statement: "border-accent/60 bg-accent/15 text-accent",
  in_person: "border-warn/60 bg-warn/15 text-warn",
};

/**
 * Money the business spent, newest first, with what proves each one.
 *
 * The year's total and its paper trail head the screen: how much has gone
 * out, and how much of it would survive somebody asking for the receipt.
 */
export function ExpensesScreen() {
  const { author, isAdmin } = useTeam();
  const uid = author?.uid ?? "";
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("year");
  const [editing, setEditing] = useState<Expense | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The owner sees the business's spending; a crew member sees what they
  // logged themselves. firestore.rules holds the same line.
  useEffect(() => {
    if (!uid) return;
    return subscribeExpenses(
      { uid, isOwner: isAdmin },
      (items) => {
        setExpenses(items);
        setError(null);
      },
      (err) => setError(err.message),
    );
  }, [uid, isAdmin]);

  const year = new Date().getFullYear();
  const totals = useMemo(() => expenseTotals(expenses ?? [], year), [expenses, year]);
  const assets = useMemo(() => knownAssets(expenses ?? []), [expenses]);

  const shown = useMemo(() => {
    const all = expenses ?? [];
    if (filter === "all") return all;
    if (filter === "no_receipt") {
      return all.filter((e) => e.proof !== "receipt" && !isTaxRemittance(e.category));
    }
    return all.filter((e) => e.date.startsWith(`${year}-`));
  }, [expenses, filter, year]);

  /** Grouped by month, newest first, for headings in the list. */
  const months = useMemo(() => {
    const groups = new Map<string, Expense[]>();
    for (const expense of shown) {
      const key = expense.date.slice(0, 7);
      const list = groups.get(key) ?? [];
      list.push(expense);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [shown]);

  const missingCount = (expenses ?? []).filter(
    (e) => e.proof !== "receipt" && !isTaxRemittance(e.category),
  ).length;
  const backed = totals.byProof.receipt + totals.byProof.statement;

  function openNew() {
    setEditing(null);
    setSheetOpen(true);
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={isAdmin ? "Expenses" : "My expenses"}
        subtitle={`${year} · ${formatMoney(totals.spent)} ${isAdmin ? "spent" : "logged by you"}`}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        <Button full onClick={openNew}>
          + Add an expense
        </Button>

        {expenses === null ? (
          <div className="mt-6">
            <Spinner label="Loading expenses…" />
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-3">
              <p className="text-sm font-bold tracking-wide text-muted uppercase">
                {isAdmin ? `Spent in ${year}` : `You logged in ${year}`}
              </p>
              <p className="mt-0.5 text-3xl font-extrabold text-ink tabular-nums">
                {formatMoney(totals.spent)}
              </p>
              {isAdmin ? (
                <p className="mt-1 text-sm font-semibold text-muted">
                  {formatMoney(totals.deductible)} counts against profit
                  {totals.deductible < totals.spent ? " (meals count half)" : ""}
                  {totals.taxPaid > 0 ? ` · ${formatMoney(totals.taxPaid)} tax paid` : ""}
                </p>
              ) : null}

              {totals.spent > 0 ? (
                <>
                  <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface">
                    <span className="bg-money" style={{ width: `${(totals.byProof.receipt / totals.spent) * 100}%` }} />
                    <span className="bg-accent" style={{ width: `${(totals.byProof.statement / totals.spent) * 100}%` }} />
                    <span className="bg-warn" style={{ width: `${(totals.byProof.in_person / totals.spent) * 100}%` }} />
                  </div>
                  <ul className="mt-2 grid grid-cols-3 gap-1 text-sm font-semibold">
                    <li className="text-money">Receipts {formatMoney(totals.byProof.receipt)}</li>
                    <li className="text-accent">Statements {formatMoney(totals.byProof.statement)}</li>
                    <li className="text-warn">No paper {formatMoney(totals.byProof.in_person)}</li>
                  </ul>
                  <p className="mt-2 text-sm font-semibold text-muted">
                    {Math.round((backed / totals.spent) * 100)}% has paper behind it.
                    {totals.byProof.in_person > 0
                      ? " Find a receipt or a statement line for the rest — an expense with no paper is the first one an audit throws out."
                      : ""}
                  </p>
                </>
              ) : null}
            </div>

            {totals.byCategory.length > 0 ? (
              <section className="mt-4">
                <h2 className="mb-2 text-lg font-bold text-ink">By kind, {year}</h2>
                <ul className="flex flex-col gap-1.5">
                  {totals.byCategory.map((row) => (
                    <li
                      key={row.category}
                      className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2"
                    >
                      <span className="text-base font-bold text-ink">
                        {EXPENSE_CATEGORY_LABEL[row.category]}
                        <span className="ml-1.5 text-sm font-semibold text-muted">× {row.count}</span>
                      </span>
                      <span className="text-base font-extrabold text-ink tabular-nums">
                        {formatMoney(row.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              <Chip active={filter === "year"} onClick={() => setFilter("year")}>
                This year
              </Chip>
              <Chip active={filter === "no_receipt"} onClick={() => setFilter("no_receipt")}>
                No receipt{missingCount > 0 ? ` (${missingCount})` : ""}
              </Chip>
              <Chip active={filter === "all"} onClick={() => setFilter("all")}>
                All
              </Chip>
            </div>

            {months.length === 0 ? (
              <p className="mt-4 rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
                {filter === "no_receipt"
                  ? "Every expense has a receipt."
                  : "Nothing logged yet. Gas, a new nozzle, a jug of degreaser — add it here and snap the receipt."}
              </p>
            ) : (
              months.map(([month, items]) => (
                <section key={month} className="mt-5">
                  <h3 className="mb-2 text-sm font-bold tracking-wide text-muted uppercase">
                    {new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {items.map((expense) => (
                      <li key={expense.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(expense);
                            setSheetOpen(true);
                          }}
                          className="tap-target flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left hover:bg-surface-3"
                        >
                          {expense.receipt && expense.receipt.contentType !== "application/pdf" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={expense.receipt.url}
                              alt=""
                              className="size-11 shrink-0 rounded-lg border border-line object-cover"
                            />
                          ) : (
                            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-xs font-extrabold text-muted">
                              {expense.receipt ? "PDF" : expense.date.slice(8)}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-bold text-ink">
                              {EXPENSE_CATEGORY_LABEL[expense.category]}
                              {expense.forWhat ? ` · ${expense.forWhat}` : ""}
                            </span>
                            <span className="block truncate text-sm font-semibold text-muted">
                              {[
                                isAdmin && expense.createdBy !== uid ? expense.createdByName : "",
                                expense.vendor,
                                new Date(`${expense.date}T12:00:00`).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                }),
                                PAYMENT_METHOD_LABEL[expense.paymentMethod],
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-base font-extrabold text-ink tabular-nums">
                              {formatMoneyExact(expense.amount)}
                            </span>
                            {isTaxRemittance(expense.category) ? (
                              <span className="rounded-full border border-line px-2 py-0.5 text-xs font-bold text-muted">
                                Tax
                              </span>
                            ) : (
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs font-bold ${PROOF_STYLE[expense.proof]}`}
                              >
                                {PROOF_BADGE[expense.proof]}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>

      <ExpenseSheet
        open={sheetOpen}
        expense={editing}
        assets={assets}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
