import { STEPS } from "./site-data";

export function Process() {
  return (
    <section id="process" className="relative bg-background py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold tracking-wide text-primary uppercase">
            How it works
          </span>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Sparkling clean in three easy steps
          </h2>
        </div>

        <div className="relative mt-16 grid gap-8 md:grid-cols-3">
          <div
            aria-hidden
            className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent md:block"
          />
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="relative flex flex-col items-center text-center"
              >
                <div className="relative z-10 grid size-14 place-items-center rounded-full border border-primary/30 bg-card text-primary shadow-[0_0_30px_-8px_hsl(var(--primary)/0.6)]">
                  <Icon className="size-6" />
                  <span className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                </div>
                <h3 className="mt-5 font-heading text-lg font-bold text-foreground">
                  {step.title}
                </h3>
                <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
