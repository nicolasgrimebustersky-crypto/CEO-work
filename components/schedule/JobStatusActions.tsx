"use client";

import { format } from "date-fns";
import { useState } from "react";

import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { OWNER_UID } from "@/lib/auth/roles";
import { advancePipeline } from "@/lib/db/customers";
import { signOffJob, stampJobStep } from "@/lib/db/jobs";
import { DEMO_NICK } from "@/lib/demo/fixtures";
import { isDemoMode } from "@/lib/demo/enabled";
import { customerName, formatMoney } from "@/lib/format";
import {
  STEP_SMS_REASON,
  firstNameOf,
  signOffBody,
  stepProblem,
  type JobStep,
} from "@/lib/jobFlow";
import { enRouteText, jobFinishedText, jobStartedText } from "@/lib/messages";
import { SERVICE_LABEL } from "@/lib/status";
import { trySendSms } from "@/lib/smsClient";
import type { Customer, Job } from "@/lib/types";
import { BriefcaseCheckIcon, CheckIcon, PlayIcon, VanIcon } from "./jobFlowIcons";

/**
 * The four taps a job takes on site.
 *
 * Three of them send the customer a text and stamp the job; the fourth signs it
 * off and tells the owner whether the money arrived. The point of putting them
 * on one row is that a crew standing in a driveway should not have to compose
 * anything — the texts customers actually want are the ones that arrive at a
 * predictable moment in a predictable form, and typing them by hand means they
 * go out inconsistently or not at all.
 *
 * The stamp is written only after the text has actually left. That ordering is
 * the whole honesty of the screen: "Sent 9:14" has to mean the customer was
 * told, not that somebody's thumb landed on a button while the van had no
 * signal. A failed send leaves the button ready to press again.
 */
