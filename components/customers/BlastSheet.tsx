"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { splitAudience } from "@/lib/blastAudience";
import { customerName, formatPhone } from "@/lib/format";
import { sendBlast, type BlastResult } from "@/lib/smsClient";
import { canSendTo } from "@/lib/smsConsent";
import type { Customer } from "@/lib/types";

const SEGMENT_CHARS = 160;

/**
 * Texts the group currently showing in the list — whatever the search box and
 * filters have narrowed it to. Reusing the list's own filtering is what makes
 * "everyone quoted in 40031" possible without a second query builder.
 */
export function BlastSheet({
  recipients,
  open,
  onClose,
}: {
  recipients: Customer[];
  open: boolean;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BlastResult | null>(null);
  /** Taken out by hand on this screen. Ids, so the set survives a re-filter. */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [listOpen, setListOpen] = useState(false);
  /** Whether the already-had-it list is expanded. Separate from the recipients
   *  list, so checking one does not collapse the other. */
  const [sentOpen, setSentOpen] = useState(false);
  /** Whether the cannot-be-texted list is expanded. Its own state for the same
   *  reason: three names and an ellipsis is not an answer you can check. */
  const [blockedOpen, setBlockedOpen] = useState(false);
  /**
   * Whether to send to people who already had this exact message.
   *
   * Off by default, which is the decision this screen is making for you: the
   * common reason to run a blast twice is that the first one half failed, and
   * the people it reached do not want it again. Sending the same promotion
   * twice is how a number gets reported.
   */
  const [includeSent, setIncludeSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBody("");
    setError(null);
    setResult(null);
    setRemoved(new Set());
    setListOpen(false);
    setSentOpen(false);
    setBlockedOpen(false);
    setIncludeSent(false);
  }, [open]);

  // The route skips the unreachable ones too, but showing the real number up
  // front stops "why did only 6 of 9 send?" after the fact. Who has already
  // had this message is only knowable here, from their timeline.
  const audience = useMemo(
    // canSendTo is the function /api/sms/blast runs before each message. Handing
    // it in rather than letting this screen judge consent itself is what keeps
    // the count honest: anything the server will refuse is refused here too.
    () => splitAudience(recipients, body, removed, canSendTo),
    [recipients, body, removed],
  );

  // Who the button will actually text.
  const sendable = useMemo(
    () => (includeSent ? [...audience.sendable, ...audience.alreadySent] : audience.sendable),
    [audience, includeSent],
  );

  const toggle = (id: string) =>
    setRemoved((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function send() {
    if (!body.trim() || sendable.length === 0) return;
    setSending(true);
    setError(null);
    try {
      setResult(await sendBlast(sendable.map((c) => c.id), body.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Blast failed.");
    } finally {
      setSending(false);
    }
  }

  const segments = Math.max(1, Math.ceil(body.length / SEGMENT_CHARS));

  return (
    <Sheet
      open={open}
      title="Text this group"
      onClose={onClose}
      footer={
        result ? (
          <Button full onClick={onClose}>
            Done
          </Button>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button
              full
              onClick={() => void send()}
              disabled={sending || !body.trim() || sendable.length === 0}
            >
              {sending ? "Sending…" : `Send to ${sendable.length}`}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <p className="text-lg font-extrabold text-ink">
            Sent {result.sent} of {result.attempted}
          </p>
          {result.failed.length > 0 ? (
            <div>
              <p className="mb-2 text-base font-bold text-warn">
                {result.failed.length} didn&apos;t go through
              </p>
              <ul className="flex flex-col gap-1.5">
                {result.failed.map((failure) => (
                  <li
                    key={failure.customerId}
                    className="rounded-xl border border-line bg-surface-2 px-3 py-2"
                  >
                    <span className="block text-base font-bold text-ink">
                      {failure.name}
                    </span>
                    <span className="block text-sm font-semibold text-muted">
                      {failure.error}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-line bg-surface-2">
            {/* The count is the control. Tapping it opens the list, because
                "109 recipients" is exactly the moment somebody wants to know
                who, and to take one or two of them out. */}
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              className="tap-target flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
            >
              <span>
                <span className="block text-base font-bold text-ink">
                  {sendable.length} {sendable.length === 1 ? "recipient" : "recipients"}
                </span>
                <span className="block text-sm font-semibold text-muted">
                  {sendable.length === 0
                    ? "Nobody left to text"
                    : `${sendable
                        .slice(0, 3)
                        .map((customer) => customerName(customer))
                        .join(", ")}${
                        sendable.length > 3 ? ` and ${sendable.length - 3} more` : ""
                      }`}
                </span>
              </span>
              <span aria-hidden="true" className="text-muted">
                {listOpen ? "Hide" : "Edit"}
              </span>
            </button>

            {listOpen ? (
              <ul className="max-h-72 overflow-y-auto border-t border-line">
                {audience.sendable.concat(includeSent ? audience.alreadySent : []).length === 0 &&
                audience.removed.length === 0 ? (
                  <li className="px-3 py-2.5 text-sm font-semibold text-muted">
                    Nobody in this group can be texted.
                  </li>
                ) : null}
                {[...sendable, ...audience.removed].map((customer) => {
                  const out = removed.has(customer.id);
                  return (
                    <li key={customer.id} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => toggle(customer.id)}
                        className="tap-target flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                      >
                        <span className={out ? "opacity-45" : ""}>
                          <span
                            className={`block text-base font-semibold text-ink ${
                              out ? "line-through" : ""
                            }`}
                          >
                            {customerName(customer)}
                          </span>
                          <span className="block text-sm font-semibold text-muted">
                            {formatPhone(customer.phone)}
                          </span>
                        </span>
                        <span className="text-sm font-bold text-accent">
                          {out ? "Add back" : "Remove"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {/* The answer to "who has not had this yet", and it has to be the
                whole answer. Showing three names of nine told you a number you
                could not check, and the only way to see the rest was to flip
                them into the send — which is the one thing somebody checking
                the list is trying not to do by accident. It only appears once
                there is a message to compare against, because before that
                every customer trivially has not had it. */}
            {audience.alreadySent.length > 0 ? (
              <div className="border-t border-line">
                <button
                  type="button"
                  onClick={() => setSentOpen((v) => !v)}
                  aria-expanded={sentOpen}
                  className="tap-target flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span>
                    <span className="block text-sm font-semibold text-ink">
                      {audience.alreadySent.length} already had this exact message
                      {includeSent ? " — and will get it again" : " and are being skipped"}.
                    </span>
                    <span className="block text-sm font-semibold text-muted">
                      {audience.alreadySent
                        .slice(0, 3)
                        .map((customer) => customerName(customer))
                        .join(", ")}
                      {audience.alreadySent.length > 3
                        ? ` and ${audience.alreadySent.length - 3} more`
                        : ""}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-muted">
                    {sentOpen ? "Hide" : "See all"}
                  </span>
                </button>

                {sentOpen ? (
                  <ul className="max-h-56 overflow-y-auto border-t border-line">
                    {audience.alreadySent.map((customer) => (
                      <li
                        key={customer.id}
                        className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0"
                      >
                        <span>
                          <span className="block text-base font-semibold text-ink">
                            {customerName(customer)}
                          </span>
                          <span className="block text-sm font-semibold text-muted">
                            {formatPhone(customer.phone)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="px-3 pb-2.5">
                  <button
                    type="button"
                    onClick={() => setIncludeSent((v) => !v)}
                    className="tap-target text-sm font-bold text-accent underline"
                  >
                    {includeSent ? "Skip them" : "Send to them anyway"}
                  </button>
                </div>
              </div>
            ) : null}

            {removed.size > 0 ? (
              <p className="border-t border-line px-3 py-2 text-sm font-semibold text-muted">
                {removed.size} removed by hand.
              </p>
            ) : null}

            {/* Who cannot be texted at all, and why — expandable for the same
                reason the skipped list is. These are the people most worth
                checking by name: one of them replied STOP, and seeing that on
                this screen is how the crew learns to call instead. No toggle
                offers to include them, because nothing on this screen may
                overrule a customer's own instruction. */}
            {audience.blocked.length > 0 ? (
              <div className="border-t border-line">
                <button
                  type="button"
                  onClick={() => setBlockedOpen((v) => !v)}
                  aria-expanded={blockedOpen}
                  className="tap-target flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span>
                    <span className="block text-sm font-semibold text-warn">
                      Skipping {audience.blocked.length} who cannot be texted.
                    </span>
                    <span className="block text-sm font-semibold text-muted">
                      {audience.blocked
                        .slice(0, 3)
                        .map((item) => `${customerName(item.customer)} (${item.reason})`)
                        .join(", ")}
                      {audience.blocked.length > 3
                        ? ` and ${audience.blocked.length - 3} more`
                        : ""}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-muted">
                    {blockedOpen ? "Hide" : "See all"}
                  </span>
                </button>

                {blockedOpen ? (
                  <ul className="max-h-56 overflow-y-auto border-t border-line">
                    {audience.blocked.map((item) => (
                      <li
                        key={item.customer.id}
                        className="border-b border-line px-3 py-2 last:border-b-0"
                      >
                        <span className="block text-base font-semibold text-ink">
                          {customerName(item.customer)}
                        </span>
                        <span className="block text-sm font-semibold text-muted">
                          {formatPhone(item.customer.phone)}
                        </span>
                        <span className="block text-sm font-semibold text-warn">
                          {item.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={1600}
            placeholder="Snow's coming Thursday — we have driveway slots open…"
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />

          <p className="text-sm font-semibold text-muted">
            {body.length} characters · {segments}{" "}
            {segments === 1 ? "segment" : "segments"} each · about{" "}
            {Math.ceil((sendable.length * 1.1) / 60)} min to send
          </p>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
            >
              {error}
            </p>
          ) : null}

          <p className="text-sm font-semibold text-muted">
            Every message is logged to that customer&apos;s timeline under your name.
          </p>
        </div>
      )}
    </Sheet>
  );
}
