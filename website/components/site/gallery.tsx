"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAIRS } from "./site-data";

const AUTO_MS = 5000;

export function Gallery() {
  const pairs = PAIRS;
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const touchX = React.useRef<number | null>(null);

  const go = React.useCallback(
    (dir: number) => setIndex((i) => (i + dir + pairs.length) % pairs.length),
    [pairs.length],
  );

  React.useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % pairs.length);
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [paused, pairs.length]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    touchX.current = null;
  };

  return (
    <section id="gallery" className="relative bg-background py-24 sm:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-primary uppercase">
            <Images className="size-4" /> Before &amp; after
          </span>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Real transformations, side by side
          </h2>
          <p className="mt-4 text-muted-foreground">
            Actual Grime Busters KY jobs across Louisville &amp; Oldham County —
            swipe through the before and after.
          </p>
        </div>

        <div
          className="group relative mt-12 overflow-hidden rounded-3xl border border-border/70 bg-card p-3 sm:p-4"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          role="region"
          aria-roledescription="carousel"
          aria-label="Before and after gallery"
        >
          {/* track */}
          <div
            className="flex transition-transform duration-700 ease-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {pairs.map((p, i) => (
              <div
                key={p.before}
                className="w-full shrink-0 grow-0 basis-full"
                aria-hidden={i !== index}
              >
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <figure className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.before}
                      alt={`Before — ${p.title}`}
                      loading={i === 0 ? "eager" : "lazy"}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute left-2 top-2 rounded-full bg-background/85 px-3 py-1 text-xs font-bold tracking-wide text-muted-foreground uppercase backdrop-blur">
                      Before
                    </span>
                  </figure>
                  <figure className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black ring-2 ring-primary/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.after}
                      alt={`After — ${p.title}`}
                      loading={i === 0 ? "eager" : "lazy"}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute left-2 top-2 rounded-full bg-primary px-3 py-1 text-xs font-bold tracking-wide text-primary-foreground uppercase">
                      After
                    </span>
                  </figure>
                </div>
                <p className="mt-3 text-center text-sm font-medium text-foreground/80 sm:text-base">
                  {p.title}
                </p>
              </div>
            ))}
          </div>

          {/* arrows */}
          <button
            type="button"
            aria-label="Previous"
            onClick={() => go(-1)}
            className="absolute left-3 top-[42%] grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground opacity-0 backdrop-blur transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => go(1)}
            className="absolute right-3 top-[42%] grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground opacity-0 backdrop-blur transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        {/* dots */}
        <div className="mt-5 flex items-center justify-center gap-2">
          {pairs.map((p, i) => (
            <button
              key={p.before}
              type="button"
              aria-label={`Go to pair ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                "h-2 rounded-full transition-all",
                i === index ? "w-6 bg-primary" : "w-2 bg-border hover:bg-muted-foreground/60",
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
