import { Check } from "lucide-react";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";
import { BUSINESS } from "./site-data";

const HIGHLIGHTS = [
  "Locally owned & operated in Louisville",
  "On-time, respectful, and detail-obsessed",
  "Free quotes with no high-pressure sales",
  "We treat every property like our own",
];

export function Founders() {
  return (
    <section id="founders" className="relative bg-background py-24 sm:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div className="relative">
          <div className="aspect-4/5 overflow-hidden rounded-3xl border border-border/70 bg-card">
            <ImagePlaceholder
              alt={`${BUSINESS.founders}, founders of ${BUSINESS.shortName}`}
              label="Founders photo"
            />
          </div>
          <div className="absolute -bottom-5 -right-4 rounded-2xl border border-primary/30 bg-card/90 px-5 py-4 backdrop-blur">
            <p className="font-heading text-2xl font-extrabold text-primary">
              Local
            </p>
            <p className="text-xs text-muted-foreground">
              Louisville owned &amp; run
            </p>
          </div>
        </div>

        <div>
          <span className="text-sm font-semibold tracking-wide text-primary uppercase">
            Meet the crew
          </span>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Young, hungry, and seriously good at busting grime
          </h2>
          <p className="mt-5 text-muted-foreground">
            {BUSINESS.shortName} was founded by {BUSINESS.founders} — two local
            entrepreneurs who turned a strong work ethic into Louisville&apos;s
            go-to pressure washing and landscaping crew. When you hire us, you
            get owners who show up, care about the details, and stand behind
            every job.
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {HIGHLIGHTS.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 text-sm text-foreground/85"
              >
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                  <Check className="size-3.5" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
