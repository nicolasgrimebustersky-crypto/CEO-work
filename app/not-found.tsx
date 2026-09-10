import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Home, Phone } from "lucide-react";
import { BUSINESS } from "@/components/site/site-data";

// Rendered as /404.html by the static export; Netlify serves it for any
// path that doesn't exist. Kept self-contained (no section anchors, since
// "#services" doesn't resolve from a 404 URL) with the two things a lost
// visitor actually wants: the way home, and the phone number.
export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-background px-4 py-24 text-center">
      <Link href="/" className="mb-8 inline-flex items-center gap-3" aria-label="Back to home">
        <Image src="/logo.png" alt="Grime Bustersky logo" width={56} height={56} className="size-14 w-auto" priority />
      </Link>
      <p className="text-sm font-semibold tracking-wide text-primary uppercase">404</p>
      <h1 className="mt-3 font-heading text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
        That page got washed away.
      </h1>
      <p className="mt-4 max-w-md text-muted-foreground">
        The link you followed doesn&apos;t exist anymore — but the crew is one
        tap away. Head back home for a free instant quote, or just call.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
        >
          <Home className="size-4" /> Back to home
        </Link>
        <a
          href={BUSINESS.phoneHref}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-6 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
        >
          <Phone className="size-4" /> Call {BUSINESS.phoneDisplay}
        </a>
      </div>
    </main>
  );
}
