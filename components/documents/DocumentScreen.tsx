"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { SendTextSheet } from "@/components/customers/SendTextSheet";
import { useCustomers } from "@/components/providers/CustomersProvider";
import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { advancePipeline, setPipelineStage } from "@/lib/db/customers";
import {
  convertToInvoice,
  createDocument,
  deleteDocument,
  removePayment,
  setDocumentStatus,
  updateDocument,
} from "@/lib/db/documents";
import {
  lineTotal,
  STATUS_LABEL,
  STATUSES_FOR,
  type DocumentKind,
  type DocumentStatus,
} from "@/lib/documents";
import {
  customerName,
  formatDateOnly,
  formatMoneyExact,
  formatTimestamp,
} from "@/lib/format";
import { documentText } from "@/lib/messages";
import { routes } from "@/lib/routes";
import { SERVICE_LABEL } from "@/lib/status";
import { SERVICE_TYPES, type ServiceType } from "@/lib/types";
import { CustomerPickerSheet } from "./CustomerPickerSheet";
import { DocumentPrintView } from "./DocumentPrintView";
import { LineItemsEditor } from "./LineItemsEditor";
import { PaymentSheet } from "./PaymentSheet";
import { StatusPill } from "./StatusPill";
import {
  draftFrom,
  draftProblem,
  draftTotals,
  emptyDraft,
  lineItemsFrom,
  parseDueDate,
  toNumber,
  type Draft,
} from "./draft";

const INPUT =
  "tap-target w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

/**
 * One screen for building, reading and settling an estimate or an invoice.
 *
 * It has two modes rather than two screens. A draft opens straight into the
 * editor because that is what you came here to do; a document that has already
 * gone out opens read-only, so tapping into it to check a number can't
 * accidentally change one. The id comes from the query string for the same
 * reason the customer page does — see lib/routes.ts.
 */
