import { BUILD_ID } from "@/lib/buildVersion";

export const runtime = "nodejs";
/** Never cached. A cached answer here is the exact bug this route exists to find. */
export const dynamic = "force-dynamic";

/**
 * Which build is live.
 *
 * Read by old deployments to work out that they are old, so it answers any
 * origin — the whole point is that a *different* Vercel URL can ask. That is
 * safe because the answer is one commit hash and nothing else: no auth, no
 * data, nothing not already visible in the repository's own history.
 *
 * Deliberately outside the crew gate. A stale link has to be able to say so
 * before anybody signs in, which is exactly when somebody is most likely to be
 * looking at the wrong one.
 */
export function GET(): Response {
  return Response.json(
    { buildId: BUILD_ID },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
