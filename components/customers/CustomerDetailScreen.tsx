"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { StatusPill as DocumentStatusPill } from "@/components/documents/StatusPill";
import { useCustomers } from "@/components/providers/CustomersProvider";
import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip, StatusPill, UserChip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import {
  addNote,
  advancePipeline,
  changeStatus,
  deleteCustomer,
  setPipelineStage,
} from "@/lib/db/customers";
import { completedRevenue, subscribeJobsForCustomer } from "@/lib/db/jobs";
import { setQuoteStatus, subscribeQuotesForCustomer } from "@/lib/db/quotes";
import { isOutstanding } from "@/lib/documents";
import {
  customerName,
  formatDateOnly,
  formatMoney,
  formatMoneyExact,
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
import { CUSTOMER_STATUSES, QUOTE_STATUSES } from "@/lib/types";
import type { Job, Photo, Quote } from "@/lib/types";
import { JobSheet } from "@/components/schedule/JobSheet";
import { EditCustomerSheet } from "./EditCustomerSheet";
import { NotesTimeline } from "./NotesTimeline";
import { QuoteSheet } from "./QuoteSheet";
import { SendTextSheet } from "./SendTextSheet";
import { routes } from "@/lib/routes";

export function CustomerDetailScreen() {
  // Read from the query string rather than a path segment so this page can be
  // statically exported for the iOS build. See lib/routes.ts.
  const searchParams = useSearchParams();
  const customerId = searchParams.get("id") ?? "";

  const { byId, loading } = useCustomers();
  const { forCustomer } = useDocuments();
  const { author, colorFor, nameFor } = useTeam();
  const documents = forCustomer(customerId);
  const router = useRouter();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [schedulingJob, setSchedulingJob] = useState(false);
  const [texting, setTexting] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Guarded: an empty id means the query param is missing, and an unfiltered
  // listener would stream the whole collection.
  useEffect(() => {
    if (!customerId) return;
    return subscribeJobsForCustomer(customerId, setJobs);
  }, [customerId]);

  useEffect(() => {
    if (!customerId) return;
    return subscribeQuotesForCustomer(customerId, setQuotes);
  }, [customerId]);

  const customer = byId.get(customerId) ?? null;

  /**
   * Revenue is computed from completed jobs rather than read from
   * `lifetimeValue`, so it can't drift — the stored field is a cache for
   * sorting the list view, this is the number of record.
   */
  const revenue = useMemo(() => completedRevenue(jobs), [jobs]);

  /** What is still owed across this person's open invoices. */
  const owed = useMemo(
    () =>
      Number(
        documents
          .filter(isOutstanding)
          .reduce((sum, document) => sum + document.balanceDue, 0)
          .toFixed(2),
      ),
    [documents],
  );

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

  /**
   * Quote outcomes move the pipeline: accepting is the moment a lead becomes
   * work, declining closes it. Recorded here rather than in setQuoteStatus so
   * the stage note lands on the customer, where the timeline lives.
   */
  async function onQuoteStatus(quoteId: string, status: (typeof QUOTE_STATUSES)[number]) {
    if (!customer || !author) return;
    setBusy(true);
    try {
      await setQuoteStatus(quoteId, status);
      const quote = quotes.find((q) => q.id === quoteId);
      if (status === "accepted") {
        await advancePipeline(customer, "estimate_accepted", author, {
          value: quote?.amount,
          reason: "Estimate accepted",
        });
      } else if (status === "declined") {
        await setPipelineStage(customer, "lost", author, {
          reason: "Estimate declined",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!customer) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCustomer(customer.id);
      // The realtime listener will drop the record; leave before it does, or
      // this screen flashes its "no longer exists" state on the way out.
      router.replace("/customers");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete this pin.");
      setDeleting(false);
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
        <section className="grid grid-cols-4 gap-2">
          <a
            href={phoneDigits ? `tel:${phoneDigits}` : undefined}
            aria-disabled={!phoneDigits}
            className={`tap-target flex items-center justify-center rounded-xl border border-line bg-surface-2 px-1 py-3 text-sm font-bold ${
              phoneDigits ? "text-ink" : "pointer-events-none text-muted opacity-50"
            }`}
          >
            Call
          </a>
          {/* Texts go through Twilio so they land in the timeline, rather than
              opening the phone's own messaging app where nothing is recorded. */}
          <button
            type="button"
            onClick={() => setTexting(true)}
            disabled={!phoneDigits}
            className="tap-target flex items-center justify-center rounded-xl border border-line bg-surface-2 px-1 py-3 text-sm font-bold text-ink disabled:opacity-50"
          >
            Text
          </button>
          <button
            type="button"
            onClick={() => setSchedulingJob(true)}
            className="tap-target flex items-center justify-center rounded-xl border border-line bg-surface-2 px-1 py-3 text-sm font-bold text-ink"
          >
            Job
          </button>
          <Link
            href={routes.mapFocus(customer.id)}
            className="tap-target flex items-center justify-center rounded-xl border border-line bg-surface-2 px-1 py-3 text-sm font-bold text-ink"
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
            {owed > 0 ? (
              <div className="col-span-2 rounded-xl border border-warn/70 bg-warn/20 px-3 py-3">
                <p className="text-sm font-bold text-ink">Still owes</p>
                <p className="mt-0.5 text-2xl font-black text-ink">
                  {formatMoneyExact(owed)}
                </p>
              </div>
            ) : null}
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
              No jobs yet. Tap &ldquo;Job&rdquo; above to schedule one.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {jobs.map((job) => (
                <li key={job.id}>
                  {/* Tappable: this is where you stand when you need to add the
                      after photos or mark the visit complete. */}
                  <button
                    type="button"
                    onClick={() => setEditingJob(job)}
                    className="w-full rounded-xl border border-line bg-surface-2 p-3 text-left active:bg-surface-3"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-base font-bold text-ink">
                        {SERVICE_LABEL[job.serviceType]}
                      </span>
                      <span className="text-base font-bold text-accent">
                        {formatMoney(job.price)}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm font-semibold text-muted">
                      {formatDateOnly(job.scheduledStart)} · {JOB_STATUS_LABEL[job.status]}
                      {job.beforePhotos.length + job.afterPhotos.length > 0
                        ? ` · ${job.beforePhotos.length + job.afterPhotos.length} photos`
                        : ""}
                    </span>
                    {job.assignedTo.length > 0 ? (
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {job.assignedTo.map((uid) => (
                          <UserChip key={uid} name={nameFor(uid)} color={colorFor(uid)} />
                        ))}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">Estimates &amp; invoices</h2>
            <Link
              href={routes.newDocument("estimate", customer.id)}
              className="tap-target inline-flex items-center justify-center rounded-xl border border-line bg-surface-2 px-4 py-3 text-base font-semibold text-ink"
            >
              New estimate
            </Link>
          </div>

          {documents.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
              Nothing priced up yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {documents.map((document) => (
                <li key={document.id}>
                  <Link
                    href={routes.document(document.id)}
                    className="block rounded-xl border border-line bg-surface-2 p-3 active:bg-surface-3"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-base font-bold text-ink">
                          {document.kind === "invoice" ? "Invoice" : "Estimate"}{" "}
                          {document.number}
                        </span>
                        <span className="block text-sm font-semibold text-muted">
                          {SERVICE_LABEL[document.serviceType]} ·{" "}
                          {formatDateOnly(document.issuedAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-base font-bold text-accent tabular-nums">
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
                      <DocumentStatusPill status={document.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">Quick quotes</h2>
            <Button variant="secondary" onClick={() => setQuoting(true)}>
              New quote
            </Button>
          </div>
          <p className="mb-2 text-sm font-semibold text-muted">
            A number and a status, with the automatic follow-up texts attached. Use an
            estimate above when the customer needs to see the lines.
          </p>

          {quotes.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
              No quotes yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {quotes.map((quote) => (
                <li key={quote.id} className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      <span className="block text-base font-bold text-ink">
                        {SERVICE_LABEL[quote.serviceType]}
                      </span>
                      <span className="block text-sm font-semibold text-muted">
                        {formatDateOnly(quote.sentAt)} · sent by {quote.sentByName}
                        {quote.followUpCount > 0
                          ? ` · ${quote.followUpCount} follow-up${quote.followUpCount === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-base font-bold text-accent">
                      {formatMoney(quote.amount)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {QUOTE_STATUSES.map((status) => (
                      <Chip
                        key={status}
                        active={quote.status === status}
                        onClick={
                          busy ? undefined : () => void onQuoteStatus(quote.id, status)
                        }
                      >
                        {QUOTE_STATUS_LABEL[status]}
                      </Chip>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">
            Photos {photos.length > 0 ? `(${photos.length})` : ""}
          </h2>
          {photos.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
              No job photos yet. Open a job above to take before and after shots.
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
                    <span className="absolute top-1.5 left-1.5 rounded-full bg-canvas/85 px-2 py-0.5 text-xs font-black text-ink">
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

        {/* Last thing on the page on purpose — destructive and rarely wanted. */}
        <section className="border-t border-line pt-5 pb-6">
          <Button variant="secondary" full onClick={() => setConfirmDelete(true)}>
            Delete this pin
          </Button>
        </section>
      </div>

      <EditCustomerSheet
        customer={customer}
        open={editing}
        onClose={() => setEditing(false)}
      />

      <JobSheet
        open={schedulingJob}
        job={null}
        customerId={customer.id}
        onClose={() => setSchedulingJob(false)}
      />

      <SendTextSheet
        customer={customer}
        open={texting}
        onClose={() => setTexting(false)}
      />

      <QuoteSheet customer={customer} open={quoting} onClose={() => setQuoting(false)} />

      {/* Editing an existing job, opened from the service history above. */}
      <JobSheet
        open={editingJob !== null}
        job={editingJob}
        onClose={() => setEditingJob(null)}
      />

      <Sheet
        open={confirmDelete}
        title="Delete this pin?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              full
              onClick={() => void onDelete()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-base font-semibold text-ink">
            {customerName(customer)} and every note on this record will be removed
            from both phones. This cannot be undone.
          </p>
          {jobs.length > 0 || quotes.length > 0 ? (
            <p className="rounded-xl border border-warn/70 bg-warn/20 px-3 py-2.5 text-base font-semibold text-ink">
              {jobs.length > 0 ? `${jobs.length} job${jobs.length === 1 ? "" : "s"}` : ""}
              {jobs.length > 0 && quotes.length > 0 ? " and " : ""}
              {quotes.length > 0
                ? `${quotes.length} quote${quotes.length === 1 ? "" : "s"}`
                : ""}{" "}
              will be left without a customer, and will show as
              &ldquo;Unknown customer&rdquo; on the calendar. Delete or reassign
              {jobs.length > 0 ? " the jobs" : " them"} first if that matters.
            </p>
          ) : null}
          {deleteError ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
            >
              {deleteError}
            </p>
          ) : null}
        </div>
      </Sheet>
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
