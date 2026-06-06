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
              The Grime Bustersky
              <br />
              <span className="bg-gradient-to-b from-primary to-emerald-700 bg-clip-text text-transparent">
                Clean You Can See
              </span>
            </h2>
          </div>
        }
      >
        <ImagePlaceholder
          src="/photos/showcase.jpg"
          alt="Freshly pressure-washed composite deck at sunset"
          imgClassName="rounded-xl"
        />
      </ContainerScroll>
    </section>
  );
}
