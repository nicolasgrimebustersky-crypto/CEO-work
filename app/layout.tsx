import type { Metadata } from "next";
import { Rubik, Nunito_Sans } from "next/font/google";
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
  },
  icons: { icon: "/favicon.ico" },
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
        {children}
      </body>
    </html>
  );
}
