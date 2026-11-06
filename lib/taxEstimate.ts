/**
 * Roughly how much tax a year's profit will owe, so it can be set aside.
 *
 * An estimate for putting money away, not a tax return. It assumes the
 * business is the owner's only income, a sole owner (a single-member LLC
 * files the same way), and the standard deduction. A second job, a spouse's
 * income, dependants or itemising all move the real figure; the screen says
 * so beside the number.
 *
 * Three taxes, all on profit (money in minus expenses):
 *   - Self-employment tax: Social Security and Medicare, the 15.3% an
 *     employer and employee would split, paid in full by the owner. On 92.35%
 *     of profit; Social Security stops at the year's wage base.
 *   - Federal income tax: the brackets, after half the self-employment tax,
 *     the standard deduction and the 20% qualified business income deduction.
 *   - Kentucky income tax: a flat rate after the state standard deduction.
 *     Kentucky does not allow the QBI deduction.
 *
 * Figures are 2026's (IRS Rev. Proc. 2025-32, SSA, Kentucky DOR). Every year
 * needs a new row in TAX_YEARS; a year without one uses the latest row and the
 * screen says so.
 *
 * Free of imports so the arithmetic is tested by calling it.
 */

export type FilingStatus = "single" | "joint";

export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  single: "Single",
  joint: "Married, filing jointly",
};

interface Bracket {
  /** Upper edge of this bracket's taxable income; Infinity for the last. */
  upTo: number;
  rate: number;
}

export interface TaxYear {
  year: number;
  standardDeduction: Record<FilingStatus, number>;
  brackets: Record<FilingStatus, Bracket[]>;
  socialSecurityWageBase: number;
  /** Additional 0.9% Medicare above this much self-employment income. */
  additionalMedicareThreshold: Record<FilingStatus, number>;
  kentuckyRate: number;
  kentuckyStandardDeduction: number;
}

export const TAX_YEARS: Record<number, TaxYear> = {
  2026: {
    year: 2026,
    standardDeduction: { single: 16_100, joint: 32_200 },
    brackets: {
      single: [
        { upTo: 12_400, rate: 0.1 },
        { upTo: 50_400, rate: 0.12 },
        { upTo: 105_700, rate: 0.22 },
        { upTo: 201_775, rate: 0.24 },
        { upTo: 256_225, rate: 0.32 },
        { upTo: 640_600, rate: 0.35 },
        { upTo: Infinity, rate: 0.37 },
      ],
      joint: [
        { upTo: 24_800, rate: 0.1 },
        { upTo: 100_800, rate: 0.12 },
        { upTo: 211_400, rate: 0.22 },
        { upTo: 403_550, rate: 0.24 },
        { upTo: 512_450, rate: 0.32 },
        { upTo: 768_700, rate: 0.35 },
        { upTo: Infinity, rate: 0.37 },
      ],
    },
    socialSecurityWageBase: 184_500,
    additionalMedicareThreshold: { single: 200_000, joint: 250_000 },
    kentuckyRate: 0.035,
    kentuckyStandardDeduction: 3_360,
  },
};