export function JobStatusActions({
  job,
  customer,
  onSignedOff,
}: {
  job: Job;
  customer: Customer | undefined;
  onSignedOff: () => void;
}) {
  const { author } = useTeam();
  const notify = useNotify();

  const [busy, setBusy] = useState<JobStep | "complete" | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // In the demo there is no real Firebase account behind the owner's uid, so
  // the sign-off is addressed to the demo's own first crew member. Without this
  // the last step of the flow would appear to do nothing there.
  const ownerUid = isDemoMode ? DEMO_NICK : OWNER_UID;

  const blocked = stepProblem(job, customer?.phone);
  const signedBy = firstNameOf(author?.displayName);

  async function sendStep(step: JobStep, body: string) {
    if (!author || busy) return;
    if (blocked) {
      setError(blocked);
      return;
    }
    setBusy(step);
    setError(null);
    setWarning(null);
    setSent(null);
    try {
      const smsProblem = await trySendSms(job.customerId, body, STEP_SMS_REASON[step]);
      if (smsProblem) {
        // Deliberately not stamped. See the note above the component.
        setWarning(`The customer was not texted: ${smsProblem}`);
        return;
      }
      await stampJobStep(job.id, step, author);
      setSent(step);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this job.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Signs the job off.
   *
   * The answer to the payment question is recorded either way, and the owner is
   * told either way. Telling them only about the jobs that were paid would hide
   * exactly the ones that need chasing, which is the reason for asking at all.
   */
  async function signOff(collected: boolean) {
    if (!author || busy) return;
    setBusy("complete");
    setError(null);
    try {
      await signOffJob(job.id, collected, author);

      if (customer) {
        await advancePipeline(
          customer,
          collected ? "paid" : "awaiting_payment",
          author,
          collected
            ? { value: job.price, reason: `Payment received — ${formatMoney(job.price)}` }
            : { reason: "Work completed, payment outstanding" },
        );
      }

      const name = customer ? customerName(customer) : "A job";
      const service = SERVICE_LABEL[job.serviceType];

      await notify({
        type: "job_completed",
        body: `${name} · ${service}`,
        customerId: job.customerId,
        jobId: job.id,
      });

      // Addressed, not broadcast: this one is the owner's ledger line.
      await notify({
        type: "job_signed_off",
        body: signOffBody({
          service,
          customer: name,
          money: formatMoney(job.price),
          collected,
        }),
        customerId: job.customerId,
        jobId: job.id,
        toUids: [ownerUid],
      });

      setAsking(false);
      onSignedOff();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete this job.");
    } finally {
      setBusy(null);
    }
  }

  const tiles = [
    {
      step: "en_route" as const,
      icon: <VanIcon />,
      label: "En route",
      at: job.enRouteAt,
      run: () => sendStep("en_route", enRouteText(customer?.firstName)),
    },
    {
      step: "started" as const,
      icon: <PlayIcon />,
      label: "Starting job",
      at: job.startedAt,
      run: () => sendStep("started", jobStartedText(signedBy)),
    },
    {
      step: "finished" as const,
      icon: <BriefcaseCheckIcon />,
      label: "Job finished",
      at: job.finishedAt,
      run: () => sendStep("finished", jobFinishedText(signedBy)),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-muted">On the job</h3>
        <p className="text-sm font-semibold text-muted">
          {blocked ? blocked : "Each one texts the customer"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((tile) => (
          <button
            key={tile.step}
            type="button"
            onClick={() => void tile.run()}
            disabled={busy !== null || blocked !== null}
            aria-label={
              tile.at
                ? `${tile.label} — texted ${format(tile.at.toDate(), "h:mm a")}. Text again`
                : tile.label
            }
            className={`tap-target flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center disabled:opacity-50 ${
              tile.at
                ? "border-money/60 bg-money/15 text-ink"
                : "border-line bg-surface-2 text-ink"
            }`}
          >
            {tile.icon}
            <span className="text-sm leading-tight font-bold">{tile.label}</span>
            <span className="text-xs leading-tight font-semibold text-muted">
              {busy === tile.step
                ? "Texting…"
                : tile.at
                  ? `Sent ${format(tile.at.toDate(), "h:mm a")}`
                  : "Not sent"}
            </span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => setAsking(true)}
          disabled={busy !== null || job.status === "cancelled"}
          className={`tap-target flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center disabled:opacity-50 ${
            job.status === "complete"
              ? "border-money/60 bg-money/15 text-ink"
              : "border-accent/60 bg-accent/15 text-ink"
          }`}
        >
          <CheckIcon />
          <span className="text-sm leading-tight font-bold">Mark as complete</span>
          <span className="text-xs leading-tight font-semibold text-muted">
            {job.status === "complete"
              ? job.paymentCollected === true
                ? "Done · paid"
                : job.paymentCollected === false
                  ? "Done · unpaid"
                  : "Done"
              : "No text sent"}
          </span>
        </button>
      </div>

      {/* Asked inline rather than in a second sheet stacked on this one: the
          answer decides whether this job joins the list of money owed, and a
          dialog that can be dismissed by a stray tap on a phone is the wrong
          place to decide that. */}
      {asking ? (
        <div className="flex flex-col gap-3 rounded-xl border border-accent/60 bg-accent/10 p-3">
          <p className="text-base font-bold text-ink">
            Did you collect payment, or see proof of it?
          </p>
          <p className="text-sm font-semibold text-muted">
            {customer ? customerName(customer) : "This job"} ·{" "}
            {formatMoney(job.price)}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void signOff(true)}
              disabled={busy !== null}
              className="tap-target rounded-xl bg-money px-4 py-3 text-base font-bold text-black disabled:opacity-50"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => void signOff(false)}
              disabled={busy !== null}
              className="tap-target rounded-xl border border-line bg-surface-2 px-4 py-3 text-base font-bold text-ink disabled:opacity-50"
            >
              No
            </button>
          </div>
          <button
            type="button"
            onClick={() => setAsking(false)}
            disabled={busy !== null}
            className="text-sm font-bold text-muted underline underline-offset-4"
          >
            Not yet — go back
          </button>
        </div>
      ) : null}

      {sent && !warning ? (
        <p role="status" className="text-sm font-semibold text-money">
          Customer texted.
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

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
