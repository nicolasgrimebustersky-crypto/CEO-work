/**
 * Installs the `@/` resolver for the test run.
 *
 *   node --experimental-strip-types --import=./tests/helpers/register.mjs --test ...
 *
 * Separate from the hook itself because a resolver has to be registered from
 * the main thread before the first import, while the hook runs on a loader
 * thread of its own.
 */
import { register } from "node:module";

register("./appAliases.mjs", import.meta.url);
