import { readFileSync } from "node:fs";

/**
 * Loads a rules file with its crew allowlist rewritten to the test uids.
 *
 * The allowlist is read out of the file rather than assumed, because these
 * tests used to hardcode the REPLACE_WITH_*_UID placeholder strings. That
 * quietly stopped working the moment the placeholders were filled in with real
 * uids: the substitution matched nothing, the rules under test allowed the real
 * crew instead of alice and bob, and ten assertions flipped to failing for a
 * reason that had nothing to do with the rules being wrong.
 *
 * Matching the shape of the allowlist instead means the suite tests the same
 * logic whether the file holds placeholders or a deployed pair of uids.
 */
const ALLOWLIST = /request\.auth\.uid in \[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/;

export function rulesWithTestCrew(path) {
  const source = readFileSync(path, "utf8");
  const match = source.match(ALLOWLIST);

  if (!match) {
    throw new Error(
      `Could not find the two-uid crew allowlist in ${path}. ` +
        `If its shape changed, update ALLOWLIST in tests/rulesSource.mjs — ` +
        `silently testing the wrong rules is worse than failing here.`,
    );
  }

  const [, firstUid, secondUid] = match;
  return source.replaceAll(firstUid, "alice").replaceAll(secondUid, "bob");
}
