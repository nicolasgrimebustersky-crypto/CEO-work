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
export const BUSINESS = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME || "Grime Busters KY LLC",
  tagline:
    process.env.NEXT_PUBLIC_BUSINESS_TAGLINE ||
    "Pressure washing · Landscaping · Snow removal",
  phone: process.env.NEXT_PUBLIC_BUSINESS_PHONE || "",
  email: process.env.NEXT_PUBLIC_BUSINESS_EMAIL || "",
  address: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS || "Oldham County, Kentucky",
  /** Printed under the totals — payment instructions, licence number, whatever. */
  footer:
    process.env.NEXT_PUBLIC_BUSINESS_FOOTER ||
    "Thank you for your business. Payment is due on receipt unless agreed otherwise.",
} as const;
