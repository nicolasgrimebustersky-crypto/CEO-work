import { Check } from "lucide-react";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";
import { BUSINESS, OWNERS, CREW, type TeamMember } from "./site-data";

const HIGHLIGHTS = [
  "Locally owned & operated in Louisville",
  "On-time, respectful, and detail-obsessed",
  "Free quotes with no high-pressure sales",
  "We treat every property like our own",
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Avatar({ member, className }: { member: TeamMember; className?: string }) {
  return (
    <div
      className={
        "grid place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary/30 to-primary/5 ring-2 ring-primary/30 " +
        (className ?? "")
      }
    >
      {member.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.photo}
          alt={member.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="font-heading font-extrabold text-primary">
          {initials(member.name)}
        </span>
      )}
    </div>
  );
}

export function Team() {
  return (
    <section id="team" className="relative bg-background py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold tracking-wide text-primary uppercase">
            Meet the team
          </span>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            The crew behind the clean
          </h2>
          <p className="mt-4 text-muted-foreground">
            Local, hard-working, and proud of every job — meet the people who
            show up for {BUSINESS.shortName}.
          </p>
        </div>

        {/* Owners feature */}
        <div className="mt-16 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="relative">
            <div className="aspect-4/5 overflow-hidden rounded-3xl border border-border/70 bg-card">
              <ImagePlaceholder
                src="/photos/founders.jpg"
                alt={`${BUSINESS.founders}, co-owners of ${BUSINESS.shortName}`}
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
              The owners
            </span>
            <h3 className="mt-3 font-heading text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              Young, hungry, and seriously good at busting grime
            </h3>
            <p className="mt-5 text-muted-foreground">
              {BUSINESS.shortName} was founded by {BUSINESS.founders} — two local
              entrepreneurs who turned a strong work ethic into Louisville&apos;s
              go-to pressure washing and landscaping crew. When you hire us, you
              get owners who show up, care about the details, and stand behind
              every job.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              {OWNERS.map((o) => (
                <div
                  key={o.name}
                  className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-4 py-2.5"
                >
                  <Avatar member={o} className="size-10 text-sm" />
                  <div className="leading-tight">
                    <p className="text-sm font-bold text-foreground">{o.name}</p>
                    <p className="text-xs text-primary">{o.role}</p>
                  </div>
                </div>
              ))}
            </div>

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

        {/* Crew */}
        <div className="mt-20 text-center">
          <h3 className="font-heading text-2xl font-extrabold tracking-tight text-foreground">
            The crew that gets it done
          </h3>
          <p className="mt-3 text-sm text-muted-foreground">
            The friendly faces you&apos;ll see around the neighborhood.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-3">
          {CREW.map((member) => (
            <div
              key={member.name}
              className="group flex flex-col items-center rounded-2xl border border-border/70 bg-card p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:border-primary/50"
            >
              <Avatar member={member} className="size-24 text-2xl" />
              <p className="mt-4 font-heading text-lg font-bold text-foreground">
                {member.name}
              </p>
              <p className="text-sm text-primary">{member.role}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
