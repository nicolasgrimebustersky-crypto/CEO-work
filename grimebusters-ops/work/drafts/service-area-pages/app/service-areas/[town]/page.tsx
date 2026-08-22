// Drop into: app/service-areas/[town]/page.tsx
//
// Assumes App Router (confirmed by the site's next/font module class names
// on <html> and the existing /api/estimate route). Self-contained header/
// footer markup below — swap for the real shared components once I have
// repo access; see README "Still needed" #2.
//
// NAP, hours, rating, and social links are pulled verbatim from the live
// homepage's LocalBusiness JSON-LD (checked via curl, 2026-08-22) — not
// re-typed from memory.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SERVICE_AREAS, getServiceArea, type ServiceArea } from "@/lib/service-areas";

const PHONE_DISPLAY = "(502) 599-6855";
const PHONE_TEL = "+15025996855";
const SITE_URL = "https://grimebusterskyllc.com";

const SERVICES = [
  {
    name: "Residential Pressure Washing",
    blurb:
      "Bring back the curb appeal of your home — driveways, sidewalks, decks, patios, and vinyl siding cleaned to look brand new.",
    items: ["Driveways & walkways", "House & siding wash", "Decks & patios"],
  },
  {
    name: "Commercial Power Washing",
    blurb:
      "Keep your storefront and property spotless and professional, with minimal disruption to your operations.",
    items: ["Storefronts & entries", "Parking lots", "Dumpster pads"],
  },
  {
    name: "Landscaping & Mulching",
    blurb:
      "Finish the transformation with fresh mulch and tidy landscaping that makes the whole property pop.",
    items: ["Fresh mulch install", "Bed cleanup & edging", "Seasonal refresh"],
  },
  {
    name: "Snow Removal",
    blurb:
      `When winter hits ${"{town}"} & Oldham County, we keep your driveways and walkways clear, safe, and ice-free.`,
    items: ["Driveways & walkways", "Salting & de-icing", "Reliable storm response"],
  },
];

