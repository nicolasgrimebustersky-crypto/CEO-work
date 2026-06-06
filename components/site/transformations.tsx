"use client";

import { ContainerScroll } from "@/components/ui/container-scroll-animation";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";

export function Transformations() {
  return (
    <section id="work" className="relative -mt-20 bg-background">
      <ContainerScroll
        titleComponent={
          <div className="mb-4">
            <span className="text-sm font-semibold tracking-wide text-primary uppercase">
              See the difference
            </span>
            <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl">
              Real Before &amp;{" "}
              <span className="bg-gradient-to-b from-primary to-emerald-700 bg-clip-text text-transparent">
                After Transformations
              </span>
            </h2>
          </div>
        }
      >
        <div className="grid h-full w-full grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="relative h-full overflow-hidden rounded-xl">
            <ImagePlaceholder
              src="/photos/before.jpg"
              alt="Overgrown landscaping bed before Grime Bustersky"
            />
            <span className="absolute left-3 top-3 rounded-full bg-background/80 px-3 py-1 text-xs font-bold tracking-wide text-muted-foreground uppercase backdrop-blur">
              Before
            </span>
          </div>
          <div className="relative h-full overflow-hidden rounded-xl ring-1 ring-primary/40">
            <ImagePlaceholder
              src="/photos/after.jpg"
              alt="Fresh mulch and tidy landscaping after Grime Bustersky"
            />
            <span className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-bold tracking-wide text-primary-foreground uppercase">
              After
            </span>
          </div>
        </div>
      </ContainerScroll>
    </section>
  );
}
