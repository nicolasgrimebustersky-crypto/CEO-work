/**
 * Where the API lives.
 *
 * On the web the app and its API routes share an origin, so relative URLs are
 * correct and this is empty. Inside the iOS shell the page is served from the
 * app bundle at `capacitor://localhost`, so a relative `/api/sms/send` would
 * resolve to a file that does not exist — the native build has to point at the
 * deployed backend explicitly.
 *
 * Set NEXT_PUBLIC_API_BASE_URL to the Vercel URL for native builds, e.g.
 *   NEXT_PUBLIC_API_BASE_URL=https://grimebusters.vercel.app
 */
const configured = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");

export const apiBaseUrl = configured;

export function apiUrl(path: string): string {
  const normalised = path.startsWith("/") ? path : `/${path}`;
  return `${configured}${normalised}`;
}

/**
 * True when the app is talking to a backend on another origin — which is the
 * case in the native build, and the reason the API routes need CORS.
 */
export const isCrossOriginApi = configured.length > 0;
