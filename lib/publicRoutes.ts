/**
 * Routes that render without a session and without the app shell.
 *
 * The privacy policy has to be readable by someone who is not signed in: App
 * Store Connect requires a public policy URL and App Review opens it cold.
 * Gating it behind a login is a rejection under Guideline 5.1.1.
 *
 * Two components consult this — AuthGate skips the login wall, AppShell skips
 * the navigation. Both are needed: AuthGate's children *are* the shell, so
 * letting a public route through there alone still renders a nav bar pointing
 * at screens the reader cannot open.
 */
const PUBLIC_ROUTES = new Set(["/privacy"]);

/**
 * Prefixes where every path below them is public.
 *
 * `/v/<token>` is a customer opening their own estimate. The token is the
 * authorisation and it is checked on the server, so there is nothing here for
 * a session to add — and a login wall in front of it would defeat the entire
 * point of sending the link.
 */
const PUBLIC_PREFIXES = ["/v/"];

export function isPublicRoute(pathname: string): boolean {
  // The static export serves /privacy/ with a trailing slash.
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (PUBLIC_ROUTES.has(clean)) return true;
  // `/v/` alone is not public: there is no document without a token, and the
  // route would 404 anyway. Only a path *below* the prefix counts.
  return PUBLIC_PREFIXES.some((prefix) => clean.startsWith(prefix) && clean.length > prefix.length);
}
