"use client";

import { addMinutes, format } from "date-fns";
import { useEffect, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useJobs } from "@/components/providers/JobsProvider";
import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { advancePipeline } from "@/lib/db/customers";
import {
  completeJob,
  createJob,
  deleteJob,
  markJobPaid,
  markJobUnpaid,
  updateJob,
} from "@/lib/db/jobs";
import { customerName, formatDateOnly, formatMoney } from "@/lib/format";
import { DEFAULT_JOB_MINUTES } from "@/lib/schedule";
import { jobConfirmationText, jobRescheduledText } from "@/lib/messages";
import { SERVICE_LABEL } from "@/lib/status";
import { trySendSms } from "@/lib/smsClient";
import { SERVICE_TYPES } from "@/lib/types";
import type { Job, ServiceType } from "@/lib/types";
import { JobPhotos } from "./JobPhotos";

interface JobSheetProps {
  open: boolean;
  /** Editing an existing job, or null when creating one. */
  job: Job | null;
  /** Pre-selected customer when creating from a customer record. */
  customerId?: string;
  /** Pre-filled start when creating from a calendar slot. */
  defaultStart?: Date;
  onClose: () => void;
}

function toLocalInput(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export function JobSheet({
  open,
  job: jobProp,
  customerId,
  defaultStart,
  onClose,
}: JobSheetProps) {
  const { customers, byId } = useCustomers();
  const { byId: jobsById } = useJobs();
  const { author, users } = useTeam();
  const notify = useNotify();

  // Callers pass a snapshot from whenever the sheet was opened. Re-reading it
  // from the live listener keeps uploaded photos and the other crew member's
  // edits visible while the sheet stays open.
  const job = jobProp ? (jobsById.get(jobProp.id) ?? jobProp) : null;

  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("pressure_washing");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [price, setPrice] = useState("");
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [jobNotes, setJobNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);


  useEffect(() => {
    if (!open) return;
    setError(null);
    setWarning(null);

    if (job) {
      setSelectedCustomer(job.customerId);
      setServiceType(job.serviceType);
      setStart(toLocalInput(job.scheduledStart.toDate()));
      setEnd(toLocalInput(job.scheduledEnd.toDate()));
      setPrice(String(job.price));
      setAssignedTo(job.assignedTo);
      setJobNotes(job.jobNotes);
      return;
    }

    const begin = defaultStart ?? addMinutes(new Date(), 60);
    setSelectedCustomer(customerId ?? "");
    setServiceType("pressure_washing");
    setStart(toLocalInput(begin));
    setEnd(toLocalInput(addMinutes(begin, DEFAULT_JOB_MINUTES)));
    setPrice("");
    setAssignedTo(author ? [author.uid] : []);
    setJobNotes("");
  }, [open, job, customerId, defaultStart, author]);

  // Keep the end time after the start when the start moves.
  useEffect(() => {
    if (!start) return;
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : null;
    if (!endDate || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      setEnd(toLocalInput(addMinutes(startDate, DEFAULT_JOB_MINUTES)));
    }
    // Intentionally not depending on `end` — this only corrects it, and
    // depending on it would fight the user while they type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const customer = selectedCustomer ? byId.get(selectedCustomer) : undefined;

  async function save() {
    if (!author) return;
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (!selectedCustomer) return setError("Pick a customer.");
    if (Number.isNaN(startDate.getTime())) return setError("Pick a start time.");
    if (Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return setError("The end time has to be after the start time.");
    }
    if (assignedTo.length === 0) return setError("Assign this job to at least one person.");

    const priceValue = Number.parseFloat(price || "0");
    if (Number.isNaN(priceValue) || priceValue < 0) return setError("Enter a valid price.");

    setSaving(true);
    setError(null);
    setWarning(null);

    // Tracked locally rather than read back from state: setWarning does not
    // update `warning` until the next render, so the close decision below has
    // to use the value we just computed.
    let smsProblem: string | null = null;

    try {
      const movedTime =
        job !== null && job.scheduledStart.toMillis() !== startDate.getTime();

      if (job) {
        await updateJob(
          job.id,
          {
            serviceType,
            scheduledStart: startDate,
            scheduledEnd: endDate,
            price: priceValue,
            assignedTo,
            jobNotes,
          },
          author,
        );
        await notify({
          type: movedTime ? "job_rescheduled" : "job_updated",
          body: `${customer ? customerName(customer) : "A job"} · ${SERVICE_LABEL[serviceType]} · ${format(startDate, "EEE MMM d, h:mm a")}`,
          customerId: selectedCustomer,
          jobId: job.id,
        });

        // A moved job is the customer's problem too, so it gets a text.
        if (movedTime) {
          smsProblem = await trySendSms(
            selectedCustomer,
            jobRescheduledText(SERVICE_LABEL[serviceType], startDate),
            "job_rescheduled",
          );
        }
      } else {
        const newId = await createJob(
          {
            customerId: selectedCustomer,
            serviceType,
            scheduledStart: startDate,
            scheduledEnd: endDate,
            price: priceValue,
            assignedTo,
            jobNotes,
          },
          author,
        );
        await notify({
          type: "job_created",
          body: `${customer ? customerName(customer) : "A job"} · ${SERVICE_LABEL[serviceType]} · ${format(startDate, "EEE MMM d, h:mm a")}`,
          customerId: selectedCustomer,
          jobId: newId,
        });

        // Booking the work is the moment the lead becomes a scheduled job.
        if (customer) {
          await advancePipeline(customer, "job_scheduled", author, {
            value: priceValue,
            reason: `Job scheduled for ${format(startDate, "EEE MMM d, h:mm a")}`,
          });
        }

        smsProblem = await trySendSms(
          selectedCustomer,
          jobConfirmationText(SERVICE_LABEL[serviceType], startDate),
          "job_confirmation",
        );
      }

      // The job itself is saved either way. A failed text keeps the sheet open
      // with a warning so nobody walks away believing the customer was told.
      if (smsProblem) {
        setWarning(`Job saved, but the text didn't send: ${smsProblem}`);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this job.");
    } finally {
      setSaving(false);
    }
  }

  async function markComplete() {
    if (!job || !author) return;
    setSaving(true);
    try {
      await completeJob(job.id, author);
      // Work done but not settled — the lead sits in "awaiting payment" until
      // someone records the money arriving.
      if (customer) {
        await advancePipeline(customer, "awaiting_payment", author, {
          reason: "Work completed, payment outstanding",
        });
      }
      await notify({
        type: "job_completed",
        body: `${customer ? customerName(customer) : "A job"} · ${SERVICE_LABEL[job.serviceType]}`,
        customerId: job.customerId,
        jobId: job.id,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete this job.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Recording payment closes the deal. This is the only thing that moves a lead
   * out of "awaiting payment", which is what makes that column a real list of
   * money owed rather than a stale pile.
   */
  async function togglePaid() {
    if (!job || !author) return;
    setSaving(true);
    try {
      if (job.paidAt) {
        await markJobUnpaid(job.id, author);
      } else {
        await markJobPaid(job.id, author);
        if (customer) {
          await advancePipeline(customer, "paid", author, {
            reason: `Payment received — ${formatMoney(job.price)}`,
          });
        }
        await notify({
          type: "payment_received",
          body: `${customer ? customerName(customer) : "A job"} · ${formatMoney(job.price)} · ${SERVICE_LABEL[job.serviceType]}`,
          customerId: job.customerId,
          jobId: job.id,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update payment.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelJob() {
    if (!job || !author) return;
    setSaving(true);
    try {
      await updateJob(job.id, { status: "cancelled" }, author);
      await notify({
        type: "job_cancelled",
        body: `${customer ? customerName(customer) : "A job"} · ${SERVICE_LABEL[job.serviceType]}`,
        customerId: job.customerId,
        jobId: job.id,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel this job.");
    } finally {
      setSaving(false);
    }
  }

  async function removeJob() {
    if (!job) return;
    setSaving(true);
    try {
      await deleteJob(job.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this job.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      title={job ? "Edit job" : "New job"}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button full onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : job ? "Save changes" : "Schedule job"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {job ? null : (
          <SelectField
            label="Customer"
            value={selectedCustomer}
            onChange={(e) => setSelectedCustomer(e.target.value)}
          >
            <option value="">Choose a customer…</option>
            {customers.map((item) => (
              <option key={item.id} value={item.id}>
                {customerName(item)}
              </option>
            ))}
          </SelectField>
        )}

        {job && customer ? (
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-base font-bold text-ink">
            {customerName(customer)}
          </p>
        ) : null}

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Service</p>
          <div className="flex flex-wrap gap-2">
            {SERVICE_TYPES.map((service) => (
              <Chip
                key={service}
                active={serviceType === service}
                onClick={() => setServiceType(service)}
              >
                {SERVICE_LABEL[service]}
              </Chip>
            ))}
          </div>
        </div>

        <TextField
          label="Starts"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <TextField
          label="Ends"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />

        <TextField
          label="Price"
          type="number"
          inputMode="decimal"
          min="0"
          step="5"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Assigned to</p>
          <div className="flex flex-wrap gap-2">
            {users.map((user) => (
              <Chip
                key={user.uid}
                active={assignedTo.includes(user.uid)}
                onClick={() =>
                  setAssignedTo((current) =>
                    current.includes(user.uid)
                      ? current.filter((uid) => uid !== user.uid)
                      : [...current, user.uid],
                  )
                }
              >
                {user.displayName}
              </Chip>
            ))}
          </div>
        </div>

        <TextAreaField
          label="Job notes"
          value={jobNotes}
          onChange={(e) => setJobNotes(e.target.value)}
          placeholder="Bring the surface cleaner, gate code 4417…"
        />

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        {warning ? (
          <p
            role="alert"
            className="rounded-xl border border-warn/70 bg-warn/20 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {warning}
          </p>
        ) : null}

        {/* Photos need a saved job to attach to, so they only appear on edit. */}
        {job ? (
          <div className="mt-2 border-t border-line pt-4">
            <JobPhotos job={job} />
          </div>
        ) : null}

        {job ? (
          <div className="mt-2 flex flex-col gap-2 border-t border-line pt-4">
            {job.status !== "complete" ? (
              <Button variant="secondary" full onClick={() => void markComplete()} disabled={saving}>
                Mark complete
              </Button>
            ) : (
              <Button
                variant={job.paidAt ? "secondary" : "primary"}
                full
                onClick={() => void togglePaid()}
                disabled={saving}
              >
                {job.paidAt
                  ? `Paid ${formatDateOnly(job.paidAt)} — undo`
                  : `Mark paid (${formatMoney(job.price)})`}
              </Button>
            )}
            {job.status !== "cancelled" ? (
              <Button variant="secondary" full onClick={() => void cancelJob()} disabled={saving}>
                Cancel job
              </Button>
            ) : null}
            <Button variant="danger" full onClick={() => void removeJob()} disabled={saving}>
              Delete job
            </Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
