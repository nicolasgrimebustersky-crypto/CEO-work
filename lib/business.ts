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
 * is sampled from the Solid Acre logo rather than chosen. Change both together.
 */
export const BRAND = {
  /** The logo's navy. The header band on paper, behind the white lockup. */
  ink: "#0b2341",
  /** The logo's water blue — the accent rule on paper. */
  accent: "#35b3f2",
  /**
   * The logo's green, sampled from the artwork. On paper this is the darker
   * shade the logo itself uses (6.9:1 on white); the app's screens use a
   * lighter grass green that reads on navy (--color-money in globals.css).
   */
  money: "#42631d",
  /** A pale green for the total box, so it reads on white paper. */
  moneyWash: "#eef4e6",
  /** What sits on the green: white, 6.9:1. */
  onMoney: "#ffffff",
  /** The lockup's lettering on the navy band. */
  cream: "#f5f8fc",
} as const;

/**
 * The one timezone the business works in.
 *
 * Dates a customer picks are compared against "today" here, not in UTC. At
 * 01:00 UTC it is still yesterday evening in Louisville, and a customer tapping
 * today's date in that hour must not be told it is in the past.
 */
/**
 * Psalm 90:17, the line under the Solid Acre logo. Printed at the foot of
 * every estimate and invoice and under the sign-in card, the three places the
 * owner asked for it.
 */
export const BUSINESS_VERSE = {
  text: "May the favor of the Lord our God rest on us; establish the work of our hands.",
  reference: "Psalm 90:17",
} as const;

export const BUSINESS_TIMEZONE = "America/New_York";

export const BUSINESS = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME || "Solid Acre Exteriors LLC",
  tagline:
    process.env.NEXT_PUBLIC_BUSINESS_TAGLINE ||
    "Pressure washing · Landscaping · Snow removal",
  phone: process.env.NEXT_PUBLIC_BUSINESS_PHONE || "",
  email: process.env.NEXT_PUBLIC_BUSINESS_EMAIL || "",
  address: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS || "Oldham County, Kentucky",
  /**
   * Printed on every estimate and invoice. A customer holding a quote three
   * weeks later looks for the website before they look for the phone number,
   * and it is the cheapest possible way to make the document check out.
   */
  website: process.env.NEXT_PUBLIC_BUSINESS_WEBSITE || "grimebusterskyllc.com",
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
