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
 */
export const BRAND = {
  /** Near-black. The header band, the app's canvas, and the logo's own field. */
  ink: "#050607",
  /** Cyan — what you tap in the app, the accent rule on paper. */
  accent: "#00d9ff",
  /** The logo's green, sampled from the artwork. Money, everywhere. */
  money: "#06a143",
  /** A pale green for the total box, so it reads on white paper. */
  moneyWash: "#eaf7ef",
  /** The banner text in the lockup. */
  cream: "#f1e3cd",
} as const;

export const BUSINESS = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME || "Grime Busters KY LLC",
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
} as const;
