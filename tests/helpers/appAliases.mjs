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
 * Deliberately narrow. It resolves `@/` and nothing else — every other
 * specifier goes straight to Node's own resolver untouched — so adding this to
 * the test run cannot change how an existing test loads anything.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);

  const base = `${ROOT}${specifier.slice(2)}`;
  // Longest-first, so `@/lib/foo` prefers lib/foo.ts over lib/foo/index.ts
  // only when the file is actually there — the same order the bundler uses.
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  // Fall through rather than throw our own error: Node's message names the
  // importing file, which is what you need to fix a bad specifier.
  return next(specifier, context);
}
