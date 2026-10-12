/**
 * Lets a test import an app module by the `@/` path the app itself uses.
 *
 * Without this, anything under app/ or lib/ that imports `@/lib/...` cannot be
 * loaded by `node --test`, because that alias is a bundler convention Node
 * knows nothing about. The practical consequence was worse than inconvenience:
 * modules that could not be imported got tested by reading their source and
 * matching regexes against it, which proves the code says something, not that
 * it does something. A rename keeps such a test green; so does a transaction
 * that writes the wrong field.
 *
 * It also rescues a relative import that names no extension. App modules write
 * `from "./admin"`, which a bundler resolves to `admin.ts` and Node does not
 * resolve at all — so `lib/server/customerNotes.ts` could not be imported by a
 * test even though `lib/server/documentViews.ts`, two files away, could. The
 * difference was invisible and decided only by which module happened to spell
 * its neighbours with the alias.
 *
 * Still narrow, in the way that matters: every specifier is offered to Node
 * first, and the extensions are tried only after Node has already failed to
 * resolve it. Adding this to the test run therefore cannot change how an
 * existing test loads anything — it can only make something load that
 * previously threw.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The spellings a bundler would try for a path with no extension. */
function candidatesFor(base) {
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
}

function firstThatExists(base) {
  for (const candidate of candidatesFor(base)) {
    if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) {
    try {
      return await next(specifier, context);
    } catch (error) {
      // Node could not resolve it. A relative specifier with no extension is
      // the one case worth a second attempt — "./admin" meaning "./admin.ts".
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (!relative || !context.parentURL) throw error;
      const resolved = firstThatExists(fileURLToPath(new URL(specifier, context.parentURL)));
      if (resolved) return resolved;
      throw error;
    }
  }

  const base = `${ROOT}${specifier.slice(2)}`;
  // Longest-first, so `@/lib/foo` prefers lib/foo.ts over lib/foo/index.ts
  // only when the file is actually there — the same order the bundler uses.
  const resolved = firstThatExists(base);
  if (resolved) return resolved;
  // Fall through rather than throw our own error: Node's message names the
  // importing file, which is what you need to fix a bad specifier.
  return next(specifier, context);
}
