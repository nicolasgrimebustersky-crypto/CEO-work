/**
 * Route builders, in one place.
 *
 * The customer detail screen takes its id from a query string rather than a
 * path segment. That is not a stylistic choice: the iOS build is a static
 * export bundled inside the native shell, and `output: 'export'` can only emit
 * dynamic path segments it knows at build time. Customer ids are created at a
 * front door months after the build, so `/customers/[id]` has no file to
 * resolve to on device and deep links 404.
 *
 * A query parameter resolves to the same static page for every customer, which
 * works identically on the web and inside the app.
 */
export const routes = {
  map: "/map",
  mapFocus: (customerId: string) => `/map?focus=${encodeURIComponent(customerId)}`,
  customers: "/customers",
  pipeline: "/pipeline",
  customer: (customerId: string) => `/customers/detail?id=${encodeURIComponent(customerId)}`,
  schedule: "/schedule",
  dashboard: "/dashboard",
  reports: "/reports",
  account: "/account",
  privacy: "/privacy",
} as const;
