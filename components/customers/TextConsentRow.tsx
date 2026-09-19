"use client";

import * as React from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { updateCustomer } from "@/lib/db/customers";
import { consentLabel, declineConsent, grantConsent, needsConsentAsked } from "@/lib/smsConsent";
import type { Customer } from "@/lib/types";

/**
 * Whether this customer has agreed to be texted, on the screen the crew is
 * already looking at when they decide to text.
 *
 * It sits with the contact details rather than behind a settings screen for
 * one reason: the A2P campaign filed with Twilio states that consent, the date
 * and the crew member who asked are recorded on the customer's record. A field
 * nobody can see or set does not make that true. This is the place it becomes
 * true, or visibly does not.
 *
 * Neither button is pre-selected and there is no default. "Nobody has asked"
 * is a real state and the honest one for every record entered before this
 * existed, so it is shown as itself rather than being quietly resolved to a
 * yes or a no.
 */
export function TextConsentRow({ customer }: { customer: Customer }) {
  const { author } = useTeam();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const record = async (granted: boolean) => {
    if (!author || saving) return;
    setSaving(true);
    setError("");
    try {
      await updateCustomer(
        customer.id,
        {
          // Verbal is the only method recordable from here. A crew member
          // tapping this has just spoken to somebody; the website box writes
          // its own record, and "written" is for a signed form.
          smsConsent: granted
            ? grantConsent("verbal", { uid: author.uid, name: author.displayName })
            : declineConsent("verbal", { uid: author.uid, name: author.displayName }),
        },
        author,
      );
    } catch {
      // Deliberately not optimistic. Showing "agreed" for a write that failed
      // would be the one kind of wrong that leads to texting somebody who did
      // not agree — the whole thing this row exists to prevent.
      setError("Could not save that. Check your signal and try again.");
    } finally {
      setSaving(false);
    }
  };

  const optedOut = Boolean(customer.smsOptOut);
  const ask = needsConsentAsked(customer);

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-muted">Text consent</span>
        <span
          className={`text-right text-sm font-semibold ${
            optedOut ? "text-danger" : ask ? "text-muted" : "text-ink"
          }`}
        >
          {consentLabel(customer)}
        </span>
      </div>

      {/* An opt-out is the customer's own instruction, arriving by text. It is
          not something to be cleared from the office, so no button offers to.
          The way back is the customer texting START, and the label says so. */}
      {optedOut ? null : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => record(true)}
            disabled={saving || !author}
            className="tap-target flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-bold text-ink disabled:opacity-50"
          >
            {ask ? "They said yes" : "Change to yes"}
          </button>
          <button
            type="button"
            onClick={() => record(false)}
            disabled={saving || !author}
            className="tap-target flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-bold text-ink disabled:opacity-50"
          >
            {ask ? "They said no" : "Change to no"}
          </button>
        </div>
      )}

      {ask && !optedOut ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Ask before texting: &ldquo;Is it alright if we text you about this job? We&rsquo;d
          send your estimate, your appointment confirmation and your invoice — nothing else,
          no advertising. Reply STOP any time and we&rsquo;ll stop.&rdquo;
        </p>
      ) : null}

      {error ? <p className="mt-2 text-xs font-semibold text-danger">{error}</p> : null}
    </div>
  );
}
