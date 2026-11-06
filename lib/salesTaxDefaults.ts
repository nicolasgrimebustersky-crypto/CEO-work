import { KENTUCKY_RATE_PCT, type SalesTaxSettings } from "./salesTax";

/**
 * What this deployment does before the owner has saved any sales-tax
 * settings. Tracking is OFF until the business's CPA confirms whether its
 * services are taxable in Kentucky (window cleaning and pressure washing may
 * or may not fall under "janitorial services"). New documents still start at
 * 6% because that is what they already did; the owner can change the rate.
 */
export const SALES_TAX_DEFAULTS: SalesTaxSettings = {
  enabled: false,
  permitNumber: "",
  filingFrequency: "monthly",
  defaultRatePct: KENTUCKY_RATE_PCT,
};