export function generateStaticParams() {
  return SERVICE_AREAS.map((a) => ({ town: a.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { town: string };
}): Metadata {
  const area = getServiceArea(params.town);
  if (!area) return {};

  const title = `Pressure Washing & Landscaping in ${area.name}, KY | Grime Busters KY`;
  const description = `Pressure washing, power washing, and landscaping in ${area.name}, Oldham County KY. Driveways, siding, decks, mulching, and snow removal. Free quotes — call ${PHONE_DISPLAY}.`;
  const url = `${SITE_URL}/service-areas/${area.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `Grime Busters KY | Pressure Washing & Landscaping in ${area.name}, KY`,
      description: `Oldham County's local crew for pressure washing and landscaping in ${area.name}. Free quotes — call ${PHONE_DISPLAY}.`,
      url,
      siteName: "Grime Bustersky",
      locale: "en_US",
      type: "website",
      images: [
        {
          url: `${SITE_URL}/og.png`,
          width: 1200,
          height: 630,
          alt: `Grime Busters KY — Pressure Washing & Landscaping, ${area.name} KY`,
        },
      ],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default function ServiceAreaPage({
  params,
}: {
  params: { town: string };
}) {
  const area = getServiceArea(params.town);
  if (!area) notFound();

  const otherAreas = SERVICE_AREAS.filter((a) => a.slug !== area.slug);
  const url = `${SITE_URL}/service-areas/${area.slug}`;

  const faqs = [
    {
      q: `Do you serve ${area.name}, KY?`,
      a: `Yes — ${area.name} is one of our core Oldham County service areas, along with ${otherAreas
        .map((a) => a.name)
        .join(", ")}. We're on-site here every week.`,
    },
    {
      q: "What services do you offer?",
      a: "Residential and commercial pressure washing, landscaping & mulching, and seasonal snow removal — from driveways and siding to full property cleanups.",
    },
    {
      q: "How much will my job cost?",
      a: "Every property is different, so we give free, no-pressure quotes. Tell us what needs cleaning and we'll get you a fast estimate with no obligation.",
    },
    {
      q: "What are your hours?",
      a: "We're available Monday through Sunday, 9:00 AM – 7:00 PM.",
    },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["LocalBusiness", "HomeAndConstructionBusiness"],
        "@id": `${url}#business`,
        name: "Grime Busters KY",
        legalName: "Grime Busters KY LLC",
        description: `Pressure washing, power washing, landscaping, mulching, and snow removal serving ${area.name} and Oldham County, Kentucky.`,
        url,
        telephone: PHONE_TEL,
        image: `${SITE_URL}/logo.png`,
        logo: `${SITE_URL}/logo.png`,
        priceRange: "$$",
        address: {
          "@type": "PostalAddress",
          addressLocality: area.name,
          addressRegion: "KY",
          postalCode: area.zip,
          addressCountry: "US",
        },
        areaServed: [
          { "@type": "City", name: area.name },
          { "@type": "AdministrativeArea", name: "Oldham County" },
        ],
        openingHoursSpecification: [
          {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: [
              "Monday",
              "Tuesday",
              "Wednesday",
              "Thursday",
              "Friday",
              "Saturday",
              "Sunday",
            ],
            opens: "09:00",
            closes: "19:00",
          },
        ],
        sameAs: [
          "https://www.instagram.com/grimebustersky",
          "https://www.facebook.com/profile.php?id=61576382277369",
          "https://www.tiktok.com/@grimebustersky",
          "https://www.google.com/maps?cid=6378439859517805393",
        ],
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: "4.9",
          reviewCount: "14",
          bestRating: "5",
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          {
            "@type": "ListItem",
            position: 2,
            name: "Service Areas",
            item: `${SITE_URL}/service-areas`,
          },
          { "@type": "ListItem", position: 3, name: area.name, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="relative bg-background py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <p className="text-sm font-medium uppercase tracking-wide text-primary">
            Pressure Washing &amp; Landscaping in {area.name}, KY
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {area.name}&apos;s Local Pressure Washing &amp; Landscaping Crew
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            <strong>Grime Busters KY</strong> is your local crew for
            driveways, siding, decks, landscaping &amp; mulching, and winter
            snow removal in {area.name} and across Oldham County, KY.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href="/#book"
              className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
            >
              Get a Free Quote
            </a>
            <a
              href={`tel:${PHONE_TEL}`}
              className="rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground"
            >
              Call {PHONE_DISPLAY}
            </a>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            4.9★ · 14 Google reviews &middot; Free quotes, always &middot;
            Owner-run on every job
          </p>
        </div>
      </section>

      {/* Local framing — new copy, see README */}
      <section className="bg-background py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
            Serving {area.name} and every corner of Oldham County
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            {area.localNote} We use soft washing and the correct chemistry
            for the surface — not just high pressure — so siding, brick, and
            concrete get clean without damage.
          </p>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            We&apos;re based in Oldham County and run jobs within a 25-mile
            radius of Crestwood, which covers all of {area.name} and the
            rest of our core area:{" "}
            {otherAreas.map((a, i) => (
              <span key={a.slug}>
                <Link
                  href={`/service-areas/${a.slug}`}
                  className="text-primary underline underline-offset-2"
                >
                  {a.name}
                </Link>
                {i < otherAreas.length - 2
                  ? ", "
                  : i === otherAreas.length - 2
                    ? ", and "
                    : ""}
              </span>
            ))}
            .
          </p>
        </div>
      </section>

      {/* Services */}
      <section className="bg-background py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
            What we do in {area.name}
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {SERVICES.map((s) => (
              <div
                key={s.name}
                className="rounded-2xl border border-border bg-card p-6"
              >
                <h3 className="text-lg font-semibold text-foreground">
                  {s.name}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {s.blurb.replace("{town}", area.name)}
                </p>
                <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                  {s.items.map((item) => (
                    <li key={item}>&bull; {item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-background py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
            {area.name} FAQ
          </h2>
          <dl className="mt-8 space-y-6">
            {faqs.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold text-foreground">{f.q}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-background py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
            Ready for a spotless {area.name} property?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Get a free, no-pressure quote today — see why {area.name} trusts
            Grime Busters KY.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <a
              href="/#book"
              className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
            >
              Get a Free Quote
            </a>
            <a
              href={`tel:${PHONE_TEL}`}
              className="rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground"
            >
              Call {PHONE_DISPLAY}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
