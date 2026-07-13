"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  Sparkles,
  Ruler,
  AlertCircle,
  Phone,
  CheckCircle2,
  Building2,
  RotateCcw,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BorderBeam } from "@/components/ui/border-beam";
import { OrbitingCircles } from "@/components/ui/orbiting-circles";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import {
  BUSINESS,
  QUOTE_SERVICES,
  quotePriceTotal,
  WEB3FORMS_ACCESS_KEY,
  type QuoteService,
} from "./site-data";

type ServiceEstimate = {
  service: string;
  is_relevant_photo: boolean;
  surface_type: string;
  sqft_low: number;
  sqft_high: number;
  sqft_best: number;
  confidence: "low" | "medium" | "high";
  notes: string;
};

/** One priced line item — either AI-estimated (carries `estimate`) or a manual size pick. */
type PricedService = {
  service: QuoteService;
  sqftLow: number;
  sqftHigh: number;
  estimate?: ServiceEstimate;
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

const MAX_PHOTOS = 10;

/** Downscale + re-encode a photo so uploads are small and consistent. */
async function compressImage(file: File): Promise<{ base64: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("unreadable");
  const MAX = 900; // a bit smaller than before since up to 10 may be sent at once
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.74);
  return { base64: dataUrl.split(",")[1], mediaType: "image/jpeg" };
}

const ANALYZING_STEPS = [
  "Detecting surfaces…",
  "Measuring scale objects…",
  "Cross-referencing photos…",
  "Calculating square footage…",
  "Almost there…",
];

/** Full-panel "AI is working" state — replaces the static spinner with a
 *  scanning-photo + orbiting-core animation while the estimate call is in flight. */
