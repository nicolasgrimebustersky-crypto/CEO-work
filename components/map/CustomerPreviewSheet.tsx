"use client";

import Link from "next/link";
import { useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip, StatusPill, UserChip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { addNote, changeStatus } from "@/lib/db/customers";
import { customerName, formatPhone, formatRelative } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";
import { CUSTOMER_STATUSES } from "@/lib/types";
import type { Customer } from "@/lib/types";
import { routes } from "@/lib/routes";

/**
 * What you get when you tap an existing pin: enough to decide whether to knock,
 * plus the three things worth doing on the doorstep — call, change status, drop
 * a note. Anything deeper is one tap away on the detail page.
 */
export function CustomerPreviewSheet({
  customer,
  onClose,
}: {
  customer: Customer | null;
  onClose: () => void;
}) {
  const { author, colorFor } = useTeam();
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!customer) return null;

  async function onStatusChange(next: Customer["status"]) {
    if (!customer || !author) return;
    setBusy(true);
    try {
      await changeStatus(customer, next, author);
    } finally {
      setBusy(false);
    }
  }

  async function onAddNote() {
    if (!customer || !author || !noteText.trim()) return;
    setBusy(true);
    try {
      await addNote(customer, noteText, "note", author);
      setNoteText("");
    } finally {
      setBusy(false);
    }
  }

  const latestNote = customer.notes[0] ?? null;

  return (
    <Sheet
      open
      title={customerName(customer)}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          {customer.phone ? (
            <a
              href={`tel:${customer.phone.replace(/\D/g, "")}`}
              className="tap-target inline-flex flex-1 items-center justify-center rounded-xl bg-surface-2 px-4 py-3 text-base font-semibold text-ink"
            >
              Call
            </a>
          ) : null}
          <Link
            href={routes.customer(customer.id)}
            className="tap-target inline-flex flex-1 items-center justify-center rounded-xl bg-accent px-4 py-3 text-base font-semibold text-accent-ink"
          >
            Full record
          </Link>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={customer.status} />
          <UserChip
            name={customer.createdByName}
            color={colorFor(customer.createdBy)}
            suffix="logged"
          />
        </div>

        <div className="flex flex-col gap-1">
          {customer.address ? (
            <p className="text-base font-semibold text-ink">{customer.address}</p>
          ) : null}
          {customer.phone ? (
            <p className="text-base font-semibold text-muted">
              {formatPhone(customer.phone)}
            </p>
          ) : null}
          <p className="text-sm font-semibold text-muted">
            Last contacted {formatRelative(customer.lastContactedAt)}
            {customer.lastContactedByName ? ` by ${customer.lastContactedByName}` : ""}
          </p>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-bold text-muted">Change status</h3>
          <div className="flex flex-wrap gap-2">
            {CUSTOMER_STATUSES.map((status) => (
              <Chip
                key={status}
                active={customer.status === status}
                onClick={busy ? undefined : () => void onStatusChange(status)}
              >
                {STATUS_LABEL[status]}
              </Chip>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-bold text-muted">Add a note</h3>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            placeholder="Not home, try Saturday…"
            className="tap-target w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <Button
            variant="secondary"
            full
            className="mt-2"
            onClick={() => void onAddNote()}
            disabled={busy || !noteText.trim()}
          >
            Save note
          </Button>
        </section>

        {latestNote ? (
          <section>
            <h3 className="mb-2 text-sm font-bold text-muted">Latest note</h3>
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-base text-ink">{latestNote.text}</p>
              <p className="mt-2 text-sm font-semibold text-muted">
                {latestNote.authorName} · {formatRelative(latestNote.createdAt)}
              </p>
            </div>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
