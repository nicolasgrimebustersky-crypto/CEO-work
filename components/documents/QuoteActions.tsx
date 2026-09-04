"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BUSINESS } from "@/lib/business";
import { MAX_MESSAGE_CHARS, MAX_DAYS_AHEAD } from "@/lib/quoteResponse";

/**
 * The customer answering their own quote.
 *
 * Everything here happens on a page with no login on it, so it is built for
 * somebody standing in their driveway holding a phone: one question at a time,
 * nothing that needs a keyboard until it has to, and no step that cannot be
 * backed out of.
 *
 * The order is deliberate. "Approve this quote?" comes first and alone —
 * signature and date only appear once somebody has said yes, because asking a
 * customer to sign before they have agreed reads as a trick. Saying no leads
 * to a question box rather than a dead end, since a no is usually "not at this
 * price" and that is a conversation the crew want to have.
 */

type Stage = "asking" | "signing" | "declining" | "done";

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function QuoteActions({
  token,
  today,
  alreadyAnswered,
}: {
  token: string;
  /** Today in the business's timezone, decided on the server. */
  today: string;
  alreadyAnswered: "accepted" | "declined" | null;
}) {
  const [stage, setStage] = useState<Stage>(alreadyAnswered ? "done" : "asking");
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(alreadyAnswered);
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  /**
   * A canvas sized to its own box, in device pixels.
   *
   * Without the devicePixelRatio scaling the line is soft on every phone made
   * in the last decade — which on the one artefact somebody may later have to
   * rely on looks like a bad photocopy.
   */
  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    if (!box.width) return;
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }, []);

  useEffect(() => {
    if (stage !== "signing") return;
    fitCanvas();
    window.addEventListener("resize", fitCanvas);
    return () => window.removeEventListener("resize", fitCanvas);
  }, [stage, fitCanvas]);

  function pointIn(event: React.PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function startStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    // Capture, so a finger that slides off the box mid-signature keeps drawing
    // instead of leaving half a name behind.
    event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointIn(event);
    drawing.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function extendStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointIn(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawn) setHasDrawn(true);
  }

  function endStroke() {
    drawing.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function send(payload: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quote/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setOutcome(payload.decision === "accepted" ? "accepted" : "declined");
      setStage("done");
    } catch {
      // Almost always a phone that lost signal mid-tap. Say that, rather than
      // implying the quote was rejected.
      setError("Could not reach us — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function onApprove() {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) {
      setError("Please draw your signature in the box.");
      return;
    }
    void send({
      decision: "accepted",
      signedName: name,
      signature: canvas.toDataURL("image/png"),
      requestedDate: date,
      message,
    });
  }

  if (stage === "done") {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-10">
        <div
          role="status"
          className="rounded-2xl border border-line bg-surface p-5 text-center"
        >
          {outcome === "accepted" ? (
            <>
              <p className="text-lg font-bold text-ink">Thank you — you&apos;re booked in.</p>
              <p className="mt-1.5 text-base font-semibold text-muted">
                We have your approval and your preferred date. We&apos;ll confirm the
                time with you shortly.
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-ink">Thanks for letting us know.</p>
              <p className="mt-1.5 text-base font-semibold text-muted">
                {BUSINESS.phone
                  ? `If you'd rather talk it through, call us on ${BUSINESS.phone}.`
                  : "If you'd rather talk it through, just reply to our text."}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    // Sticky rather than inline: on a long estimate the decision has to stay
    // reachable without scrolling back, and a customer who has just read a
    // price is exactly when they want to answer.
    <div className="sticky bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
      <div className="pb-safe mx-auto max-w-3xl px-4 pt-4 pb-4">
        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        {stage === "asking" ? (
          <>
            <p className="mb-3 text-center text-lg font-bold text-ink">
              Approve this quote?
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStage("declining");
                }}
                className="tap-target rounded-full border border-line bg-surface-2 px-5 py-3 text-base font-bold text-ink"
              >
                No
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStage("signing");
                }}
                className="tap-target rounded-full bg-accent px-5 py-3 text-base font-bold text-accent-ink shadow-glow-accent"
              >
                Yes
              </button>
            </div>
          </>
        ) : null}

        {stage === "signing" ? (
          // A scrolling middle with the decision pinned under it. The form is
          // taller than a phone, and buttons that live at the bottom of a
          // scrollable panel are buttons a customer does not know are there.
          <div className="flex max-h-[75vh] flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            <p className="mb-3 text-lg font-bold text-ink">Sign to approve</p>

            <label className="mb-1.5 block text-sm font-bold text-muted" htmlFor="signed-name">
              Your name
            </label>
            <input
              id="signed-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              className="mb-4 w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base font-semibold text-ink"
              placeholder="Type your full name"
            />

            <p className="mb-1.5 text-sm font-bold text-muted">Your signature</p>
            <div className="mb-2 rounded-xl border border-line bg-white">
              <canvas
                ref={canvasRef}
                onPointerDown={startStroke}
                onPointerMove={extendStroke}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                // touch-none, or the browser scrolls the page instead of
                // drawing the moment a finger moves.
                className="h-40 w-full touch-none rounded-xl"
              />
            </div>
            <button
              type="button"
              onClick={clearSignature}
              className="mb-4 text-sm font-bold text-muted underline"
            >
              Clear signature
            </button>

            <label className="mb-1.5 block text-sm font-bold text-muted" htmlFor="preferred-date">
              What day suits you?
            </label>
            <input
              id="preferred-date"
              type="date"
              value={date}
              min={today}
              max={addDays(today, MAX_DAYS_AHEAD)}
              onChange={(event) => setDate(event.target.value)}
              className="mb-1.5 w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base font-semibold text-ink"
            />
            <p className="mb-4 text-sm font-semibold text-muted">
              Weekends are fine — we work them. We&apos;ll confirm the time with you.
            </p>

            <label className="mb-1.5 block text-sm font-bold text-muted" htmlFor="approve-note">
              Anything we should know? (optional)
            </label>
            <textarea
              id="approve-note"
              value={message}
              maxLength={MAX_MESSAGE_CHARS}
              onChange={(event) => setMessage(event.target.value)}
              rows={2}
              className="mb-4 w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base font-semibold text-ink"
              placeholder="Gate code, dogs, where to park…"
            />
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setStage("asking")}
                disabled={busy}
                className="tap-target rounded-full border border-line bg-surface-2 px-5 py-3 text-base font-bold text-ink"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onApprove}
                disabled={busy}
                className="tap-target rounded-full bg-accent px-5 py-3 text-base font-bold text-accent-ink shadow-glow-accent disabled:opacity-50"
              >
                {busy ? "Sending…" : "Approve"}
              </button>
            </div>
          </div>
        ) : null}

        {stage === "declining" ? (
          <div>
            <p className="mb-1.5 text-lg font-bold text-ink">No problem.</p>
            <p className="mb-3 text-base font-semibold text-muted">
              If something looks off — the price, what&apos;s included, the timing —
              tell us and we&apos;ll come back to you.
            </p>
            <label className="sr-only" htmlFor="decline-message">
              Your question
            </label>
            <textarea
              id="decline-message"
              value={message}
              maxLength={MAX_MESSAGE_CHARS}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              className="mb-4 w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base font-semibold text-ink"
              placeholder="Optional — what would you like to ask?"
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStage("asking")}
                disabled={busy}
                className="tap-target rounded-full border border-line bg-surface-2 px-5 py-3 text-base font-bold text-ink"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void send({ decision: "declined", message })}
                disabled={busy}
                className="tap-target rounded-full bg-surface-2 px-5 py-3 text-base font-bold text-ink"
              >
                {busy ? "Sending…" : message.trim() ? "Send question" : "Send"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