export function DocumentScreen() {
  const params = useSearchParams();
  const documentId = params.get("id") ?? "";
  const newKind = params.get("new") as DocumentKind | null;
  const presetCustomer = params.get("customer") ?? "";

  const router = useRouter();
  const { byId, loading } = useDocuments();
  const { byId: customersById } = useCustomers();
  const { author } = useTeam();

  const document = documentId ? (byId.get(documentId) ?? null) : null;
  const isNew = newKind === "estimate" || newKind === "invoice";

  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [texting, setTexting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A new document starts as local state and is not written until Save, so
  // backing out of one leaves nothing behind.
  useEffect(() => {
    if (!isNew || !newKind) return;
    setDraft(emptyDraft(newKind, presetCustomer));
    setEditing(true);
  }, [isNew, newKind, presetCustomer]);

  const customer =
    customersById.get(draft?.customerId ?? document?.customerId ?? "") ?? null;

  if (!isNew && loading && !document) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!isNew && !document) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-base font-bold text-ink">
          That document no longer exists.
        </p>
        <Link
          href={routes.invoices}
          className="tap-target inline-flex items-center justify-center rounded-xl bg-accent px-4 py-3 text-base font-semibold text-accent-ink"
        >
          Back to invoices
        </Link>
      </div>
    );
  }

  const kind: DocumentKind = document?.kind ?? newKind ?? "estimate";
  const kindLabel = kind === "invoice" ? "Invoice" : "Estimate";

  function startEditing() {
    if (!document) return;
    setDraft(draftFrom(document));
    setEditing(true);
    setError(null);
  }

  async function onSave() {
    if (!draft || !author) return;
    const problem = draftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (document) {
        await updateDocument(
          document,
          {
            serviceType: draft.serviceType,
            lineItems: lineItemsFrom(draft),
            discount: toNumber(draft.discount),
            taxRatePct: toNumber(draft.taxRatePct),
            notes: draft.notes,
            dueAt: parseDueDate(draft.dueAt),
          },
          author,
        );
        setEditing(false);
      } else {
        const target = customersById.get(draft.customerId);
        if (!target) {
          setError("That customer is no longer in the app.");
          return;
        }
        const id = await createDocument(
          {
            kind: draft.kind,
            customer: target,
            serviceType: draft.serviceType,
            lineItems: lineItemsFrom(draft),
            discount: toNumber(draft.discount),
            taxRatePct: toNumber(draft.taxRatePct),
            notes: draft.notes,
            dueAt: parseDueDate(draft.dueAt),
          },
          author,
        );
        router.replace(routes.document(id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Status changes drive the pipeline as well as the document. Accepting an
   * estimate is the moment a lead becomes work, and that belongs on the
   * customer's timeline — not buried in a document nobody opens twice.
   */
  async function onStatus(status: DocumentStatus) {
    if (!document || !author) return;
    setBusy(true);
    setError(null);
    try {
      await setDocumentStatus(document, status, author);
      const target = customersById.get(document.customerId);
      if (target && document.kind === "estimate") {
        if (status === "sent") {
          await advancePipeline(target, "estimate_sent", author, {
            value: document.total,
            reason: `Estimate ${document.number} sent`,
          });
        } else if (status === "accepted") {
          await advancePipeline(target, "estimate_accepted", author, {
            value: document.total,
            reason: `Estimate ${document.number} accepted`,
          });
        } else if (status === "declined") {
          await setPipelineStage(target, "lost", author, {
            reason: `Estimate ${document.number} declined`,
          });
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not change the status.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onConvert() {
    if (!document || !author) return;
    setBusy(true);
    setError(null);
    try {
      const id = await convertToInvoice(document, author);
      router.push(routes.document(id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create the invoice.",
      );
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!document) return;
    setBusy(true);
    try {
      await deleteDocument(document.id);
      router.replace(routes.invoices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that.");
      setBusy(false);
    }
  }

  const totals = draft ? draftTotals(draft) : null;

  return (
    <div className="h-full overflow-y-auto">
      <header className="pt-safe border-b border-line bg-surface px-4 pb-4">
        {/* Capped to match the body below, so on a wide screen the title lines
            up with the document instead of drifting off to the left edge. */}
        <div className="mx-auto max-w-3xl">
          <Link
            href={routes.invoices}
            className="tap-target -ml-2 inline-flex items-center gap-1 rounded-xl px-2 text-base font-bold text-muted"
          >
            ← Invoices
          </Link>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-ink">
              {document
                ? `${kindLabel} ${document.number}`
                : `New ${kindLabel.toLowerCase()}`}
            </h1>
            {document ? <StatusPill status={document.status} /> : null}
          </div>

          {customer ? (
            <Link
              href={routes.customer(customer.id)}
              className="mt-1 inline-block text-base font-semibold text-accent"
            >
              {customerName(customer)}
            </Link>
          ) : null}

          {document?.updatedByName && document.updatedAt ? (
            <p className="mt-1 text-sm font-semibold text-muted">
              Edited by {document.updatedByName} at{" "}
              {formatTimestamp(document.updatedAt)}
            </p>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-5 pb-10">
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        {editing && draft ? (
          /* ------------------------------------------------------ editing */
          <>
            <section className="flex flex-col gap-3">
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-muted">
                  Customer
                </span>
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  // Moving a saved document to another customer is refused by
                  // the security rules, so don't offer it here either.
                  disabled={document !== null}
                  className={`${INPUT} text-left disabled:opacity-60`}
                >
                  {customer ? customerName(customer) : "Tap to pick a customer"}
                </button>
              </div>

              <div>
                <span className="mb-1.5 block text-sm font-semibold text-muted">
                  Service
                </span>
                <div className="flex flex-wrap gap-2">
                  {SERVICE_TYPES.map((service) => (
                    <Chip
                      key={service}
                      active={draft.serviceType === service}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          serviceType: service as ServiceType,
                        })
                      }
                    >
                      {SERVICE_LABEL[service]}
                    </Chip>
                  ))}
                </div>
              </div>

              <label>
                <span className="mb-1.5 block text-sm font-semibold text-muted">
                  {kind === "invoice" ? "Payment due" : "Good through"}{" "}
                  (optional)
                </span>
                <input
                  type="date"
                  value={draft.dueAt}
                  onChange={(e) =>
                    setDraft({ ...draft, dueAt: e.target.value })
                  }
                  className={INPUT}
                />
              </label>
            </section>

            <section>
              <h2 className="mb-2 text-lg font-bold text-ink">Lines</h2>
              <LineItemsEditor
                draft={draft}
                onChange={setDraft}
                disabled={busy}
              />
            </section>

            <section>
              <label>
                <span className="mb-1.5 block text-sm font-semibold text-muted">
                  Notes for the customer
                </span>
                <textarea
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                  rows={3}
                  placeholder="Anything they should know — access, timing, what's not included."
                  className={`${INPUT} resize-y`}
                />
              </label>
            </section>

            <section className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  if (document) {
                    setEditing(false);
                    setError(null);
                  } else {
                    router.back();
                  }
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button full onClick={() => void onSave()} disabled={busy}>
                {busy
                  ? "Saving…"
                  : `Save ${kindLabel.toLowerCase()}${
                      totals ? ` · ${formatMoneyExact(totals.total)}` : ""
                    }`}
              </Button>
            </section>
          </>
        ) : document ? (
          /* ------------------------------------------------------ reading */
          <>
            <section className="rounded-xl border border-line bg-surface-2">
              <Row
                label="Service"
                value={SERVICE_LABEL[document.serviceType]}
              />
              <Row label="Issued" value={formatDateOnly(document.issuedAt)} />
              {document.dueAt ? (
                <Row
                  label={document.kind === "invoice" ? "Due" : "Good through"}
                  value={formatDateOnly(document.dueAt)}
                />
              ) : null}
              {document.sentAt ? (
                <Row label="Sent" value={formatDateOnly(document.sentAt)} />
              ) : null}
              {document.convertedFromId ? (
                <div className="flex items-center justify-between gap-4 border-t border-line px-3 py-2.5">
                  <span className="text-sm font-bold text-muted">From</span>
                  <Link
                    href={routes.document(document.convertedFromId)}
                    className="text-base font-semibold text-accent"
                  >
                    the accepted estimate
                  </Link>
                </div>
              ) : null}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-ink">Lines</h2>
                <Button variant="secondary" onClick={startEditing}>
                  Edit
                </Button>
              </div>

              <ul className="divide-y divide-line rounded-xl border border-line bg-surface-2">
                {document.lineItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 px-3 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-base font-semibold break-words text-ink">
                        {item.description}
                      </span>
                      <span className="block text-sm font-semibold text-muted">
                        {item.quantity} × {formatMoneyExact(item.unitPrice)}
                        {item.taxable ? "" : " · no tax"}
                      </span>
                    </span>
                    <span className="shrink-0 text-base font-bold text-ink tabular-nums">
                      {formatMoneyExact(lineTotal(item))}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-3">
                <Money label="Subtotal" value={document.subtotal} />
                {document.discount > 0 ? (
                  <Money label="Discount" value={-document.discount} />
                ) : null}
                <Money
                  label={`Tax (${document.taxRatePct}%)`}
                  value={document.taxAmount}
                />
                <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2">
                  <span className="text-lg font-black text-ink">Total</span>
                  <span className="text-2xl font-black text-accent tabular-nums">
                    {formatMoneyExact(document.total)}
                  </span>
                </div>
                {document.amountPaid > 0 ? (
                  <>
                    <div className="mt-2">
                      <Money label="Paid" value={-document.amountPaid} />
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-base font-black text-ink">
                        Balance due
                      </span>
                      <span className="text-lg font-black text-ink tabular-nums">
                        {formatMoneyExact(document.balanceDue)}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </section>

            {document.notes.trim() ? (
              <section>
                <h2 className="mb-2 text-lg font-bold text-ink">Notes</h2>
                <p className="rounded-xl border border-line bg-surface-2 px-3 py-3 text-base font-semibold whitespace-pre-wrap text-ink">
                  {document.notes}
                </p>
              </section>
            ) : null}

            {document.kind === "invoice" ? (
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-ink">Payments</h2>
                  <Button variant="secondary" onClick={() => setPaying(true)}>
                    Record payment
                  </Button>
                </div>
                {document.payments.length === 0 ? (
                  <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
                    Nothing collected yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {document.payments.map((payment) => (
                      <li
                        key={payment.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block text-base font-bold text-ink">
                            {formatMoneyExact(payment.amount)}
                            <span className="font-semibold text-muted">
                              {payment.method ? ` · ${payment.method}` : ""}
                            </span>
                          </span>
                          <span className="block text-sm font-semibold text-muted">
                            {formatDateOnly(payment.receivedAt)} · logged by{" "}
                            {payment.recordedByName}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            author &&
                            void removePayment(document, payment.id, author)
                          }
                          aria-label={`Remove ${formatMoneyExact(payment.amount)} payment`}
                          className="tap-target shrink-0 rounded-lg px-3 text-2xl leading-none text-muted hover:text-danger"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            <section>
              <h2 className="mb-2 text-lg font-bold text-ink">Status</h2>
              <div className="flex flex-wrap gap-2">
                {STATUSES_FOR[document.kind].map((status) => (
                  <Chip
                    key={status}
                    active={document.status === status}
                    onClick={busy ? undefined : () => void onStatus(status)}
                  >
                    {STATUS_LABEL[status]}
                  </Chip>
                ))}
              </div>
              {document.kind === "invoice" ? (
                <p className="mt-2 text-sm font-semibold text-muted">
                  Paid and part paid follow the payments above — record one and
                  the status looks after itself.
                </p>
              ) : null}
            </section>

            <section className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => window.print()}>
                Print / PDF
              </Button>
              <Button
                variant="secondary"
                onClick={() => setTexting(true)}
                disabled={!customer?.phone}
              >
                Text it over
              </Button>
              {document.kind === "estimate" ? (
                <Button
                  className="col-span-2"
                  onClick={() => void onConvert()}
                  disabled={busy}
                >
                  Turn into an invoice
                </Button>
              ) : null}
            </section>

            <section className="border-t border-line pt-5">
              <Button
                variant="secondary"
                full
                onClick={() => setConfirmDelete(true)}
              >
                Delete this {kindLabel.toLowerCase()}
              </Button>
            </section>
          </>
        ) : null}
      </div>

      <CustomerPickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          if (draft) setDraft({ ...draft, customerId: id });
          setPicking(false);
        }}
      />

      {document ? (
        <>
          <PaymentSheet
            document={document}
            open={paying}
            onClose={() => setPaying(false)}
          />
          <DocumentPrintView document={document} customer={customer} />
        </>
      ) : null}

      {document && customer ? (
        <SendTextSheet
          customer={customer}
          open={texting}
          onClose={() => setTexting(false)}
          initialBody={documentText(
            document.kind,
            SERVICE_LABEL[document.serviceType],
            document.total,
            document.balanceDue,
          )}
        />
      ) : null}

      <Sheet
        open={confirmDelete}
        title={`Delete ${kindLabel.toLowerCase()} ${document?.number ?? ""}?`}
        onClose={() => setConfirmDelete(false)}
        footer={
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              full
              onClick={() => void onDelete()}
              disabled={busy}
            >
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        }
      >
        <p className="text-base font-semibold text-ink">
          This removes it from both phones and leaves a gap in the numbering. If
          it was sent in error, marking it void keeps the record straight.
        </p>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-3 py-2.5 last:border-b-0">
      <dt className="text-sm font-bold text-muted">{label}</dt>
      <dd className="text-right text-base font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Money({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-base font-semibold text-muted">{label}</span>
      <span className="text-base font-bold text-ink tabular-nums">
        {value < 0 ? `−${formatMoneyExact(-value)}` : formatMoneyExact(value)}
      </span>
    </div>
  );
}
