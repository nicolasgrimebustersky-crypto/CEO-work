/**
 * Google Analytics' global, declared once so the call sites do not each cast
 * `window` to `any` to reach it.
 *
 * Optional on purpose: the tag is injected by the analytics script, so on a
 * first paint, with an ad blocker, or in any environment where that script did
 * not load, `gtag` is genuinely absent. Every call site uses `?.` and the type
 * is what makes that non-negotiable rather than a habit.
 */
declare global {
  interface Window {
    gtag?: (
      command: "event",
      eventName: string,
      params?: Record<string, string | number | boolean | undefined>,
    ) => void;
  }
}

export {};
