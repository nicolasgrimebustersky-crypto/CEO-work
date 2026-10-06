import { BRAND_PROFILE } from "./brand";

/**
 * What goes at the top of a printed estimate or invoice.
 *
 * These are the only values a customer ever sees on paper, so they live in one
 * place rather than being scattered through the print template. Set the env
 * vars in Vercel to change them without a code edit; the fallbacks are what
 * ships if nothing is set.
 *
 * Everything here is public by design — it is printed on a document handed to
 * a stranger — which is why NEXT_PUBLIC_ is the right prefix.
 */
/**
 * Brand colours as literals.
 *
 * The app reads its colours from CSS custom properties, but the PDF writer
 * cannot — it draws into a file, with no stylesheet anywhere near it. These
 * are the same values as the `@theme` block in app/globals.css, and the green
 * is sampled from the logo artwork rather than chosen. Change both together.
 *
 * Per brand — see `colors` in lib/brand.ts:
 *   ink       near-black; the header band, the canvas, the logo's own field
 *   accent    what you tap in the app; the accent rule on paper
 *   money     the logo's green; money, everywhere
 *   moneyWash a pale green for the total box, so it reads on white paper
 *   cream     the banner text in the lockup
 */
export const BRAND = BRAND_PROFILE.colors;

/**
 * The one timezone the business works in.
 *
 * Dates a customer picks are compared against "today" here, not in UTC. At
 * 01:00 UTC it is still yesterday evening in Louisville, and a customer tapping
 * today's date in that hour must not be told it is in the past.
 */
export const BUSINESS_TIMEZONE = "America/New_York";

export const BUSINESS = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME || BRAND_PROFILE.legalName,
  tagline: process.env.NEXT_PUBLIC_BUSINESS_TAGLINE || BRAND_PROFILE.tagline,
  phone: process.env.NEXT_PUBLIC_BUSINESS_PHONE || BRAND_PROFILE.phone,
  email: process.env.NEXT_PUBLIC_BUSINESS_EMAIL || "",
  address: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS || BRAND_PROFILE.address,
  /**
   * Printed on every estimate and invoice. A customer holding a quote three
   * weeks later looks for the website before they look for the phone number,
   * and it is the cheapest possible way to make the document check out.
   */
  website: process.env.NEXT_PUBLIC_BUSINESS_WEBSITE || BRAND_PROFILE.website,
  /** Printed under the totals — payment instructions, licence number, whatever. */
  footer:
    process.env.NEXT_PUBLIC_BUSINESS_FOOTER ||
    "Thank you for your business. Payment is due on receipt unless agreed otherwise.",
  /**
   * The two-letter state this crew works in. Used to bias forward-geocoding
   * of partial addresses — see lib/geocode.ts — toward the right state
   * instead of matching a street of the same name somewhere else in the
   * country. Not printed anywhere; this is the one field on this object that
   * exists for the app's own use rather than for a customer to read.
   */
  serviceAreaState: (process.env.NEXT_PUBLIC_SERVICE_AREA_STATE || "KY").toUpperCase(),
} as const;
