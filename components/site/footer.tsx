import Image from "next/image";
import { Phone, Clock, MapPin } from "lucide-react";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { BUSINESS, SERVICES } from "./site-data";

type IconProps = { className?: string };

function TikTokIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

function InstagramIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function FacebookIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
    </svg>
  );
}

const SOCIALS = [
  { name: "Instagram", href: "https://www.instagram.com/grimebustersky", Icon: InstagramIcon },
  { name: "Facebook", href: "https://www.facebook.com/profile.php?id=61576382277369", Icon: FacebookIcon },
  { name: "TikTok", href: "https://www.tiktok.com/@grimebustersky", Icon: TikTokIcon },
];

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
          <div className="mt-6 flex items-center gap-3">
            {SOCIALS.map(({ name, href, Icon }) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={name}
                className="grid size-10 place-items-center rounded-full border border-border/70 bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
              >
                <Icon className="size-5" />
              </a>
            ))}
          </div>
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
