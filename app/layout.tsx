import type { Metadata, Viewport } from "next";

import { AuthGate } from "@/components/auth/AuthGate";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { CustomersProvider } from "@/components/providers/CustomersProvider";
import { TeamProvider } from "@/components/providers/TeamProvider";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grime Busters CRM",
  description:
    "Door-to-door CRM for pressure washing, landscaping and snow removal in Oldham County, KY.",
  applicationName: "Grime Busters CRM",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent" },
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
                <AppShell>{children}</AppShell>
              </CustomersProvider>
            </TeamProvider>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
