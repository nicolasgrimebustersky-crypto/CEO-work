/**
 * Refuses a build that would put one business's app on another's data.
 *
 * Each brand runs its own Firebase project (see lib/brand.ts). The Grime
 * Busters web config is committed in .env.production, and Next loads that file
 * into every production build — so a new brand's deployment that has not yet
 * had its own NEXT_PUBLIC_FIREBASE_* values set in Vercel builds cleanly,
 * deploys, and talks to the Grime Busters database. The rules would deny a
 * stranger's account, but "the rules would catch it" is not where this should
 * be caught: the build is.
 *
 * Called from next.config.ts, so it runs for `next build` and `next dev`
 * alike. Free of imports so the test runner can load it directly.
 *
 * Returns the problem in words, or null when the configuration is coherent.
 */

/** The Firebase project the Grime Busters deployment uses. */
export const GRIME_BUSTERS_FIREBASE_PROJECT = "grimeline-5e3d8";

const KNOWN_BRANDS = ["grime-busters", "rda"];

export function brandDeploymentProblem(env: Record<string, string | undefined>): string | null {
  const raw = (env.NEXT_PUBLIC_BRAND ?? "").trim();
  const brand = raw || "grime-busters";

  if (!KNOWN_BRANDS.includes(brand)) {
    return `NEXT_PUBLIC_BRAND is "${raw}", which is not a brand this app knows. Use one of: ${KNOWN_BRANDS.join(", ")} — or leave it unset for grime-busters.`;
  }

  // The demo build reads invented fixtures and never talks to Firebase, so
  // whichever project is configured is never reached.
  if (env.NEXT_PUBLIC_DEMO_MODE === "true") return null;

  const project = (env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").trim();
  if (brand !== "grime-busters" && project === GRIME_BUSTERS_FIREBASE_PROJECT) {
    return `NEXT_PUBLIC_BRAND is "${brand}" but NEXT_PUBLIC_FIREBASE_PROJECT_ID is the Grime Busters project (${GRIME_BUSTERS_FIREBASE_PROJECT}), inherited from .env.production. Set all six NEXT_PUBLIC_FIREBASE_* values to this brand's own Firebase project in the deployment's environment.`;
  }

  return null;
}