function AnalyzingPanel({ previewUrls }: { previewUrls: string[] }) {
  const [statusIdx, setStatusIdx] = React.useState(0);

  React.useEffect(() => {
    setStatusIdx(0);
    const id = setInterval(() => {
      setStatusIdx((i) => (i + 1 < ANALYZING_STEPS.length ? i + 1 : i));
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative mt-6 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/10 via-background to-background px-6 py-10">
      <BorderBeam duration={5} size={90} colorFrom="hsl(var(--primary))" colorTo="hsl(var(--sand))" />

      {/* AI core */}
      <div className="relative mx-auto grid size-28 place-items-center">
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary/40 blur-xl"
          animate={{ scale: [0.85, 1.15, 0.85], opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <OrbitingCircles radius={44} duration={7} path={false} iconSize={10}>
          <span className="block size-2.5 rounded-full bg-primary shadow-[0_0_8px_2px_hsl(var(--primary)/0.8)]" />
        </OrbitingCircles>
        <OrbitingCircles radius={44} duration={11} reverse path={false} iconSize={6}>
          <span className="block size-1.5 rounded-full bg-sand shadow-[0_0_6px_1px_hsl(var(--sand)/0.8)]" />
        </OrbitingCircles>
        <motion.div
          aria-hidden
          className="absolute inset-3 rounded-full border-2 border-dashed border-primary/60"
          animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          className="relative grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40"
        >
          <Sparkles className="size-6" />
        </motion.div>
      </div>

      {/* status text */}
      <div className="relative mt-6 h-5 text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={statusIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
          >
            <AnimatedShinyText className="font-heading text-sm font-bold">
              {ANALYZING_STEPS[statusIdx]}
            </AnimatedShinyText>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* shimmer progress bar */}
      <div className="relative mx-auto mt-4 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-primary/15">
        <motion.div
          aria-hidden
          className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent"
          animate={{ x: ["-100%", "300%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <p className="relative mt-3 text-center text-xs text-muted-foreground">
        Our AI is measuring the area (~10–15 seconds)
      </p>

      {/* scanning photo thumbnails */}
      {previewUrls.length > 0 && (
        <div className="relative mt-6 flex flex-wrap justify-center gap-3">
          {previewUrls.map((url, i) => (
            <div
              key={url}
              className="relative size-16 overflow-hidden rounded-lg border border-primary/30 bg-background/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="size-full object-cover opacity-80" />
              <motion.div
                aria-hidden
                className="absolute inset-x-0 h-6 bg-gradient-to-b from-transparent via-primary/70 to-transparent"
                initial={{ y: "-40%" }}
                animate={{ y: "140%" }}
                transition={{
                  duration: 1.6,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.15,
                }}
              />
              <ScanLine className="absolute top-1 right-1 size-3 text-primary/80" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuoteTool() {
  const [selectedServices, setSelectedServices] = React.useState<QuoteService[]>([
    QUOTE_SERVICES[0],
  ]);
  const [phase, setPhase] = React.useState<Phase>("pick");
  const [error, setError] = React.useState<string | null>(null);
  const [priced, setPriced] = React.useState<PricedService[]>([]);
  const [sourceLabel, setSourceLabel] = React.useState("");
  const [contact, setContact] = React.useState({ name: "", phone: "", email: "", address: "" });
  const [sending, setSending] = React.useState(false);
  const [previewUrls, setPreviewUrls] = React.useState<string[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const priceTotal = priced.length
    ? quotePriceTotal(priced.map((p) => ({ service: p.service, sqftLow: p.sqftLow, sqftHigh: p.sqftHigh })))
    : null;

  const toggleService = (s: QuoteService) => {
    setSelectedServices((sel) => {
      const already = sel.some((x) => x.id === s.id);
      if (already) return sel.length > 1 ? sel.filter((x) => x.id !== s.id) : sel;
      return [...sel, s];
    });
  };

  const clearPreviews = () => {
    setPreviewUrls((urls) => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
  };

  React.useEffect(() => () => clearPreviews(), []);

  const reset = () => {
    setPhase("pick");
    setError(null);
    setPriced([]);
    setSourceLabel("");
    clearPreviews();
  };

  const analyzePhotos = async (files: File[]) => {
    setError(null);
    setPhase("analyzing");
    const trimmed = files.slice(0, MAX_PHOTOS);
    const truncated = files.length > MAX_PHOTOS;
    clearPreviews();
    setPreviewUrls(trimmed.map((f) => URL.createObjectURL(f)));
    try {
      const compressed = await Promise.all(
        trimmed.map((f) => compressImage(f).catch(() => null)),
      );
      const images = compressed
        .filter((c): c is { base64: string; mediaType: string } => c !== null)
        .map((c) => ({ image: c.base64, mediaType: c.mediaType }));
      if (images.length === 0) {
        throw new Error("We couldn't read those photos. Try JPG/PNG images or a screenshot.");
      }

      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, services: selectedServices.map((s) => s.label) }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        const reason =
          data?.error === "not_configured"
            ? "Photo estimates aren't available right now."
            : data?.error === "busy"
              ? "We're getting a lot of requests — try again in a minute."
              : "We couldn't analyze those photos.";
        throw new Error(`${reason} You can pick an approximate size below instead.`);
      }
      const estimates: ServiceEstimate[] = data.estimates ?? [];
      // The API is asked to echo back the exact requested label and keep the
      // same order/count — match by label first, but fall back to position
      // when the model paraphrases the label slightly (still reliable since
      // the array is guaranteed to line up with what we sent).
      const sameLength = estimates.length === selectedServices.length;

      const matched: PricedService[] = [];
      const missed: string[] = [];
      selectedServices.forEach((svc, i) => {
        const byLabel = estimates.find((e) => e.service?.toLowerCase().trim() === svc.label.toLowerCase());
        const est = byLabel ?? (sameLength ? estimates[i] : undefined);
        if (est?.is_relevant_photo) {
          // Defend against the model ever swapping low/high.
          const sqftLow = Math.max(0, Math.min(est.sqft_low, est.sqft_high));
          const sqftHigh = Math.max(est.sqft_low, est.sqft_high);
          matched.push({ service: svc, sqftLow, sqftHigh, estimate: est });
        } else {
          missed.push(svc.label);
        }
      });

      if (matched.length === 0) {
        const firstNote = estimates[0]?.notes;
        throw new Error(
          `Those photos don't look like ${selectedServices.map((s) => s.label.toLowerCase()).join(", ")}${
            firstNote ? ` — ${firstNote}` : ""
          } Try different photos, or pick a size below.`,
        );
      }

      setPriced(matched);
      setSourceLabel(
        images.length > 1 ? `AI estimate from ${images.length} photos` : "AI photo estimate",
      );
      setPhase("details");
      const notices = [];
      if (missed.length) {
        notices.push(
          `Couldn't confirm ${missed.join(", ")} in your photos — continuing with ${matched
            .map((m) => m.service.label)
            .join(", ")} only.`,
        );
      }
      if (truncated) {
        notices.push(`Only the first ${MAX_PHOTOS} photos were used (max ${MAX_PHOTOS} per estimate).`);
      }
      if (notices.length) setError(notices.join(" "));
      (window as any).gtag?.("event", "ai_estimate", {
        services: selectedServices.map((s) => s.id).join(","),
        photo_count: images.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try a size below.");
      setPhase("pick");
      clearPreviews();
    }
  };

  const useSize = (label: string, presetSqft: number) => {
    const svc = selectedServices[0];
    setPriced([{ service: svc, sqftLow: presetSqft, sqftHigh: presetSqft }]);
    setSourceLabel(label);
    setError(null);
    setPhase("details");
    clearPreviews();
  };

  const revealQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!priceTotal || priced.length === 0) return;
    setSending(true);
    setError(null);
    const commercial = looksCommercial(contact.name, contact.email, contact.address);
    const serviceLabels = priced.map((p) => p.service.label).join(", ");
    const areaSummary = priced
      .map((p) => {
        const range =
          p.sqftLow === p.sqftHigh
            ? `${p.sqftLow.toLocaleString()} sq ft`
            : `${p.sqftLow.toLocaleString()}–${p.sqftHigh.toLocaleString()} sq ft`;
        return `${p.service.label}: ${range}`;
      })
      .join("; ");
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: commercial
            ? `🏢 COMMERCIAL lead — ${contact.name} (${serviceLabels})`
            : `Instant quote — ${contact.name} ($${priceTotal.low}–$${priceTotal.high} ${serviceLabels})`,
          from_name: "Grime Bustersky Instant Quote",
          lead_type: commercial ? "COMMERCIAL — quoted nothing, told to contact you directly" : "Residential",
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          address: contact.address || "Not provided",
          service: serviceLabels,
          estimated_area: `${areaSummary} (${sourceLabel})`,
          estimated_price: commercial ? "(withheld — commercial)" : `$${priceTotal.low}–$${priceTotal.high}`,
          notes: priced.map((p) => p.estimate?.notes).filter(Boolean).join(" | ") || "(manual size selection)",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error();
      setPhase(commercial ? "commercial" : "quoted");
      (window as any).gtag?.("event", commercial ? "quote_commercial" : "quote_revealed", {
        services: priced.map((p) => p.service.id).join(","),
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

  const selectedLabels = selectedServices.map((s) => s.label.toLowerCase()).join(" + ");

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
            Need more than one service? Select all that apply.
          </p>
        </div>

        <div className="mt-10 rounded-3xl border border-border/70 bg-card p-6 sm:p-8">
          {phase === "analyzing" ? (
            <AnalyzingPanel previewUrls={previewUrls} />
          ) : phase === "commercial" ? (
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
          ) : phase === "quoted" && priceTotal ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="size-10 text-primary" />
              <div className="text-sm text-muted-foreground">
                {priced.map((p) => (
                  <p key={p.service.id}>
                    {p.service.label} · ~
                    {p.sqftLow === p.sqftHigh
                      ? p.sqftLow.toLocaleString()
                      : `${p.sqftLow.toLocaleString()}–${p.sqftHigh.toLocaleString()}`}{" "}
                    sq ft
                  </p>
                ))}
                <p className="mt-1">({sourceLabel})</p>
              </div>
              <p className="font-heading text-5xl font-extrabold text-primary">
                ${priceTotal.low}–${priceTotal.high}
              </p>
              <p className="text-xs text-muted-foreground">
                Ballpark estimate — final price confirmed on-site, no obligation.
              </p>
              {priced.some((p) => p.estimate) && (
                <div className="mt-1 max-w-md space-y-1 text-sm text-foreground/80">
                  {priced
                    .filter((p) => p.estimate)
                    .map((p) => (
                      <p key={p.service.id}>
                        “{p.estimate!.notes}”{" "}
                        <span className="text-muted-foreground">
                          (AI confidence: {p.estimate!.confidence})
                        </span>
                      </p>
                    ))}
                </div>
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
                  ✅ Your {priced.map((p) => p.service.label.toLowerCase()).join(" + ")} estimate is
                  ready
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sourceLabel} — tell us where to send it and your price appears instantly.
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
              {/* service picker — select one or more */}
              <p className="mb-2 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Select all services that apply
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {QUOTE_SERVICES.map((s) => {
                  const isSelected = selectedServices.some((x) => x.id === s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleService(s)}
                      aria-pressed={isSelected}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/70 bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                      )}
                    >
                      {isSelected && <CheckCircle2 className="size-3.5" />}
                      {s.label}
                    </button>
                  );
                })}
              </div>

              {/* photo upload */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) analyzePhotos(files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-6 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 px-6 py-8 text-center transition-colors hover:border-primary/70 hover:bg-primary/10"
              >
                <Camera className="size-8 text-primary" />
                <span className="font-heading font-bold text-foreground">
                  Upload photos of your {selectedLabels}
                </span>
                <span className="text-xs text-muted-foreground">
                  Up to {MAX_PHOTOS} photos — multiple angles give a more accurate
                  estimate. Include a car or door for scale if you can.
                </span>
              </button>

              {error && (
                <p className="mt-4 flex items-start justify-center gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
                </p>
              )}

              {/* manual fallback — only offered when exactly one service is selected */}
              {selectedServices.length === 1 && (
                <div className="mt-6">
                  <p className="flex items-center justify-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <Ruler className="size-3.5" /> No photo? Pick a size
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {selectedServices[0].sizes.map((s) => (
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
              )}
              {selectedServices.length > 1 && (
                <p className="mt-6 text-center text-xs text-muted-foreground">
                  Multiple services selected — upload photos above, or select just
                  one service to pick an approximate size instead.
                </p>
              )}
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
