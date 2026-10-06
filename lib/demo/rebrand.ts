import type { ServiceType } from "@/lib/types";

/**
 * The demo dataset, read as another brand's business.
 *
 * lib/demo/fixtures.ts is written as Grime Busters: Nick, house washes, a
 * pressure-washing price book. Showing that to a lawn-care crew under their own
 * logo would be showing them somebody else's business. Rather than keep a
 * second 1,300-line dataset in step with the first — same customers, same
 * dates, same pipeline shape — this rewrites the words and the services in
 * place and leaves everything structural alone.
 *
 * Only plain objects and arrays are walked, so Timestamps and other class
 * instances pass through untouched.
 */

export interface DemoRebrand {
  /** Whole-string swaps: names, line items, notes. */
  exact: Record<string, string>;
  /** A service a brand does not offer, read as one it does. */
  services: Partial<Record<ServiceType, ServiceType>>;
  /** Substring swaps applied after `exact`, for phrases inside longer text. */
  phrases: [string, string][];
  /**
   * A price-book entry's service, by its rewritten name — where the blanket
   * `services` swap would file "Core aeration" under mowing.
   */
  serviceByName: Record<string, ServiceType>;
}

export const RDA_DEMO: DemoRebrand = {
  services: { pressure_washing: "mowing" },
  exact: {
    Nick: "Ryland",

    // Customer notes and texts.
    "Driveway and back patio done. Paid by card on the spot.":
      "Mowed, edged and blown off front and back. Paid by card on the spot.",
    "Siding and walkway finished. Invoice left in the door.":
      "Spring aeration and overseed finished. Invoice left in the door.",
    "Hi Alice, your estimate for the siding and walkway is $380. Reply STOP to opt out.":
      "Hi Alice, your estimate for aeration and overseeding is $380. Reply STOP to opt out.",
    "Interested in the driveway. Wants a price by the weekend.":
      "Wants weekly mowing through October. Wants a price by the weekend.",
    "Enquiry from a Facebook/Instagram lead form.\nEmail: tom.hargrove@example.com\nwhich service do you need: Driveway and sidewalk wash":
      "Enquiry from a Facebook/Instagram lead form.\nEmail: tom.hargrove@example.com\nwhich service do you need: Weekly mowing",
    "Big lots, most of them have a driveway worth washing.":
      "Big lots, most of them are paying somebody to mow.",
    "$50 off for booking the driveway at the same time.":
      "$50 off for booking the window cleaning at the same time.",

    // Price book.
    "House wash": "Weekly mow and trim",
    "Soft wash of all siding, soffits and gutter faces. No pressure on the siding.":
      "Mow, string-trim, edge the drive and walks, blow off hard surfaces. Clippings mulched.",
    "Driveway and walk": "Core aeration",
    "Surface-cleaned and rinsed, front walk included. Oil stains lightened, not guaranteed removed.":
      "Whole lawn, two passes. Sprinkler heads flagged first. Cores left to break down.",
    "Gutter brightening": "Window cleaning, exterior",
    "Removes the black tiger stripes on the gutter faces. Exteriors only.":
      "All ground-floor and second-storey glass, outside only. Screens wiped.",
    "Roof soft wash": "Aeration and overseed",
    "Low-pressure treatment for moss and black streaking. Shingle-safe.":
      "Core aeration followed by tall fescue overseed at the full rate.",

    // Invoice and estimate lines.
    "House wash, two storey": "Weekly mowing, full season",
    "Soft wash of all four elevations including soffits and gutter faces. No pressure on the siding.":
      "Mow, trim and edge every week from April through October, clippings mulched.",
    "Soft wash of all siding, soffits and gutter faces.":
      "Mow, string-trim and edge, hard surfaces blown off.",
    "Back patio and steps": "Window cleaning",
    "Stamped concrete, surface-cleaned and rinsed.": "Exterior glass, both floors, screens wiped.",
    "Soft wash, all elevations.": "Mow, trim and edge.",
    "Surface-cleaned and rinsed.": "Whole lawn, two passes.",
    "Roof wash": "Aeration and overseed",
    "Soft wash, asphalt shingle.": "Core aeration, tall fescue overseed.",
    "Fence wash": "Fall cleanup",
    "Both sides, 180 feet.": "Leaves cleared from lawn and beds, hauled away.",
  },
  phrases: [["Pressure washing", "Mowing"]],
  serviceByName: {
    "Core aeration": "aeration",
    "Aeration and overseed": "aeration",
    "Window cleaning, exterior": "window_cleaning",
  },
};

function rewrite(text: string, rebrand: DemoRebrand): string {
  let out = rebrand.exact[text] ?? text;
  for (const [from, to] of rebrand.phrases) out = out.split(from).join(to);
  return out;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Rewrites every string in the list, in place. */
export function rebrandInPlace(list: unknown[], rebrand: DemoRebrand): void {
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      const service = rebrand.services[value as ServiceType];
      return service ?? rewrite(value, rebrand);
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) value[i] = visit(value[i]);
      return value;
    }
    if (isPlain(value)) {
      for (const key of Object.keys(value)) value[key] = visit(value[key]);
      const byName = typeof value.name === "string" ? rebrand.serviceByName[value.name] : undefined;
      if (byName && "serviceType" in value) value.serviceType = byName;
    }
    return value;
  };
  visit(list);
}
