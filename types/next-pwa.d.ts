/**
 * next-pwa ships no TypeScript types. This declares just the surface
 * next.config.ts uses.
 */
declare module "next-pwa" {
  import type { NextConfig } from "next";

  interface RuntimeCachingRule {
    urlPattern: RegExp | string | ((options: { url: URL }) => boolean);
    handler:
      | "CacheFirst"
      | "CacheOnly"
      | "NetworkFirst"
      | "NetworkOnly"
      | "StaleWhileRevalidate";
    options?: {
      cacheName?: string;
      networkTimeoutSeconds?: number;
      expiration?: { maxEntries?: number; maxAgeSeconds?: number };
      cacheableResponse?: { statuses?: number[]; headers?: Record<string, string> };
    };
  }

  interface PWAOptions {
    dest: string;
    disable?: boolean;
    register?: boolean;
    skipWaiting?: boolean;
    sw?: string;
    scope?: string;
    buildExcludes?: (string | RegExp)[];
    publicExcludes?: string[];
    fallbacks?: Record<string, string>;
    cacheOnFrontEndNav?: boolean;
    reloadOnOnline?: boolean;
    runtimeCaching?: RuntimeCachingRule[];
  }

  export default function withPWA(
    options: PWAOptions,
  ): (config: NextConfig) => NextConfig;
}
