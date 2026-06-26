import { Quote, Star } from "lucide-react";
import { TESTIMONIALS } from "./site-data";

function Stars({ rating = 5, className = "size-4" }: { rating?: number; className?: string }) {
  return (
    <div className="flex" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, s) => (
        <Star
          key={s}
          className={
            className +
            (s < rating
              ? " fill-primary text-primary"
              : " text-muted-foreground/35")
          }
        />
      ))}
    </div>
  );
}

export function Testimonials() {
  const count = TESTIMONIALS.length;
  const avg = (
    TESTIMONIALS.reduce((sum, t) => sum + (t.rating ?? 5), 0) / count
  ).toFixed(1);

  return (
    <section className="relative bg-background py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold tracking-wide text-primary uppercase">
            Happy customers
          </span>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Louisville loves the results
          </h2>
          <div className="mt-4 flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2">
              <span className="font-heading text-2xl font-extrabold text-foreground">
                {avg}
              </span>
              <Stars rating={Math.round(Number(avg))} className="size-5" />
            </div>
            <p className="text-sm text-muted-foreground">
              from {count} real customer reviews on Google
            </p>
          </div>
        </div>

        {/* masonry columns so varied review lengths arrange neatly */}
        <div className="mt-12 gap-6 [column-fill:_balance] sm:columns-2 lg:columns-3">
          {TESTIMONIALS.map((t, i) => (
            <figure
              key={i}
              className="mb-6 flex break-inside-avoid flex-col rounded-2xl border border-border/70 bg-card p-6"
            >
              <div className="flex items-center justify-between">
                <Quote className="size-6 text-primary/70" />
                <Stars rating={t.rating ?? 5} />
              </div>
              <blockquote className="mt-4 text-sm leading-relaxed text-foreground/85">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-5 flex items-center justify-between border-t border-border/60 pt-4">
                <span className="font-semibold text-foreground">{t.author}</span>
                <span className="text-xs text-muted-foreground">via Google</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
