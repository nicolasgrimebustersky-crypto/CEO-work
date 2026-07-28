import "server-only";

/**
 * CORS for the iOS build.
 *
 * The native app serves its UI from the app bundle, so every API call is
 * cross-origin. WKWebView reports that origin as `capacitor://localhost`
 * (and `ionic://localhost` on some configurations).
 *
 * The allowlist is exact-match and deliberately short. A wildcard would be
 * worse than useless here: these endpoints spend money, and while the bearer
 * token is still the real gate, there is no reason to let an arbitrary web page
 * put a request on the wire at all.
 */
const ALLOWED_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  // Local development of the native shell.
  "http://localhost",
  "http://localhost:3000",
]);

function isAllowed(origin: string | null): origin is string {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;

  // The site's own deployments. NEXT_PUBLIC_SITE_URL is the canonical one;
  // Vercel preview URLs are covered by VERCEL_URL at runtime.
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site && origin === site.replace(/\/+$/, "")) return true;
  if (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) {
    return true;
  }
  return false;
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!isAllowed(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    // Caches must not serve one origin's response to another.
    Vary: "Origin",
  };
}

/** Preflight handler. Export as `OPTIONS` from any route the app calls. */
export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** Wraps a JSON response with the right CORS headers for this caller. */
export function withCors(
  request: Request,
  body: unknown,
  init: ResponseInit = {},
): Response {
  return Response.json(body, {
    ...init,
    headers: { ...(init.headers ?? {}), ...corsHeaders(request) },
  });
}
