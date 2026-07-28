"use client";

import Link from "next/link";
import { useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { setPipelineStage } from "@/lib/db/customers";
import { customerName, formatMoney, formatPhone, formatRelative } from "@/lib/format";
import {
  nextStage,
  PIPELINE_COLOR,
  PIPELINE_HINT,
  PIPELINE_LABEL,
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/lib/pipeline";
import { routes } from "@/lib/routes";
import { LEAD_SOURCE_LABEL, type Customer } from "@/lib/types";

/**
 * Tap a card, move the lead.
 *
 * Deliberately not drag-and-drop. The calendar earns its drag because a job has
 * a position in time you are physically moving it to; a pipeline stage is just
 * a label, and dragging a card across seven horizontally-scrolling columns on a
 * phone is far more work than picking from a list. The big "advance" button
 * covers the common case in one thumb tap.
 */
export function StageSheet({
  customer,
  onClose,
}: {
  customer: Customer | null;
  onClose: () => void;
}) {
  const { author, colorFor } = useTeam();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!customer) return null;

  /**
   * `close` on the primary advance button but not on the stage chips: tapping
   * "Move to Scheduled" is a decision you have made, and dropping back to the
   * board shows it landing in the new column. The chips are for picking an
   * exact stage, where staying put lets you see what you chose.
   */
  async function moveTo(stage: PipelineStage, close = false) {
    if (!customer || !author) return;
    setBusy(true);
    setError(null);
    try {
      await setPipelineStage(customer, stage, author);
      if (close) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move this lead.");
    } finally {
      setBusy(false);
    }
  }

  const forward = nextStage(customer.pipelineStage);

  return (
    <Sheet
      open
      title={customerName(customer)}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Link
            href={routes.customer(customer.id)}
            // shrink-0 and nowrap because the advance button next to it is
            // w-full: without them "Full record" gets squeezed onto two lines.
            className="tap-target inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-surface-2 px-4 py-3 text-base font-semibold text-ink"
          >
            Full record
          </Link>
          {forward ? (
            <Button full onClick={() => void moveTo(forward, true)} disabled={busy}>
              Move to {PIPELINE_LABEL[forward]}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2.5 py-1 text-sm font-black text-black"
            style={{ backgroundColor: PIPELINE_COLOR[customer.pipelineStage] }}
          >
            {PIPELINE_LABEL[customer.pipelineStage]}
          </span>
          <span className="text-sm font-bold text-muted">
            {LEAD_SOURCE_LABEL[customer.source]}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-ink">
            {PIPELINE_HINT[customer.pipelineStage]}
          </p>
          <p className="text-sm font-semibold text-muted">
            In this stage since {formatRelative(customer.pipelineChangedAt ?? customer.createdAt)}
            {customer.pipelineValue > 0
              ? ` · ${formatMoney(customer.pipelineValue)} on the table`
              : ""}
          </p>
        </div>

        {customer.address || customer.phone ? (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            {customer.address ? (
              <p className="text-base font-semibold text-ink">{customer.address}</p>
            ) : null}
            {customer.phone ? (
              <a
                href={`tel:${customer.phone.replace(/\D/g, "")}`}
                className="mt-1 block text-base font-bold text-accent"
              >
                {formatPhone(customer.phone)}
              </a>
            ) : null}
          </div>
        ) : (
          <p className="rounded-xl border border-warn/70 bg-warn/20 px-3 py-2.5 text-base font-semibold text-ink">
            No address on this lead yet, so it has no pin on the map. Open the full
            record to add one.
          </p>
        )}

        <section>
          <h3 className="mb-2 text-sm font-bold text-muted">Move to any stage</h3>
          <div className="flex flex-wrap gap-2">
            {PIPELINE_STAGES.map((stage) => {
              const active = stage === customer.pipelineStage;
              return (
                <button
                  key={stage}
                  type="button"
                  aria-pressed={active}
                  disabled={busy}
                  onClick={() => void moveTo(stage)}
                  className={`tap-target rounded-full border px-3.5 text-sm font-bold disabled:opacity-50 ${
                    active ? "text-black" : "border-line bg-surface-2 text-ink"
                  }`}
                  style={
                    active
                      ? {
                          backgroundColor: PIPELINE_COLOR[stage],
                          borderColor: PIPELINE_COLOR[stage],
                        }
                      : undefined
                  }
                >
                  {PIPELINE_LABEL[stage]}
                </button>
              );
            })}
          </div>
        </section>

        {customer.notes[0] ? (
          <section>
            <h3 className="mb-2 text-sm font-bold text-muted">Latest note</h3>
            <div
              className="rounded-xl border border-line bg-surface-2 p-3"
              style={{ borderLeft: `4px solid ${colorFor(customer.notes[0].authorUid)}` }}
            >
              <p className="text-base text-ink">{customer.notes[0].text}</p>
              <p className="mt-1.5 text-sm font-semibold text-muted">
                {customer.notes[0].authorName} · {formatRelative(customer.notes[0].createdAt)}
              </p>
            </div>
          </section>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
