/**
 * Good / Better / Best estimates.
 *
 * One estimate, two or three priced options, and the customer picks one on
 * their link. Both big field-service apps lead with this because it changes
 * the question in the customer's head from "yes or no" to "which one", and a
 * share of people pick the middle option they would never have been offered.
 *
 * How it is stored, kept deliberately small:
 *
 *   - every line is either in every package (no `package`) or in exactly one;
 *   - a package's price is computeTotals over its lines, with the estimate's
 *     discount and tax rate — the same arithmetic as any other document;
 *   - choosing rewrites the estimate to the chosen package's lines and totals,
 *     keeping the full offer in `offeredLines`. From then on it is an ordinary
 *     estimate, so conversion to an invoice, the PDF and every report work
 *     unchanged, and none of them has to learn what a package is.
 *
 * Pure and import-free apart from the totals it shares with every document,
 * so each rule is tested by calling it.
 */

import { computeTotals, type LineItem, type QuotePackage, type Totals } from "./documents";

export const DEFAULT_PACKAGE_NAMES = ["Good", "Better", "Best"] as const;
export const MAX_PACKAGES = 3;

export function defaultPackages(): QuotePackage[] {
  return DEFAULT_PACKAGE_NAMES.map((name, index) => ({ id: `pkg${index + 1}`, name }));
}

/** The lines a package includes: the shared ones and its own. */
export function linesForPackage(lines: readonly LineItem[], packageId: string): LineItem[] {
  return lines.filter((line) => !line.package || line.package === packageId);
}

/** Lines in every package. */
export function sharedLines(lines: readonly LineItem[]): LineItem[] {
  return lines.filter((line) => !line.package);
}

export interface PricedPackage {
  pkg: QuotePackage;
  /** Only this package's own lines — the shared ones are listed once, separately. */
  ownLines: LineItem[];
  totals: Totals;
}

export function pricePackages(
  lines: readonly LineItem[],
  packages: readonly QuotePackage[],
  discount: number,
  taxRatePct: number,
): PricedPackage[] {
  return packages.map((pkg) => ({
    pkg,
    ownLines: lines.filter((line) => line.package === pkg.id),
    totals: computeTotals(linesForPackage(lines, pkg.id), discount, taxRatePct),
  }));
}

/**
 * The totals stored on an estimate with packages: the first package's. That
 * is the "from" price, and what the pipeline and reports count until the
 * customer chooses.
 */
export function storedTotals(
  lines: readonly LineItem[],
  packages: readonly QuotePackage[],
  discount: number,
  taxRatePct: number,
): Totals {
  const first = packages[0];
  return computeTotals(first ? linesForPackage(lines, first.id) : [...lines], discount, taxRatePct);
}

/** Lines tagged with a package that no longer exists go back to being shared. */
export function tidyLines(lines: readonly LineItem[], packages: readonly QuotePackage[]): LineItem[] {
  const ids = new Set(packages.map((pkg) => pkg.id));
  return lines.map((line) => {
    if (!line.package || ids.has(line.package)) return line;
    const shared = { ...line };
    delete shared.package;
    return shared;
  });
}

/** Why a set of packages cannot be offered, or null when it can. */
export function packagesProblem(lines: readonly LineItem[], packages: readonly QuotePackage[]): string | null {
  if (packages.length === 0) return null;
  if (packages.length < 2) return "Offer at least two packages, or turn packages off.";
  if (packages.length > MAX_PACKAGES) return `At most ${MAX_PACKAGES} packages.`;
  if (packages.some((pkg) => !pkg.name.trim())) return "Every package needs a name.";
  for (const pkg of packages) {
    if (!lines.some((line) => line.package === pkg.id)) {
      return `${pkg.name || "A package"} has no lines of its own — add one, or remove the package.`;
    }
  }
  return null;
}

export interface Chosen {
  lineItems: LineItem[];
  totals: Totals;
  pkg: QuotePackage;
}

/**
 * What the estimate becomes once a package is chosen, or null when the id is
 * not one of its packages. The id is the only thing the customer sends; the
 * lines and every price are read from the stored estimate.
 */
export function choosePackage(
  lines: readonly LineItem[],
  packages: readonly QuotePackage[],
  packageId: unknown,
  discount: number,
  taxRatePct: number,
): Chosen | null {
  if (typeof packageId !== "string") return null;
  const pkg = packages.find((entry) => entry.id === packageId);
  if (!pkg) return null;
  const chosenLines = linesForPackage(lines, pkg.id);
  return { lineItems: chosenLines, totals: computeTotals(chosenLines, discount, taxRatePct), pkg };
}
