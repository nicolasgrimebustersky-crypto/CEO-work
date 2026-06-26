import type { Metadata } from "next";
import { Rubik, Nunito_Sans } from "next/font/google";
import { GoogleAnalytics } from "@/components/site/google-analytics";
import "./globals.css";

const rubik = Rubik({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const nunitoSans = Nunito_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const SITE_URL = "https://grimebusterskyllc.com";

// LocalBusiness structured data so Google understands the business.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "HomeAndConstructionBusiness"],
  name: "Grime Busters KY",
  legalName: "Grime Bustersky LLC",
  description:
    "Pressure washing, power washing, landscaping, mulching, and snow removal serving Louisville & Oldham County, Kentucky.",
  url: SITE_URL,
  telephone: "+1-502-599-6855",
  image: `${SITE_URL}/logo.png`,
  logo: `${SITE_URL}/logo.png`,
  priceRange: "$$",
  address: {
    "@type": "PostalAddress",
    addressLocality: "Louisville",
    addressRegion: "KY",
    addressCountry: "US",
  },
  areaServed: [
    { "@type": "City", name: "Louisville" },
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
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Grime Bustersky | Pressure Washing & Landscaping in Louisville, KY",
    template: "%s | Grime Bustersky",
  },
  description:
    "Louisville & Oldham County's bold local crew for pressure washing, power washing, landscaping, and snow removal. Driveways, siding, decks, commercial & industrial cleaning, mulching and more. Free quotes — call (502) 599-6855.",
  keywords: [
    "pressure washing Louisville",
    "power washing Kentucky",
    "driveway cleaning",
    "house washing",
    "landscaping Louisville",
    "mulching",
    "snow removal Oldham County",
    "snow removal Louisville",
    "commercial pressure washing",
    "Grime Bustersky",
  ],
  openGraph: {
    title: "Grime Bustersky | Pressure Washing & Landscaping",
    description:
      "Louisville's bold local crew for pressure washing and landscaping. Free quotes — call (502) 599-6855.",
    url: SITE_URL,
    siteName: "Grime Bustersky",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Grime Busters KY — Pressure Washing & Landscaping, Louisville KY",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Grime Bustersky | Pressure Washing & Landscaping",
    description:
      "Louisville & Oldham County's local crew for pressure washing, landscaping & snow removal. Free quotes — (502) 599-6855.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${rubik.variable} ${nunitoSans.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
        <GoogleAnalytics />
      </body>
    </html>
  );
}
