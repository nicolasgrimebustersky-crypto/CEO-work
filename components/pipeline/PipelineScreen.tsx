"use client";

import { differenceInDays } from "date-fns";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Spinner } from "@/components/ui/Spinner";
import { customerName, formatMoney, formatRelative } from "@/lib/format";
import {
  PIPELINE_COLOR,
  PIPELINE_HINT,
  PIPELINE_LABEL,
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/lib/pipeline";
import { routes } from "@/lib/routes";
import { LEAD_SOURCE_LABEL, type Customer } from "@/lib/types";
import { StageSheet } from "./StageSheet";

/** A lead untouched for this long in an open stage gets flagged. */
const STALE_DAYS = 7;

export function PipelineScreen() {
  const { customers, loading, error } = useCustomers();
  const { colorFor } = useTeam();
  const [selected, setSelected] = useState<Customer | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const stages = useMemo(
    () => (showClosed ? PIPELINE_STAGES : PIPELINE_STAGES.filter((s) => s !== "paid" && s !== "lost")),
    [showClosed],
  );

  const byStage = useMemo(() => {
    const map = new Map<PipelineStage, Customer[]>();
    for (const stage of PIPELINE_STAGES) map.set(stage, []);
    for (const customer of customers) {
      map.get(customer.pipelineStage)?.push(customer);
    }
    // Oldest first inside a column: the thing that has been sitting longest is
    // the thing most at risk of being forgotten.
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          (a.pipelineChangedAt?.toMillis() ?? a.createdAt.toMillis()) -
          (b.pipelineChangedAt?.toMillis() ?? b.createdAt.toMillis()),
      );
    }
    return map;
  }, [customers]);

  const openValue = useMemo(
    () =>
      customers
        .filter((c) => c.pipelineStage !== "paid" && c.pipelineStage !== "lost")
        .reduce((sum, c) => sum + c.pipelineValue, 0),
    [customers],
  );

  const liveSelected = selected
    ? (customers.find((c) => c.id === selected.id) ?? null)
    : null;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Pipeline" subtitle={`${formatMoney(openValue)} in play`}>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            aria-pressed={!showClosed}
            onClick={() => setShowClosed(false)}
            className={`tap-target rounded-full border px-3.5 text-sm font-bold ${
              !showClosed
                ? "border-accent bg-accent text-accent-ink"
                : "border-line bg-surface-2 text-ink"
            }`}
          >
            Open
          </button>
          <button
            type="button"
            aria-pressed={showClosed}
            onClick={() => setShowClosed(true)}
            className={`tap-target rounded-full border px-3.5 text-sm font-bold ${
              showClosed
                ? "border-accent bg-accent text-accent-ink"
                : "border-line bg-surface-2 text-ink"
            }`}
          >
            All stages
          </button>
        </div>
      </ScreenHeader>

      {error ? (
        <p
          role="alert"
          className="m-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <Spinner label="Loading pipeline…" />
      ) : (
        /* Columns scroll horizontally. On a phone you see one and a bit at a
           time, which is the right unit of attention — you work one stage. */
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full min-w-max gap-3 px-3 pb-3">
            {stages.map((stage) => {
              const items = byStage.get(stage) ?? [];
              const value = items.reduce((sum, c) => sum + c.pipelineValue, 0);

              return (
                <section
                  key={stage}
                  className="flex h-full w-[17rem] shrink-0 flex-col"
                  aria-label={PIPELINE_LABEL[stage]}
                >
                  <header
                    className="shrink-0 rounded-t-xl border-t-4 bg-surface px-3 py-2"
                    style={{ borderTopColor: PIPELINE_COLOR[stage] }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="text-base font-black text-ink">
                        {PIPELINE_LABEL[stage]}
                      </h2>
                      <span className="text-sm font-black text-muted">
                        {items.length}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-muted">
                      {value > 0 ? formatMoney(value) : PIPELINE_HINT[stage]}
                    </p>
                  </header>

                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-b-xl bg-surface/40 p-2">
                    {items.length === 0 ? (
                      <p className="px-1 py-3 text-sm font-semibold text-muted">
                        Nothing here.
                      </p>
                    ) : null}

                    {items.map((customer) => (
                      <LeadCard
                        key={customer.id}
                        customer={customer}
                        loggedByColor={colorFor(customer.createdBy)}
                        onOpen={() => setSelected(customer)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <StageSheet customer={liveSelected} onClose={() => setSelected(null)} />
    </div>
  );
}

function LeadCard({
  customer,
  loggedByColor,
  onOpen,
}: {
  customer: Customer;
  loggedByColor: string;
  onOpen: () => void;
}) {
  const since = customer.pipelineChangedAt ?? customer.createdAt;
  const days = differenceInDays(new Date(), since.toDate());
  const open = customer.pipelineStage !== "paid" && customer.pipelineStage !== "lost";
  const stale = open && days >= STALE_DAYS;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-xl border bg-surface-2 p-2.5 text-left ${
        stale ? "border-warn/70" : "border-line"
      }`}
      style={{ borderLeft: `4px solid ${loggedByColor}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-base font-bold text-ink">
          {customerName(customer)}
        </span>
        {customer.pipelineValue > 0 ? (
          <span className="shrink-0 text-sm font-black text-accent">
            {formatMoney(customer.pipelineValue)}
          </span>
        ) : null}
      </div>

      {customer.address ? (
        <span className="mt-0.5 block truncate text-sm font-semibold text-muted">
          {customer.address}
        </span>
      ) : (
        <span className="mt-0.5 block text-sm font-semibold text-warn">
          No address yet
        </span>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {customer.source !== "door_knock" ? (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-bold text-ink">
            {LEAD_SOURCE_LABEL[customer.source]}
          </span>
        ) : null}
        <span className={`text-xs font-bold ${stale ? "text-warn" : "text-muted"}`}>
          {stale ? `Sitting ${days} days` : formatRelative(since)}
        </span>
      </div>
    </button>
  );
}

/** Small helper used by the empty state elsewhere. */
export function PipelineEmptyHint() {
  return (
    <Link
      href={routes.pipeline}
      className="tap-target inline-flex items-center rounded-xl bg-accent px-4 text-base font-bold text-accent-ink"
    >
      Open pipeline
    </Link>
  );
}
