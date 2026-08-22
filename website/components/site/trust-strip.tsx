import { Star, MapPin, BadgeDollarSign, UsersRound } from "lucide-react";

const ITEMS = [
  { Icon: Star, stat: "4.9★", label: "14 Google reviews" },
  { Icon: MapPin, stat: "Local", label: "Louisville & Oldham Co." },
  { Icon: BadgeDollarSign, stat: "Free", label: "No-pressure quotes" },
  { Icon: UsersRound, stat: "Owner-run", label: "On every job" },
];

export function TrustStrip() {
  return (
    <section className="relative border-y border-border/60 bg-card/40">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:grid-cols-4 sm:px-6 lg:px-8">
        {ITEMS.map(({ Icon, stat, label }) => (
          <div
            key={label}
            className="flex items-center justify-center gap-3 px-4 py-6 text-center sm:py-7"
          >
            <Icon className="size-7 shrink-0 text-primary" />
            <div className="text-left">
              <p className="font-heading text-lg font-extrabold leading-none text-foreground">
                {stat}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
