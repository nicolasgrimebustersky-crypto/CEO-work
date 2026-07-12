"use client";

import * as React from "react";
import {
  Camera,
  Sparkles,
  Ruler,
  Loader2,
  AlertCircle,
  Phone,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BUSINESS,
  QUOTE_SERVICES,
  quotePriceRange,
  WEB3FORMS_ACCESS_KEY,
  type QuoteService,
} from "./site-data";

type Estimate = {
  is_relevant_photo: boolean;
  surface_type: string;
  sqft_low: number;
  sqft_high: number;
  sqft_best: number;
  confidence: "low" | "medium" | "high";
  notes: string;
};

type Phase = "pick" | "analyzing" | "result" | "sent";

/** Downscale + re-encode the chosen photo so uploads are small and consistent. */
async function compressImage(file: File): Promise<{ base64: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("unreadable");
  const MAX = 1024;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
  return { base64: dataUrl.split(",")[1], mediaType: "image/jpeg" };
}

export function QuoteTool() {
  const [service, setService] = React.useState<QuoteService>(QUOTE_SERVICES[0]);
  const [phase, setPhase] = React.useState<Phase>("pick");
  const [error, setError] = React.useState<string | null>(null);
  const [sqft, setSqft] = React.useState<number | null>(null);
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [sourceLabel, setSourceLabel] = React.useState("");
  const [contact, setContact] = React.useState({ name: "", phone: "" });
  const [sending, setSending] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const price = sqft !== null ? quotePriceRange(service, sqft) : null;

  const reset = () => {
    setPhase("pick");
    setError(null);
    setSqft(null);
    setEstimate(null);
    setSourceLabel("");
  };

  const analyzePhoto = async (file: File) => {
    setError(null);
    setPhase("analyzing");
    try {
      const { base64, mediaType } = await compressImage(file).catch(() => {
        throw new Error(
          "We couldn't read that image. Try a JPG/PNG photo or a screenshot of it.",
        );
      });
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType, service: service.label }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        const reason =
          data?.error === "not_configured"
            ? "Photo estimates aren't available right now."
            : data?.error === "busy"
              ? "We're getting a lot of requests — try again in a minute."
              : "We couldn't analyze that photo.";
        throw new Error(`${reason} You can pick an approximate size below instead.`);
      }
      const est: Estimate = data.estimate;
      if (!est.is_relevant_photo) {
        throw new Error(
          `That photo doesn't look like a ${service.label.toLowerCase()} — ${est.notes} Try another photo, or pick a size below.`,
        );
      }
      setEstimate(est);
      setSqft(est.sqft_best);
      setSourceLabel("AI photo estimate");
      setPhase("result");
      (window as any).gtag?.("event", "ai_estimate", { service: service.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try a size below.");
      setPhase("pick");
    }
  };

  const useSize = (label: string, presetSqft: number) => {
    setEstimate(null);
    setSqft(presetSqft);
    setSourceLabel(label);
    setError(null);
    setPhase("result");
  };

  const sendLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!price) return;
    setSending(true);
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: `Instant quote request — ${contact.name || "Website"} ($${price.low}–$${price.high})`,
          from_name: "Grime Bustersky Instant Quote",
          name: contact.name,
          phone: contact.phone,
          service: service.label,
          estimated_area: `${sqft} sq ft (${sourceLabel}${estimate ? `, AI confidence: ${estimate.confidence}` : ""})`,
          estimated_price: `$${price.low}–$${price.high}`,
          notes: estimate?.notes ?? "(manual size selection)",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error();
      setPhase("sent");
    } catch {
      setError(`Couldn't send — please call us at ${BUSINESS.phoneDisplay}.`);
    } finally {
      setSending(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-input bg-background/60 px-4 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-ring/30";

  return (
    <section id="instant-quote" className="relative bg-background py-24 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-primary uppercase">
            <Sparkles className="size-4" /> Instant quote
          </span>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Snap a photo, get a ballpark price
          </h2>
          <p className="mt-4 text-muted-foreground">
            Our AI looks at your photo, estimates the square footage, and gives
            you an instant price range — or just pick an approximate size.
          </p>
        </div>

        <div className="mt-10 rounded-3xl border border-border/70 bg-card p-6 sm:p-8">
          {phase === "sent" ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="size-12 text-primary" />
              <h3 className="font-heading text-xl font-bold text-foreground">
                Estimate sent{contact.name ? `, ${contact.name}` : ""}!
              </h3>
              <p className="max-w-md text-sm text-muted-foreground">
                We&apos;ll reach out shortly to confirm your{" "}
                {service.label.toLowerCase()} quote. Need it sooner?
              </p>
              <a
                href={BUSINESS.phoneHref}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                <Phone className="size-4" /> Call {BUSINESS.phoneDisplay}
              </a>
              <button
                type="button"
                onClick={() => {
                  reset();
                  setContact({ name: "", phone: "" });
                }}
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
              >
                <RotateCcw className="size-3.5" /> Get another estimate
              </button>
            </div>
          ) : phase === "result" && price ? (
            <div>
              <div className="flex flex-col items-center gap-1 border-b border-border/60 pb-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {service.label} · ~{sqft?.toLocaleString()} sq ft ({sourceLabel})
                </p>
                <p className="font-heading text-5xl font-extrabold text-primary">
                  ${price.low}–${price.high}
                </p>
                <p className="text-xs text-muted-foreground">
                  Ballpark estimate — final price confirmed on-site, no obligation.
                </p>
                {estimate && (
                  <p className="mt-2 max-w-md text-sm text-foreground/80">
                    “{estimate.notes}” <span className="text-muted-foreground">(AI confidence: {estimate.confidence})</span>
                  </p>
                )}
              </div>

              <form onSubmit={sendLead} className="mt-6 grid gap-4">
                <p className="text-center text-sm font-medium text-foreground">
                  Like that number? Send it to us and we&apos;ll lock in your spot.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <input
                    required
                    value={contact.name}
                    onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
                    placeholder="Your name"
                    className={inputClass}
                  />
                  <input
                    required
                    type="tel"
                    value={contact.phone}
                    onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                    placeholder="(502) 000-0000"
                    className={inputClass}
                  />
                </div>
                {error && (
                  <p className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="size-4 shrink-0" /> {error}
                  </p>
                )}
                <div className="flex flex-col items-center gap-3 sm:flex-row">
                  <button
                    type="submit"
                    disabled={sending}
                    className="inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-70 sm:w-auto"
                  >
                    {sending ? "Sending…" : "Send my estimate"}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
                  >
                    <RotateCcw className="size-3.5" /> Start over
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div>
              {/* service picker */}
              <div className="flex flex-wrap justify-center gap-2">
                {QUOTE_SERVICES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setService(s)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                      s.id === service.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* photo upload */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) analyzePhoto(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={phase === "analyzing"}
                onClick={() => fileRef.current?.click()}
                className="mt-6 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 px-6 py-8 text-center transition-colors hover:border-primary/70 hover:bg-primary/10 disabled:cursor-wait"
              >
                {phase === "analyzing" ? (
                  <>
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <span className="font-heading font-bold text-foreground">
                      Analyzing your photo…
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Our AI is measuring the area (~10 seconds)
                    </span>
                  </>
                ) : (
                  <>
                    <Camera className="size-8 text-primary" />
                    <span className="font-heading font-bold text-foreground">
                      Upload a photo of your {service.label.toLowerCase()}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      AI estimates the size — include a car or door for scale if you can
                    </span>
                  </>
                )}
              </button>

              {error && (
                <p className="mt-4 flex items-start justify-center gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
                </p>
              )}

              {/* manual fallback */}
              <div className="mt-6">
                <p className="flex items-center justify-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <Ruler className="size-3.5" /> No photo? Pick a size
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {service.sizes.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => useSize(s.label, s.sqft)}
                      className="rounded-xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground/85 transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Estimates are ballpark figures based on the info provided and are always
          confirmed in person before any work begins.
        </p>
      </div>
    </section>
  );
}
