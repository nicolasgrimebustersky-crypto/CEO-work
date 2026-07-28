import withPWAInit from "next-pwa";
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
};

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  // A service worker in dev intercepts HMR and serves stale bundles.
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: false,
  cacheOnFrontEndNav: true,
  fallbacks: { document: "/offline" },
  runtimeCaching: [
    {
      // App shell. Network-first with a short timeout so a live version wins
      // when there is signal, and the cached shell loads instantly when there
      // is not.
      urlPattern: ({ url }: { url: URL }) =>
        url.origin === self.location.origin && !url.pathname.startsWith("/api/"),
      handler: "NetworkFirst",
      options: {
        cacheName: "gb-pages",
        networkTimeoutSeconds: 4,
        expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 14 },
      },
    },
    {
      urlPattern: /\/_next\/static\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "gb-static",
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico)$/i,
      handler: "CacheFirst",
      options: {
        cacheName: "gb-images",
        expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      // Job photos out of Firebase Storage — worth keeping for the before/after
      // comparison on a job you are standing in front of.
      urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "gb-job-photos",
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
  ],
  // Firestore and Google Maps are deliberately absent from runtimeCaching.
  // Firestore runs its own IndexedDB cache and write queue, which handles
  // offline far better than an HTTP cache could; and the Maps terms of service
  // forbid pre-caching or storing tiles, so the map needs signal.
});

export default withPWA(nextConfig);
