import Image from "next/image";
import { Phone, Clock, MapPin } from "lucide-react";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { BUSINESS, SERVICES } from "./site-data";

export function Footer() {
  return (
    <footer className="relative border-t border-border/60 bg-background">
      {/* Final CTA */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative -mt-px overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-card via-background to-background px-6 py-14 text-center sm:px-12">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--primary)/0.22),transparent_60%)]"
          />
          <h2 className="mx-auto max-w-2xl font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Ready to experience the transformative power of pressure washing?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Get a free, no-pressure quote today and see why Louisville trusts
            {" "}
            {BUSINESS.shortName}.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a href="#book">
              <LiquidButton
                size="xl"
                className="rounded-full border border-primary/40 text-base font-semibold text-foreground"
              >
                Get a Free Quote
              </LiquidButton>
            </a>
            <a
              href={BUSINESS.phoneHref}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3 text-base font-semibold text-primary-foreground transition-all hover:brightness-110"
            >
              <Phone className="size-4" />
              {BUSINESS.phoneDisplay}
            </a>
          </div>
        </div>
      </div>

      {/* Info grid */}
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-4 lg:px-8">
        <div className="md:col-span-2">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Grime Bustersky logo"
              width={48}
              height={48}
              className="size-11 w-auto"
            />
            <span className="font-heading text-lg font-extrabold tracking-tight text-foreground">
              Grime <span className="text-primary">Bustersky</span>
            </span>
          </div>
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            {BUSINESS.tagline}. Residential, commercial, and industrial cleaning
            plus landscaping and mulching across Louisville, Kentucky.
          </p>
        </div>

        <div>
          <h3 className="font-heading text-sm font-bold text-foreground uppercase">
            Services
          </h3>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            {SERVICES.map((s) => (
              <li key={s.title}>
                <a href="#services" className="transition-colors hover:text-primary">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-heading text-sm font-bold text-foreground uppercase">
            Get in touch
          </h3>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li>
              <a
                href={BUSINESS.phoneHref}
                className="inline-flex items-center gap-2 transition-colors hover:text-primary"
              >
                <Phone className="size-4 text-primary" />
                {BUSINESS.phoneDisplay}
              </a>
            </li>
            <li className="inline-flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              {BUSINESS.hours}
            </li>
            <li className="inline-flex items-center gap-2">
              <MapPin className="size-4 text-primary" />
              {BUSINESS.area}
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border/60 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <p>
            © {new Date().getFullYear()} {BUSINESS.name} LLC. All rights reserved.
          </p>
          <p>Founded by {BUSINESS.founders} · Louisville, KY</p>
        </div>
      </div>
    </footer>
  );
}
