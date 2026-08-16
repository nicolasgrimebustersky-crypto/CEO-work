import path from "node:path";

import withPWAInit from "next-pwa";
import type { NextConfig } from "next";

/**
 * Demo mode ships an invented dataset instead of talking to Firebase. See
 * lib/demo/enabled.ts. The flag is read here as well so the fixtures can be
 * aliased away in a normal build — the `isDemoMode` branches are already dead
 * code there, but the sample customers would otherwise still be sitting in the
 * bundle, and "not in the file" is a better guarantee than "unreachable".
 */
const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/**
 * Content Security Policy.
 *
 * `script-src` has to allow 'unsafe-inline' and 'unsafe-eval': Next injects an
 * inline bootstrap script, and the Google Maps JS API evaluates code it fetches
 * at runtime. Locking those down would need a nonce-issuing middleware and
 * would still break Maps, so the value here comes from constraining
 * *destinations* instead — where scripts may come from, where the page may
 * connect, and what may embed it. frame-ancestors kills clickjacking outright,
 * object-src kills plugin vectors, and base-uri kills base-tag injection.
 *
 * If the map ever fails to load after a policy change, set
 * CSP_REPORT_ONLY=true to downgrade this to reporting while you find the
 * missing source, rather than dropping the policy altogether.
 */
/**
 * The Firebase emulators live on 127.0.0.1:8080/9099/9199, which is a different
 * origin from the dev server, so `connect-src 'self'` would block every read
 * and write. Only ever added when emulator mode is explicitly switched on —
 * never in a production build.
 */
const EMULATOR_ORIGINS =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true"
    ? " http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
    : "";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.googleapis.com https://*.gstatic.com https://*.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // Map tiles, Street View imagery and Firebase Storage job photos.
  `img-src 'self' blob: data: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://firebasestorage.googleapis.com https://storage.googleapis.com${EMULATOR_ORIGINS}`,
  // Firestore uses long-polling/WebSocket to firestore.googleapis.com; Auth
  // talks to identitytoolkit; the map talks to maps/places/routes.
  `connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com https://firebaseinstallations.googleapis.com https://securetoken.googleapis.com wss://*.firebaseio.com${EMULATOR_ORIGINS}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "frame-src 'self' https://*.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  {
    key: process.env.CSP_REPORT_ONLY === "true"
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy",
    value: CSP,
  },
  // Belt and braces alongside frame-ancestors, for anything that predates CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app needs the camera and GPS; nothing else, and nobody embedded.
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), interest-cohort=()",
  },
  // Two years, preloadable. Vercel serves HTTPS only, so this costs nothing.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // A private CRM full of customers' names and addresses has no business in a
  // search index.
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  webpack(config, { webpack }) {
    // resolve.alias loses to the tsconfig-paths resolver Next installs for
    // "@/…", so the swap is done as a module replacement instead, which acts on
    // the request before resolution.
    if (!isDemo) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^@\/lib\/demo\/fixtures$/,
          path.resolve(process.cwd(), "lib/demo/fixtures.empty.ts"),
        ),
      );
    }
    return config;
  },

  // Don't advertise the framework and version to scanners.
  poweredByHeader: false,

  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        // API responses must never be cached by a proxy or the worker.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
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
