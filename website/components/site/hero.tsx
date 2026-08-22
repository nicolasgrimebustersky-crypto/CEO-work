"use client";

import { Phone, Sparkles, MapPin, Star } from "lucide-react";
import { WebGLShader } from "@/components/ui/web-gl-shader";
import { LiquidButton, MetalButton } from "@/components/ui/liquid-glass-button";
import { BUSINESS, STATS } from "./site-data";

export function Hero() {
  return (
    <section
      id="top"
      className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-4 pt-28 pb-20 text-center sm:px-6"
    >
      {/* Emerald WebGL shader, contained to the hero (canvas forced to absolute) */}
      <div className="pointer-events-none absolute inset-0 [&>canvas]:!absolute [&>canvas]:!h-full [&>canvas]:!w-full">
        <WebGLShader />
      </div>
      {/* readability + blend into the section below */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,hsl(var(--background)/0.55)_80%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-background" />

      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-background/40 px-4 py-1.5 text-xs font-semibold tracking-wide text-primary backdrop-blur-md uppercase">
          <Sparkles className="size-3.5" />
          Pressure Washing & Landscaping
        </span>

        <h1 className="font-heading text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl md:text-7xl">
          We Bust the Grime,
          <br />
          <span className="bg-gradient-to-b from-primary to-emerald-700 bg-clip-text text-transparent">
            You Boost the Curb Appeal
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
          {BUSINESS.shortName} is your bold local crew for driveways, siding,
          decks, commercial &amp; industrial cleaning, fresh landscaping &amp;
          mulching, and winter snow removal across {BUSINESS.area}.
        </p>

        <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row">
          <LiquidButton
            size="xl"
            className="rounded-full border border-primary/40 text-base font-semibold text-foreground"
            onClick={() => {
              document
                .getElementById("book")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Get a Free Quote
          </LiquidButton>

          <a href={BUSINESS.phoneHref} aria-label={`Call ${BUSINESS.phoneDisplay}`}>
            <MetalButton variant="success">
              <Phone className="mr-2 inline size-4" />
              Call {BUSINESS.phoneDisplay}
            </MetalButton>
          </a>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4 text-primary" />
            {BUSINESS.area}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="size-4 fill-primary text-primary" />
              ))}
            </span>
            Loved by local homeowners
          </span>
        </div>

        <dl className="mt-12 grid w-full max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 backdrop-blur-md sm:grid-cols-4">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center gap-1 bg-background/70 px-4 py-5"
            >
              <dt className="sr-only">{stat.label}</dt>
              <dd className="font-heading text-2xl font-extrabold text-primary">
                {stat.value}
              </dd>
              <span className="text-center text-xs text-muted-foreground">
                {stat.label}
              </span>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
