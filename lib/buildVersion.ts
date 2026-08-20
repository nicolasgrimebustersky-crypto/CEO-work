/**
 * Telling somebody the link they are on is out of date.
 *
 * Every Vercel deployment keeps its own permanent URL. A link shared last
 * month still loads, still looks right, and still lets somebody work — against
 * a build that has since been replaced. Nothing about the page says so, which
 * makes it the most convincing kind of wrong: a colleague reporting a bug that
 * was fixed a fortnight ago, or worse, quietly using an old estimate builder.
 *
 * The check is a comparison, not a date. A build knows the commit it was built
 * from; the production URL will tell anybody who asks which commit is live. If
 * they differ, this build is not the current one.
 *
 * Free of imports so the comparison — which decides whether to alarm somebody —
 * is tested by running it.
 */

/**
 * The commit this bundle was built from, frozen in at build time.
 *
 * Supplied by next.config.ts from Vercel's VERCEL_GIT_COMMIT_SHA. Empty in a
 * local build, which is deliberate: see `isStaleBuild`.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

/**
 * Is the build the viewer is looking at older than the one that is live?
 *
 * Fails *closed on the alarm* — that is, it says nothing unless it is certain.
 * Three cases return false on purpose:
 *
 *   Either id missing. A local build has no commit, and an unreachable version
 *   endpoint returns nothing. Neither means "out of date", and telling somebody
 *   their app is stale because their wifi dropped teaches them to ignore the
 *   banner that matters.
 *
 *   The ids match. This is the live build.
 *
 * Only two known, different commits raise it.
 */
export function isStaleBuild(
  mine: string | null | undefined,
  live: string | null | undefined,
): boolean {
  const a = (mine ?? "").trim();
  const b = (live ?? "").trim();
  if (!a || !b) return false;
  return a !== b;
}

/** Short form for the banner, so it is recognisable without being noise. */
export function shortBuild(id: string | null | undefined): string {
  return (id ?? "").trim().slice(0, 7);
}

export const STALE_TITLE = "You're on an old link";
export const STALE_BODY =
  "This version of the app has been replaced. Ask Nicolas for the current link — anything you do here may be out of date.";
