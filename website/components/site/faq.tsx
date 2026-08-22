"use client";

import * as React from "react";
import { ChevronDown, Phone, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { BUSINESS, FAQS } from "./site-data";

export function Faq() {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <section id="faq" className="relative bg-background py-24 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-primary uppercase">
            <HelpCircle className="size-4" /> FAQ
          </span>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Frequently asked questions
          </h2>
          <p className="mt-4 text-muted-foreground">
            Quick answers about our services, pricing, and how to book.
          </p>
        </div>

        <div className="mt-12 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-accent/40 sm:px-6"
                >
                  <span className="font-heading text-base font-bold text-foreground sm:text-lg">
                    {item.q}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-5 shrink-0 text-primary transition-transform duration-300",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-300 ease-out",
                    isOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-6 sm:text-base">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-muted-foreground">Still have a question?</p>
          <a
            href={BUSINESS.phoneHref}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-all hover:brightness-110"
          >
            <Phone className="size-4" />
            Call or text {BUSINESS.phoneDisplay}
          </a>
        </div>
      </div>
    </section>
  );
}
