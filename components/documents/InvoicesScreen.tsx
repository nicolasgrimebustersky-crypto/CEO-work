"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useDocuments } from "@/components/providers/DocumentsProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Spinner } from "@/components/ui/Spinner";
import { isOutstanding } from "@/lib/documents";
import { formatDateOnly, formatMoney, formatMoneyExact } from "@/lib/format";
import { routes } from "@/lib/routes";
import { SERVICE_SHORT_LABEL } from "@/lib/status";
import { CustomerPickerSheet } from "./CustomerPickerSheet";
import { StatusPill } from "./StatusPill";

const FILTERS = ["Owed", "Invoices", "Estimates", "All"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Every estimate and invoice in one list, opening on what is still owed.
 *
 * That default is deliberate: the question this screen exists to answer at
 * seven in the morning is "who owes us money", not "what have we ever sent".
 */
export function InvoicesScreen() {
  const { documents, outstanding, loading, error } = useDocuments();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("Owed");
  const [term, setTerm] = useState("");
  const [picking, setPicking] = useState<"estimate" | "invoice" | null>(null);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return documents.filter((document) => {
      if (needle) {
        const haystack = `${document.customerName} ${document.number}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (filter === "Owed") return isOutstanding(document);
      if (filter === "Invoices") return document.kind === "invoice";
      if (filter === "Estimates") return document.kind === "estimate";
      return true;
    });
  }, [documents, filter, term]);

  const openEstimates = useMemo(
    () =>
      documents
        .filter((d) => d.kind === "estimate" && (d.status === "sent" || d.status === "draft"))
        .reduce((sum, d) => sum + d.total, 0),
    [documents],
  );

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Invoices" subtitle="Estimates, invoices and what's owed">
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Owed to you" value={formatMoney(outstanding)} tone="money" />
          <Stat label="Out for quote" value={formatMoney(openEstimates)} />
        </div>

        <div className="mt-3 flex gap-2">
          <Button full onClick={() => setPicking("estimate")}>
            New estimate
          </Button>
          <Button variant="secondary" onClick={() => setPicking("invoice")}>
            Invoice
          </Button>
        </div>

        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by name or number"
          aria-label="Search estimates and invoices"
          className="tap-target mt-3 w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((option) => (
            <Chip key={option} active={filter === option} onClick={() => setFilter(option)}>
              {option}
            </Chip>
          ))}
        </div>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
            >
              {error}
            </p>
          ) : loading ? (
            <div className="flex justify-center py-10">
              <Spinner label="Loading…" />
            </div>
          ) : visible.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-6 text-center text-base font-semibold text-muted">
              {filter === "Owed"
                ? "Nothing outstanding. Everyone has paid."
                : "Nothing here yet. Tap “New estimate” to price a job."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visible.map((document) => (
                <li key={document.id}>
                  <button
                    type="button"
                    onClick={() => router.push(routes.document(document.id))}
                    className="w-full rounded-xl border border-line bg-surface-2 p-3 text-left active:bg-surface-3"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-base font-bold break-words text-ink">
                          {document.customerName || "Unknown customer"}
                        </span>
                        <span className="block text-sm font-semibold text-muted">
                          {document.kind === "invoice" ? "Invoice" : "Estimate"}{" "}
                          {document.number} · {SERVICE_SHORT_LABEL[document.serviceType]} ·{" "}
                          {formatDateOnly(document.issuedAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-base font-extrabold text-ink tabular-nums">
                          {formatMoneyExact(document.total)}
                        </span>
                        {document.balanceDue > 0 && document.amountPaid > 0 ? (
                          <span className="block text-sm font-bold text-warn tabular-nums">
                            {formatMoneyExact(document.balanceDue)} left
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="mt-2 block">
                      <StatusPill status={document.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CustomerPickerSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={(customerId) => {
          const kind = picking ?? "estimate";
          setPicking(null);
          router.push(routes.newDocument(kind, customerId));
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "money";
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 px-3 py-2.5">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p
        className={`text-xl font-extrabold tabular-nums ${
          tone === "money" ? "text-money" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
