"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import { cn } from "@/lib/utils";
import { GALLERY } from "./site-data";

const AUTO_MS = 4500;

export function Gallery() {
  const items = GALLERY;
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const touchX = React.useRef<number | null>(null);

  const go = React.useCallback(
    (dir: number) => setIndex((i) => (i + dir + items.length) % items.length),
    [items.length],
  );
  const to = (i: number) => setIndex(i);

  // auto-advance, paused on hover/focus or when the tab is hidden
  React.useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % items.length);
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [paused, items.length]);

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
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-primary uppercase">
            <Images className="size-4" /> Our work
          </span>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Real jobs, real Louisville results
          </h2>
          <p className="mt-4 text-muted-foreground">
            A look at recent pressure washing and landscaping work across
            Louisville &amp; Oldham County.
          </p>
        </div>

        <div
          className="group relative mt-12 overflow-hidden rounded-3xl border border-border/70 bg-card"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          role="region"
          aria-roledescription="carousel"
          aria-label="Gallery of recent work"
        >
          {/* track */}
          <div
            className="flex aspect-[4/3] transition-transform duration-700 ease-out sm:aspect-[16/9]"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {items.map((item, i) => (
              <div
                key={item.src}
                className="relative h-full w-full shrink-0 grow-0 basis-full bg-black"
                aria-hidden={i !== index}
              >
                {item.type === "video" ? (
                  <video
                    className="h-full w-full object-cover"
                    src={item.src}
                    poster={item.poster}
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="metadata"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.src}
                    alt={item.alt}
                    loading={i === 0 ? "eager" : "lazy"}
                    className="h-full w-full object-cover"
                  />
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 sm:p-6">
                  <p className="text-sm font-medium text-white/90 sm:text-base">
                    {item.alt}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* arrows */}
          <button
            type="button"
            aria-label="Previous"
            onClick={() => go(-1)}
            className="absolute left-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/70 text-foreground opacity-0 backdrop-blur transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => go(1)}
            className="absolute right-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/70 text-foreground opacity-0 backdrop-blur transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
          >
            <ChevronRight className="size-5" />
          </button>

          {/* counter */}
          <div className="absolute right-3 top-3 rounded-full bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            {index + 1} / {items.length}
          </div>
        </div>

        {/* dots */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {items.map((item, i) => (
            <button
              key={item.src}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              onClick={() => to(i)}
              className={cn(
                "h-2 rounded-full transition-all",
                i === index
                  ? "w-6 bg-primary"
                  : "w-2 bg-border hover:bg-muted-foreground/60",
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
