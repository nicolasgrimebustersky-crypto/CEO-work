import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

import { AccountPortal } from "@/components/site/account-portal";

/**
 * The customer's account page.
 *
 * Deliberately outside the one-page marketing site: this is the only part of
 * grimebusterskyllc.com somebody arrives at on purpose rather than by scrolling,
 * usually from a text asking them to approve something. It gets its own URL so
 * it can be linked to directly and bookmarked.
 *
 * Not indexed. There is nothing here for a crawler — the page is empty until
 * somebody signs in — and a portal in search results invites people to try
 * signing in to accounts that are not theirs.
 */
export const metadata: Metadata = {
  title: "Your account",
  description: "See your estimates, invoices and scheduled work with Grime Bustersky.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <main className="flex flex-1 flex-col bg-background px-4 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-3" aria-label="Back to home">
          <Image src="/logo.png" alt="Grime Bustersky logo" width={48} height={48} className="size-12 w-auto" priority />
        </Link>
        <div className="mt-8">
          <AccountPortal />
        </div>
      </div>
    </main>
  );
}
