import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";

import { AuthGate } from "@/components/auth/AuthGate";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { ConnectionProvider } from "@/components/providers/ConnectionProvider";
import { CustomersProvider } from "@/components/providers/CustomersProvider";
import { DocumentsProvider } from "@/components/providers/DocumentsProvider";
import { JobsProvider } from "@/components/providers/JobsProvider";
import { KnockRoutesProvider } from "@/components/providers/KnockRoutesProvider";
import { TerritoriesProvider } from "@/components/providers/TerritoriesProvider";
import { LocationSharingProvider } from "@/components/providers/LocationSharingProvider";
import { NotificationsProvider } from "@/components/providers/NotificationsProvider";
import { ServicesProvider } from "@/components/providers/ServicesProvider";
import { TeamProvider } from "@/components/providers/TeamProvider";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

/**
 * A geometric sans, self-hosted by Next at build time rather than fetched from
 * Google at runtime — the CSP forbids third-party origins, and a font request
 * that has to resolve DNS in a dead spot between subdivisions would leave the
 * app rendering in a fallback face exactly when it is being used.
 *
 * Only three weights ship. Every weight is another file to download over a
 * phone connection, and the UI never uses anything between them.
 */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Grime Busters CRM",
  description:
    "Door-to-door CRM for pressure washing, landscaping and snow removal in Oldham County, KY.",
  applicationName: "Grime Busters CRM",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Grime Busters",
    statusBarStyle: "black-translucent",
    // Safari shows a white screen while an installed web app boots unless it
    // finds a launch image matching the exact device resolution. Without these
    // every cold start flashes white against a near-black UI.
    startupImage: [
      { url: "/splash/iphone15.png", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/iphone14plus.png", media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/iphone13.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/iphonex.png", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/iphone8plus.png", media: "(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/iphone8.png", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  // A private CRM full of customers' addresses has no business being indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#050607",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // The map handles its own zoom; page-level pinch zoom just fights it.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${poppins.variable}`}>
      <body className="min-h-full antialiased">
        <AuthProvider>
          <AuthGate>
            <TeamProvider>
              <CustomersProvider>
                <JobsProvider>
                  <DocumentsProvider>
                    <ServicesProvider>
                      <KnockRoutesProvider>
                      <TerritoriesProvider>
                      <NotificationsProvider>
                        <ConnectionProvider>
                          <LocationSharingProvider>
                            <AppShell>{children}</AppShell>
                          </LocationSharingProvider>
                        </ConnectionProvider>
                      </NotificationsProvider>
                      </TerritoriesProvider>
                      </KnockRoutesProvider>
                    </ServicesProvider>
                  </DocumentsProvider>
                </JobsProvider>
              </CustomersProvider>
            </TeamProvider>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
