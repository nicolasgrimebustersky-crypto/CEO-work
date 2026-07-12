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
  Building2,
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

type Phase = "pick" | "analyzing" | "details" | "quoted" | "commercial";

/* ── Commercial detection ─────────────────────────────────────────────────
   Residential jobs get the instant price; anything that looks like a
   business (email domain, or business words in the name/address) is asked
   to contact Nic directly instead. */
const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "live.com", "msn.com",
  "protonmail.com", "proton.me", "pm.me", "comcast.net", "att.net",
  "bellsouth.net", "twc.com", "insightbb.com", "windstream.net",
]);

const COMMERCIAL_RE =
  /\b(llc|inc|corp|corporation|company|properties|property management|management|hoa|church|ministries|school|academy|university|daycare|apartments?|apts?\.?|complex|plaza|shopping center|office|offices|suite|ste\.?|unit \d|restaurant|cafe|diner|grill|pizzeria|hotel|motel|clinic|medical|dental|law|realty|warehouse|storage|enterprises?|holdings|salon|barber|gym|fitness|dealership|bank|credit union|store|facility|facilities)\b/i;

function looksCommercial(name: string, email: string, address: string) {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  const businessEmail = !!domain && domain.includes(".") && !FREE_MAIL.has(domain);
  return businessEmail || COMMERCIAL_RE.test(name) || COMMERCIAL_RE.test(address);
}

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
  const [sqftRange, setSqftRange] = React.useState<[number, number] | null>(null);
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [sourceLabel, setSourceLabel] = React.useState("");
  const [contact, setContact] = React.useState({ name: "", phone: "", email: "", address: "" });
  const [sending, setSending] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const price = sqftRange ? quotePriceRange(service, sqftRange[0], sqftRange[1]) : null;

  const reset = () => {
    setPhase("pick");
    setError(null);
    setSqftRange(null);
    setEstimate(null);
    setSourceLabel("");
  };

  const analyzePhoto = async (file: File) => {
    setError(null);
    setPhase("analyzing");
    try {
      const { base64, mediaType } = await compressImage(file).catch(() => {
        throw new Error("We couldn't read that image. Try a JPG/PNG photo or a screenshot of it.");
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
      setSqftRange([est.sqft_low, est.sqft_high]);
      setSourceLabel("AI photo estimate");
      setPhase("details");
      (window as any).gtag?.("event", "ai_estimate", { service: service.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try a size below.");
      setPhase("pick");
    }
  };

  const useSize = (label: string, presetSqft: number) => {
    setEstimate(null);
    setSqftRange([presetSqft, presetSqft]);
    setSourceLabel(label);
    setError(null);
    setPhase("details");
  };

  const revealQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!price || !sqftRange) return;
    setSending(true);
    setError(null);
    const commercial = looksCommercial(contact.name, contact.email, contact.address);
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: commercial
            ? `🏢 COMMERCIAL lead — ${contact.name} (${service.label})`
            : `Instant quote — ${contact.name} ($${price.low}–$${price.high} ${service.label})`,
          from_name: "Grime Bustersky Instant Quote",
          lead_type: commercial ? "COMMERCIAL — quoted nothing, told to contact you directly" : "Residential",
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          address: contact.address || "Not provided",
          service: service.label,
          estimated_area: `${sqftRange[0] === sqftRange[1] ? sqftRange[0] : `${sqftRange[0]}–${sqftRange[1]}`} sq ft (${sourceLabel}${estimate ? `, AI confidence: ${estimate.confidence}` : ""})`,
          estimated_price: commercial ? "(withheld — commercial)" : `$${price.low}–$${price.high}`,
          notes: estimate?.notes ?? "(manual size selection)",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error();
      setPhase(commercial ? "commercial" : "quoted");
      (window as any).gtag?.("event", commercial ? "quote_commercial" : "quote_revealed", {
        service: service.id,
      });
    } catch {
      setError(`Couldn't send — please call us at ${BUSINESS.phoneDisplay}.`);
    } finally {
      setSending(false);
    }
  };

  const startOver = () => {
    reset();
    setContact({ name: "", phone: "", email: "", address: "" });
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
          {phase === "commercial" ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Building2 className="size-12 text-primary" />
              <h3 className="font-heading text-xl font-bold text-foreground">
                Commercial property? Let&apos;s talk directly.
              </h3>
              <p className="max-w-md text-sm text-muted-foreground">
                Commercial and multi-unit jobs are priced personally so we can
                give you our best rate. Contact Nicolas directly and we&apos;ll
                get you a custom quote fast — we&apos;ve got your details and
                will reach out too.
              </p>
              <a
                href={BUSINESS.phoneHref}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
              >
                <Phone className="size-4" /> Call or text {BUSINESS.phoneDisplay}
              </a>
              <button
                type="button"
                onClick={startOver}
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
              >
                <RotateCcw className="size-3.5" /> Start over
              </button>
            </div>
          ) : phase === "quoted" && price ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="size-10 text-primary" />
              <p className="text-sm text-muted-foreground">
                {service.label} · ~
                {sqftRange![0] === sqftRange![1]
                  ? sqftRange![0].toLocaleString()
                  : `${sqftRange![0].toLocaleString()}–${sqftRange![1].toLocaleString()}`}{" "}
                sq ft ({sourceLabel})
              </p>
              <p className="font-heading text-5xl font-extrabold text-primary">
                {price.low === price.high ? `$${price.low}` : `$${price.low}–$${price.high}`}
              </p>
              <p className="text-xs text-muted-foreground">
                Ballpark estimate — final price confirmed on-site, no obligation.
              </p>
              {estimate && (
                <p className="mt-1 max-w-md text-sm text-foreground/80">
                  “{estimate.notes}”{" "}
                  <span className="text-muted-foreground">(AI confidence: {estimate.confidence})</span>
                </p>
              )}
              <p className="mt-3 max-w-md text-sm text-foreground">
                We&apos;ve got your request{contact.name ? `, ${contact.name.split(" ")[0]}` : ""} —
                we&apos;ll reach out shortly to lock in your spot. Want it faster?
              </p>
              <a
                href={BUSINESS.phoneHref}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                <Phone className="size-4" /> Call {BUSINESS.phoneDisplay}
              </a>
              <button
                type="button"
                onClick={startOver}
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
              >
                <RotateCcw className="size-3.5" /> Get another estimate
              </button>
            </div>
          ) : phase === "details" ? (
            <form onSubmit={revealQuote} className="grid gap-4">
              <div className="text-center">
                <p className="font-heading text-lg font-bold text-foreground">
                  ✅ Your {service.label.toLowerCase()} estimate is ready
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sourceLabel}
                  {estimate ? ` · AI confidence: ${estimate.confidence}` : ""} — tell us
                  where to send it and your price appears instantly.
                </p>
              </div>
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
                  placeholder="Phone — (502) 000-0000"
                  className={inputClass}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  required
                  type="email"
                  value={contact.email}
                  onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                  placeholder="Email"
                  className={inputClass}
                />
                <input
                  value={contact.address}
                  onChange={(e) => setContact((c) => ({ ...c, address: e.target.value }))}
                  placeholder="Property address (optional)"
                  className={inputClass}
                />
              </div>
              {error && (
                <p className="flex items-center justify-center gap-2 text-sm text-destructive">
                  <AlertCircle className="size-4 shrink-0" /> {error}
                </p>
              )}
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-8 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-70 sm:w-auto"
                >
                  {sending ? "One sec…" : "Show my price"}
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
          confirmed in person before any work begins. Commercial &amp; multi-unit
          properties are quoted directly.
        </p>
      </div>
    </section>
  );
}
