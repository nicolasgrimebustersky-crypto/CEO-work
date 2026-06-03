"use client";

import * as React from "react";
import { Phone, CheckCircle2, CalendarCheck } from "lucide-react";
import { DatePicker } from "@/components/ui/heroui-date-picker";
import { BUSINESS, SERVICES } from "./site-data";

type DateValue = { month: string; day: string; year: string; iso?: string };

export function Booking() {
  const [date, setDate] = React.useState<DateValue | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    phone: "",
    address: "",
    service: SERVICES[0].title,
    notes: "",
  });

  const update =
    (key: keyof typeof form) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const inputClass =
    "w-full rounded-xl border border-input bg-background/60 px-4 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-ring/30";

  return (
    <section id="book" className="relative bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-b from-card to-background">
          <div className="grid gap-0 lg:grid-cols-5">
            {/* Pitch side */}
            <div className="relative flex flex-col justify-center gap-6 border-b border-border/70 p-8 sm:p-10 lg:col-span-2 lg:border-b-0 lg:border-r">
              <div
                aria-hidden
                className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_10%,hsl(var(--primary)/0.18),transparent_55%)]"
              />
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary uppercase">
                <CalendarCheck className="size-3.5" />
                Book online
              </span>
              <h2 className="font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                Get your free quote
              </h2>
              <p className="text-muted-foreground">
                Pick a preferred date and tell us what needs cleaning. We&apos;ll
                confirm your spot and bring the shine. Prefer to talk? Call us
                directly.
              </p>
              <a
                href={BUSINESS.phoneHref}
                className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                <Phone className="size-4" />
                {BUSINESS.phoneDisplay}
              </a>
              <p className="text-xs text-muted-foreground">{BUSINESS.hours}</p>
            </div>

            {/* Form side */}
            <div className="p-8 sm:p-10 lg:col-span-3">
              {submitted ? (
                <div className="flex h-full min-h-72 flex-col items-center justify-center gap-4 text-center">
                  <CheckCircle2 className="size-14 text-primary" />
                  <h3 className="font-heading text-2xl font-bold text-foreground">
                    Request received{form.name ? `, ${form.name}` : ""}!
                  </h3>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Thanks for reaching out to {BUSINESS.shortName}. We&apos;ll be
                    in touch shortly to confirm
                    {date?.iso ? ` your ${date.month}/${date.day}/${date.year} request` : " your free quote"}.
                    Need it sooner?
                  </p>
                  <a
                    href={BUSINESS.phoneHref}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                  >
                    <Phone className="size-4" />
                    Call {BUSINESS.phoneDisplay}
                  </a>
                </div>
              ) : (
                <form onSubmit={onSubmit} className="grid gap-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Name</span>
                      <input
                        required
                        value={form.name}
                        onChange={update("name")}
                        placeholder="Jane Doe"
                        className={inputClass}
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Phone</span>
                      <input
                        required
                        type="tel"
                        value={form.phone}
                        onChange={update("phone")}
                        placeholder="(502) 000-0000"
                        className={inputClass}
                      />
                    </label>
                  </div>

                  <label className="grid gap-1.5 text-sm">
                    <span className="font-medium text-foreground">
                      Property address
                    </span>
                    <input
                      value={form.address}
                      onChange={update("address")}
                      placeholder="123 Main St, Louisville, KY"
                      className={inputClass}
                    />
                  </label>

                  <div className="grid items-start gap-5 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm">
                      <span className="font-medium text-foreground">Service</span>
                      <select
                        value={form.service}
                        onChange={update("service")}
                        className={inputClass}
                      >
                        {SERVICES.map((s) => (
                          <option key={s.title} value={s.title}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="text-sm [&_.date-picker]:w-full">
                      <DatePicker
                        label="Preferred date"
                        minWidth="w-full"
                        description="We'll confirm availability."
                        onChange={(v) => setDate(v)}
                      />
                    </div>
                  </div>

                  <label className="grid gap-1.5 text-sm">
                    <span className="font-medium text-foreground">
                      Anything else?
                    </span>
                    <textarea
                      value={form.notes}
                      onChange={update("notes")}
                      rows={3}
                      placeholder="Tell us about the job…"
                      className={inputClass}
                    />
                  </label>

                  <button
                    type="submit"
                    className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98]"
                  >
                    Request my free quote
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
