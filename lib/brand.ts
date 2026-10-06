import type { ServiceType } from "./types";

/**
 * Which business this deployment is.
 *
 * One codebase serves more than one crew. Each runs its own deployment with
 * its own Firebase project, Twilio number and Vercel project — the data never
 * shares a database — and `NEXT_PUBLIC_BRAND` picks which of the profiles
 * below that deployment wears: the name on the login screen, the colours, the
 * logo, the services offered, the wording of the texts a customer receives.
 *
 * A fork would do the same job once and then drift: every fix made to one copy
 * would have to be carried to the other by hand. A profile keeps the whole app
 * shared and makes only the parts that are genuinely different differ.
 *
 * Unset means Grime Busters, so the existing deployment needs no change.
 * Anything unrecognised also means Grime Busters rather than a blank brand —
 * but lib/brandGuard.ts fails the build on a typo, so that fallback is a
 * backstop, not a way to ship one.
 *
 * NEXT_PUBLIC_ because the browser needs it, and Next inlines it at build time:
 * a deployment cannot change brand without a rebuild, which is correct.
 */

export const BRAND_IDS = ["grime-busters", "rda"] as const;
export type BrandId = (typeof BRAND_IDS)[number];

export type BrandProfile = {
  id: BrandId;
  /** The app's own name: the tab title, the installed app, the sign-in email. */
  appName: string;
  /** Under the home-screen icon, and the sender name on a text. */
  shortName: string;
  /** Printed on paper. NEXT_PUBLIC_BUSINESS_NAME overrides it. */
  legalName: string;
  tagline: string;
  /** The meta description and the manifest's. */
  description: string;
  website: string;
  /** Printed on paper when NEXT_PUBLIC_BUSINESS_PHONE is not set. */
  phone: string;
  /** Printed on paper when NEXT_PUBLIC_BUSINESS_ADDRESS is not set. */
  address: string;
  /** Where the customer-facing site lives, for CORS on the public API. */
  siteOrigins: readonly string[];
  logoAlt: string;
  /** Intrinsic size of the brand's logo.png, as scripts/generate-icons.mjs wrote it. */
  logoSize: { width: number; height: number };
  /**
   * Where this brand's icons, logo, splash screens and manifest live under
   * public/. Empty for Grime Busters, whose files predate this and sit at the
   * root; every later brand gets a folder of its own so nothing collides.
   */
  assetBase: string;
  /** The PDF writer's colours. Must match the brand's CSS tokens. */
  colors: {
    ink: string;
    accent: string;
    /** What sits on the accent: the draft pin's glyph, a button's label. */
    accentInk: string;
    money: string;
    moneyWash: string;
    cream: string;
  };
  /** In the order the pickers show them. The first is the default. */
  services: readonly ServiceType[];
  /** One line for the estimate-writing model: who it is writing for. */
  aiBusiness: string;
  /** Example line items the model and the API docs use, in this trade. */
  exampleLineItems: readonly [string, string];
};

const PROFILES: Record<BrandId, BrandProfile> = {
  "grime-busters": {
    id: "grime-busters",
    appName: "Grime Busters CRM",
    shortName: "Grime Busters",
    legalName: "Grime Busters KY LLC",
    tagline: "Pressure washing · Landscaping · Snow removal",
    description:
      "Door-to-door CRM for pressure washing, landscaping and snow removal in Oldham County, KY.",
    website: "grimebusterskyllc.com",
    phone: "",
    address: "Oldham County, Kentucky",
    siteOrigins: ["https://grimebusterskyllc.com", "https://www.grimebusterskyllc.com"],
    logoAlt: "Grime Busters KY — pressure washing",
    logoSize: { width: 420, height: 310 },
    assetBase: "",
    colors: {
      ink: "#050607",
      accent: "#00d9ff",
      accentInk: "#00181f",
      money: "#06a143",
      moneyWash: "#eaf7ef",
      cream: "#f1e3cd",
    },
    services: ["pressure_washing", "landscaping", "snow_removal"],
    aiBusiness:
      "a small pressure-washing, landscaping and snow-removal business in Oldham County, Kentucky",
    exampleLineItems: ["Driveway pressure wash", "Gutter clear-out"],
  },
  rda: {
    id: "rda",
    appName: "RDA Landscape CRM",
    shortName: "RDA Landscape",
    legalName: "RDA Landscape",
    tagline: "Mowing · Landscaping · Aeration · Snow removal · Window cleaning",
    description:
      "CRM for mowing, landscaping, aeration, snow removal and window cleaning.",
    website: "",
    // The number on the logo. The address is left for NEXT_PUBLIC_BUSINESS_ADDRESS.
    phone: "502.881.2021",
    address: "",
    siteOrigins: [],
    logoAlt: "RDA Landscape",
    logoSize: { width: 420, height: 342 },
    assetBase: "/brands/rda",
    /*
     * Sampled from the RDA artwork: a black field, forest-green pines, a grass
     * green swoosh and a gold phone number. The swoosh green itself is 3.55:1
     * on black, too dim for a figure read in sunlight, so money uses the same
     * hue lifted to 6.15:1. Gold is what you tap, so a button and a dollar are
     * never the same colour — the same rule the Grime Busters palette keeps.
     */
    colors: {
      // The artwork's field is true black, not the near-black Grime Busters
      // uses; anything else leaves a faint box round the logo on the PDF band.
      ink: "#000000",
      accent: "#c39a55",
      accentInk: "#1a1206",
      money: "#5a9e33",
      moneyWash: "#eef6e8",
      cream: "#f4efe4",
    },
    services: ["mowing", "landscaping", "aeration", "snow_removal", "window_cleaning"],
    aiBusiness:
      "a small lawn-care and landscaping business: mowing, landscaping, aeration, snow removal and window cleaning",
    exampleLineItems: ["Weekly mow and trim", "Core aeration"],
  },
};

export function asBrandId(value: unknown): BrandId {
  return typeof value === "string" && (BRAND_IDS as readonly string[]).includes(value)
    ? (value as BrandId)
    : "grime-busters";
}

export const BRAND_ID: BrandId = asBrandId(process.env.NEXT_PUBLIC_BRAND);
export const BRAND_PROFILE: BrandProfile = PROFILES[BRAND_ID];

export function brandProfile(id: BrandId): BrandProfile {
  return PROFILES[id];
}

/** What the pickers offer on this deployment. */
export const OFFERED_SERVICES: readonly ServiceType[] = BRAND_PROFILE.services;

/** What a new job, quote or price-book entry starts as, and what a malformed stored value reads as. */
export const DEFAULT_SERVICE: ServiceType = BRAND_PROFILE.services[0];

/** A path under public/, inside this brand's asset folder. */
export function brandAsset(path: string): string {
  return `${BRAND_PROFILE.assetBase}${path.startsWith("/") ? path : `/${path}`}`;
}
