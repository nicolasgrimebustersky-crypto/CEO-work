import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Job photos live in Firebase Storage; download URLs come back on these
    // hosts with an access token in the query string.
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "storage.googleapis.com" },
    ],
  },
  // PWA / offline support is wired up in Phase 4. `next-pwa` is installed and
  // ready; enabling it here before the offline write queue exists would cache
  // stale customer data with no way to reconcile it.
};

export default nextConfig;
