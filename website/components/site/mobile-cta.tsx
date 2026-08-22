import { Phone, CalendarCheck } from "lucide-react";
import { BUSINESS } from "./site-data";

// Always-visible Call / Get a Quote bar, pinned to the bottom on phones & tablets.
export function MobileCta() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/90 backdrop-blur-lg lg:hidden">
      <div
        className="mx-auto flex max-w-lg items-center gap-2 px-3 pt-2.5"
        style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}
      >
        <a
          href={BUSINESS.phoneHref}
          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
        >
          <Phone className="size-4" />
          Call
        </a>
        <a
          href="#book"
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
        >
          <CalendarCheck className="size-4" />
          Get a Quote
        </a>
      </div>
    </div>
  );
}
