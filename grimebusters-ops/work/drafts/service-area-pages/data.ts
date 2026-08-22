// Drop into: lib/service-areas.ts (or wherever the site keeps shared data)
//
// Source: BRAND.md core service area (La Grange, Crestwood, Pewee Valley,
// Buckner, Goshen) + public ZIP records. No mileage figures — not verified
// to a precision worth publishing, so left out rather than guessed.

export type ServiceArea = {
  slug: string;
  name: string;
  zip: string;
  isCountySeat?: boolean;
  /** One new sentence of local framing, not reused site copy. */
  localNote: string;
};

export const SERVICE_AREAS: ServiceArea[] = [
  {
    slug: "la-grange",
    name: "La Grange",
    zip: "40031",
    isCountySeat: true,
    localNote:
      "As the Oldham County seat, La Grange is home base for a lot of our weekly route — driveways along the historic downtown corridor, siding on the newer subdivisions ringing it.",
  },
  {
    slug: "crestwood",
    name: "Crestwood",
    zip: "40014",
    localNote:
      "Crestwood is where Grime Busters KY started, and it's still where we run the most jobs in a given week — this is our neighborhood, not just a service area on a map.",
  },
  {
    slug: "pewee-valley",
    name: "Pewee Valley",
    zip: "40056",
    localNote:
      "Pewee Valley's older homes and tree-lined lots mean more algae and organic staining on siding and walkways — exactly the soft-wash and correct-chemistry work we specialize in.",
  },
  {
    slug: "buckner",
    name: "Buckner",
    zip: "40010",
    localNote:
      "Buckner's mix of newer builds and larger lots keeps us busy on both ends — fresh driveways that just need routine upkeep, and bigger properties that need a full mulch and bed refresh.",
  },
  {
    slug: "goshen",
    name: "Goshen",
    zip: "40026",
    localNote:
      "Goshen properties tend to run larger, with more exterior square footage and landscaping to maintain — we bring the same pro-grade equipment we use on commercial jobs to handle it in one visit.",
  },
];

export function getServiceArea(slug: string): ServiceArea | undefined {
  return SERVICE_AREAS.find((a) => a.slug === slug);
}
