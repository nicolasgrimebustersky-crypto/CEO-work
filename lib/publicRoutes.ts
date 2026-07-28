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

export function isPublicRoute(pathname: string): boolean {
  // The static export serves /privacy/ with a trailing slash.
  return PUBLIC_ROUTES.has(pathname.replace(/\/+$/, "") || "/");
}
