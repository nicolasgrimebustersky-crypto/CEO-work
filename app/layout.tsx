import type { Metadata, Viewport } from "next";

import { AuthGate } from "@/components/auth/AuthGate";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { ConnectionProvider } from "@/components/providers/ConnectionProvider";
import { CustomersProvider } from "@/components/providers/CustomersProvider";
import { JobsProvider } from "@/components/providers/JobsProvider";
import { LocationSharingProvider } from "@/components/providers/LocationSharingProvider";
import { NotificationsProvider } from "@/components/providers/NotificationsProvider";
import { TeamProvider } from "@/components/providers/TeamProvider";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

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
  themeColor: "#0b0f14",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // The map handles its own zoom; page-level pinch zoom just fights it.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">
        <AuthProvider>
          <AuthGate>
            <TeamProvider>
              <CustomersProvider>
                <JobsProvider>
                  <NotificationsProvider>
                    <ConnectionProvider>
                      <LocationSharingProvider>
                        <AppShell>{children}</AppShell>
                      </LocationSharingProvider>
                    </ConnectionProvider>
                  </NotificationsProvider>
                </JobsProvider>
              </CustomersProvider>
            </TeamProvider>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