/** The figures for `year`, or the latest known year's when there are none yet. */
export function taxYearFor(year: number): { figures: TaxYear; exact: boolean } {
  if (TAX_YEARS[year]) return { figures: TAX_YEARS[year], exact: true };
  const known = Object.keys(TAX_YEARS).map(Number).sort((a, b) => a - b);
  const fallback = known.filter((y) => y <= year).pop() ?? known[0];
  return { figures: TAX_YEARS[fallback], exact: false };
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function bracketTax(taxable: number, brackets: readonly Bracket[]): number {
  let tax = 0;
  let floor = 0;
  for (const { upTo, rate } of brackets) {
    if (taxable <= floor) break;
    tax += (Math.min(taxable, upTo) - floor) * rate;
    floor = upTo;
  }
  return tax;
}

export interface TaxEstimate {
  profit: number;
  selfEmploymentTax: number;
  federalIncomeTax: number;
  kentuckyIncomeTax: number;
  /** City or county occupational tax, at the rate given (0 when none). */
  localTax: number;
  total: number;
  /** Total as a share of profit, for "set aside about X%". 0 when no profit. */
  effectiveRate: number;
}

export function estimateTax(
  profit: number,
  options: { year: number; filing: FilingStatus; localRate?: number },
): TaxEstimate {
  const { figures } = taxYearFor(options.year);
  const filing = options.filing;
  const net = Number.isFinite(profit) ? Math.max(0, profit) : 0;

  // Self-employment tax. Under $400 of net earnings there is none.
  const seBase = net * 0.9235;
  let selfEmploymentTax = 0;
  let deductibleHalf = 0;
  if (seBase >= 400) {
    const socialSecurity = 0.124 * Math.min(seBase, figures.socialSecurityWageBase);
    const medicare = 0.029 * seBase;
    const additional = 0.009 * Math.max(0, seBase - figures.additionalMedicareThreshold[filing]);
    selfEmploymentTax = socialSecurity + medicare + additional;
    // The additional Medicare tax is not part of the deductible half.
    deductibleHalf = (socialSecurity + medicare) / 2;
  }

  // Federal income tax.
  const agi = Math.max(0, net - deductibleHalf);
  const beforeQbi = Math.max(0, agi - figures.standardDeduction[filing]);
  const qbi = 0.2 * Math.min(agi, beforeQbi);
  const taxable = Math.max(0, beforeQbi - qbi);
  const federalIncomeTax = bracketTax(taxable, figures.brackets[filing]);

  // Kentucky: flat, on federal AGI less its own standard deduction.
  const kentuckyIncomeTax =
    figures.kentuckyRate * Math.max(0, agi - figures.kentuckyStandardDeduction);

  const localRate =
    Number.isFinite(options.localRate) && (options.localRate ?? 0) > 0
      ? Math.min(options.localRate ?? 0, 0.1)
      : 0;
  const localTax = net * localRate;

  const parts = {
    selfEmploymentTax: round2(selfEmploymentTax),
    federalIncomeTax: round2(federalIncomeTax),
    kentuckyIncomeTax: round2(kentuckyIncomeTax),
    localTax: round2(localTax),
  };
  // The total is the sum of the rounded lines, so the screen's lines add up to it.
  const total = round2(
    parts.selfEmploymentTax + parts.federalIncomeTax + parts.kentuckyIncomeTax + parts.localTax,
  );
  return {
    profit: round2(net),
    ...parts,
    total,
    effectiveRate: net > 0 ? total / net : 0,
  };
}

/**
 * A year-to-date figure carried on to 31 December at the pace so far.
 *
 * Seasonal work makes this rough in spring (seasonal outdoor work earns most of its
 * year by October), so the screen shows it beside the year-to-date figure,
 * never instead of it. Past years come back unchanged.
 */
export function atYearPace(soFar: number, year: number, now: Date = new Date()): number {
  if (now.getFullYear() !== year) return soFar;
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const elapsed = Math.max(1, now.getTime() - start);
  return round2((soFar * (end - start)) / elapsed);
}

/**
 * The next federal estimated-payment deadline on or after `now`: 15 April,
 * 15 June, 15 September, then 15 January of the next year for the last
 * quarter. Weekends and holidays push the real date a little; this does not.
 */
export function nextEstimatedPaymentDue(now: Date = new Date()): { date: Date; quarter: 1 | 2 | 3 | 4; taxYear: number } {
  const y = now.getFullYear();
  const today = new Date(y, now.getMonth(), now.getDate()).getTime();
  const candidates: { date: Date; quarter: 1 | 2 | 3 | 4; taxYear: number }[] = [
    { date: new Date(y, 0, 15), quarter: 4, taxYear: y - 1 },
    { date: new Date(y, 3, 15), quarter: 1, taxYear: y },
    { date: new Date(y, 5, 15), quarter: 2, taxYear: y },
    { date: new Date(y, 8, 15), quarter: 3, taxYear: y },
    { date: new Date(y + 1, 0, 15), quarter: 4, taxYear: y },
  ];
  return candidates.find((c) => c.date.getTime() >= today) ?? candidates[candidates.length - 1];
}
