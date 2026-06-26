import { Quote, Star } from "lucide-react";
import { TESTIMONIALS } from "./site-data";

export function Testimonials() {
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
          <div className="mt-4 flex flex-col items-center gap-1">
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, s) => (
                <Star key={s} className="size-5 fill-primary text-primary" />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              {TESTIMONIALS.length} real reviews from our customers on Google
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
                <div className="flex">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star key={s} className="size-4 fill-primary text-primary" />
                  ))}
                </div>
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
