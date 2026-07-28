/**
 * Demo mode.
 *
 * Serves a fake in-memory dataset instead of Firebase, so the app can be
 * deployed and walked through before anyone has created a Firebase project.
 * Every screen works; nothing is persisted and a reload starts over.
 *
 * Gated on a build-time constant rather than a runtime check on purpose. In a
 * normal build `isDemoMode` is a literal `false`, so every demo branch is dead
 * code — and next.config.ts goes further and swaps lib/demo/fixtures.ts for an
 * empty stub, so the invented customers are not in the bundle at all. No
 * production build can serve fake data or skip the login, whatever happens at
 * runtime.
 *
 * Enable with NEXT_PUBLIC_DEMO_MODE=true at build time. The app shows a
 * permanent banner while it is on, because silently showing invented customers
 * to someone who thinks they are looking at their real book would be far worse
 * than not having a demo at all.
 */
export const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
