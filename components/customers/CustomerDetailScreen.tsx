"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip, StatusPill, UserChip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { addNote, changeStatus } from "@/lib/db/customers";
import { completedRevenue, subscribeJobsForCustomer } from "@/lib/db/jobs";
import { subscribeQuotesForCustomer } from "@/lib/db/quotes";
import {
  customerName,
  formatDateOnly,
  formatMoney,
  formatPhone,
  formatRelative,
  formatTimestamp,
} from "@/lib/format";
import {
  JOB_STATUS_LABEL,
  QUOTE_STATUS_LABEL,
  SERVICE_LABEL,
  STATUS_LABEL,
} from "@/lib/status";
import { CUSTOMER_STATUSES } from "@/lib/types";
import type { Job, Photo, Quote } from "@/lib/types";
import { EditCustomerSheet } from "./EditCustomerSheet";
import { NotesTimeline } from "./NotesTimeline";

export function CustomerDetailScreen({ customerId }: { customerId: string }) {
  const { byId, loading } = useCustomers();
  const { author, colorFor, nameFor } = useTeam();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => subscribeJobsForCustomer(customerId, setJobs), [customerId]);
  useEffect(() => subscribeQuotesForCustomer(customerId, setQuotes), [customerId]);

  const customer = byId.get(customerId) ?? null;

  /**
   * Revenue is computed from completed jobs rather than read from
   * `lifetimeValue`, so it can't drift — the stored field is a cache for
   * sorting the list view, this is the number of record.
   */
  const revenue = useMemo(() => completedRevenue(jobs), [jobs]);

  const photos = useMemo(() => {
    const all: { photo: Photo; label: string; jobId: string }[] = [];
    for (const job of jobs) {
      for (const photo of job.beforePhotos) {
        all.push({ photo, label: "Before", jobId: job.id });
      }
      for (const photo of job.afterPhotos) {
        all.push({ photo, label: "After", jobId: job.id });
      }
    }
    return all.sort((a, b) => b.photo.takenAt.toMillis() - a.photo.takenAt.toMillis());
  }, [jobs]);

  if (loading && !customer) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-base font-bold text-ink">
          That customer no longer exists.
        </p>
        <Link
          href="/customers"
          className="tap-target inline-flex items-center justify-center rounded-xl bg-accent px-4 py-3 text-base font-semibold text-accent-ink"
        >
          Back to customers
        </Link>
      </div>
    );
  }

  async function onStatusChange(next: (typeof CUSTOMER_STATUSES)[number]) {
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

  const phoneDigits = customer.phone.replace(/\D/g, "");

  return (
    <div className="h-full overflow-y-auto">
      <header className="pt-safe border-b border-line bg-surface px-4 pb-4">
        <Link
          href="/customers"
          className="tap-target -ml-2 inline-flex items-center gap-1 rounded-xl px-2 text-base font-bold text-muted"
        >
          ← Customers
        </Link>

        <h1 className="mt-2 text-2xl font-black tracking-tight text-ink">
          {customerName(customer)}
        </h1>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusPill status={customer.status} />
          <UserChip
            name={customer.createdByName}
            color={colorFor(customer.createdBy)}
            suffix="logged"
          />
        </div>

        {customer.updatedByName && customer.updatedAt ? (
          <p className="mt-2 text-sm font-semibold text-muted">
            Edited by {customer.updatedByName} at {formatTimestamp(customer.updatedAt)}
          </p>
        ) : null}
      </header>

      <div className="flex flex-col gap-6 px-4 py-5">
        <section className="grid grid-cols-3 gap-2">
          <a
            href={phoneDigits ? `tel:${phoneDigits}` : undefined}
            aria-disabled={!phoneDigits}
            className={`tap-target flex flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface-2 px-2 py-3 text-sm font-bold ${
              phoneDigits ? "text-ink" : "pointer-events-none text-muted opacity-50"
            }`}
          >
            Call
          </a>
          <a
            href={phoneDigits ? `sms:${phoneDigits}` : undefined}
            aria-disabled={!phoneDigits}
            className={`tap-target flex flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface-2 px-2 py-3 text-sm font-bold ${
              phoneDigits ? "text-ink" : "pointer-events-none text-muted opacity-50"
            }`}
          >
            Text
          </a>
          <Link
            href={`/map?focus=${customer.id}`}
            className="tap-target flex flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface-2 px-2 py-3 text-sm font-bold text-ink"
          >
            Map
          </Link>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">Contact</h2>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
          <dl className="divide-y divide-line rounded-xl border border-line bg-surface-2">
            <Row label="Phone" value={customer.phone ? formatPhone(customer.phone) : "—"} />
            <Row label="Email" value={customer.email || "—"} />
            <Row label="Address" value={customer.address || "—"} />
            <Row
              label="Services"
              value={
                customer.serviceTypes.length > 0
                  ? customer.serviceTypes.map((s) => SERVICE_LABEL[s]).join(", ")
                  : "—"
              }
            />
            <Row
              label="Last contacted"
              value={`${formatRelative(customer.lastContactedAt)}${
                customer.lastContactedByName ? ` by ${customer.lastContactedByName}` : ""
              }`}
            />
            <Row label="Added" value={formatDateOnly(customer.createdAt)} />
          </dl>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Revenue</h2>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Total revenue" value={formatMoney(revenue)} />
            <Stat
              label="Jobs completed"
              value={String(jobs.filter((job) => job.status === "complete").length)}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Status</h2>
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
          <h2 className="mb-2 text-lg font-bold text-ink">Service history</h2>
          {jobs.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
              No jobs yet. Scheduling arrives in Phase 2.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="rounded-xl border border-line bg-surface-2 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-base font-bold text-ink">
                      {SERVICE_LABEL[job.serviceType]}
                    </span>
                    <span className="text-base font-bold text-accent">
                      {formatMoney(job.price)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-muted">
                    {formatDateOnly(job.scheduledStart)} · {JOB_STATUS_LABEL[job.status]}
                  </p>
                  {job.assignedTo.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {job.assignedTo.map((uid) => (
                        <UserChip key={uid} name={nameFor(uid)} color={colorFor(uid)} />
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {quotes.length > 0 ? (
          <section>
            <h2 className="mb-2 text-lg font-bold text-ink">Quotes</h2>
            <ul className="flex flex-col gap-2">
              {quotes.map((quote) => (
                <li
                  key={quote.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 p-3"
                >
                  <span>
                    <span className="block text-base font-bold text-ink">
                      {SERVICE_LABEL[quote.serviceType]}
                    </span>
                    <span className="block text-sm font-semibold text-muted">
                      {formatDateOnly(quote.sentAt)} · {QUOTE_STATUS_LABEL[quote.status]} ·
                      sent by {quote.sentByName}
                    </span>
                  </span>
                  <span className="text-base font-bold text-accent">
                    {formatMoney(quote.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">
            Photos {photos.length > 0 ? `(${photos.length})` : ""}
          </h2>
          {photos.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
              No job photos yet. Camera capture arrives in Phase 4.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {photos.map(({ photo, label }) => (
                <li
                  key={`${photo.path}-${label}`}
                  className="overflow-hidden rounded-xl border border-line bg-surface-2"
                >
                  <div className="relative aspect-square">
                    <Image
                      src={photo.url}
                      alt={`${label} photo taken by ${photo.takenByName}`}
                      fill
                      sizes="(max-width: 640px) 50vw, 240px"
                      className="object-cover"
                    />
                    <span className="absolute top-1.5 left-1.5 rounded-full bg-base/85 px-2 py-0.5 text-xs font-black text-ink">
                      {label}
                    </span>
                  </div>
                  <p className="px-2 py-1.5 text-xs font-bold text-muted">
                    {photo.takenByName} · {formatDateOnly(photo.takenAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Notes</h2>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={3}
            placeholder="What happened at the door?"
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <Button
            full
            className="mt-2 mb-4"
            onClick={() => void onAddNote()}
            disabled={busy || !noteText.trim()}
          >
            Add note
          </Button>
          <NotesTimeline notes={customer.notes} />
        </section>
      </div>

      <EditCustomerSheet
        customer={customer}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <dt className="text-sm font-bold text-muted">{label}</dt>
      <dd className="text-right text-base font-semibold break-words text-ink">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-3">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-black text-ink">{value}</p>
    </div>
  );
}
