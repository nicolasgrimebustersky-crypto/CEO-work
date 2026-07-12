import {
  Home,
  Building2,
  Factory,
  Trees,
  Droplets,
  Sparkles,
  Snowflake,
  type LucideIcon,
} from "lucide-react";

export const BUSINESS = {
  name: "Grime Bustersky",
  shortName: "Grime Busters KY",
  legalName: "Grime Busters KY LLC",
  tagline: "Louisville's Leading Pressure Washing & Landscaping Crew",
  phoneDisplay: "(502) 599-6855",
  phoneHref: "tel:+15025996855",
  hours: "Mon–Sun, 9:00 AM – 7:00 PM",
  area: "Louisville & Oldham County, KY",
  founders: "Nicolas Timmons & Noah Perkins",
} as const;

// Google Analytics 4 Measurement ID (e.g. "G-XXXXXXXXXX").
// Leave empty to disable; set it to turn on analytics on the next deploy.
export const GA_MEASUREMENT_ID = "G-YBKBN0SLCW";

// Web3Forms access key for the quote/booking form (https://web3forms.com).
// Get a free key by entering your email at web3forms.com; paste it here.
// Submissions are emailed to the address tied to this key. Empty = not wired yet.
export const WEB3FORMS_ACCESS_KEY = "3ebdddf5-305e-4020-a742-a6e107ca48e8";

// Clean link to the Google Business listing (read + leave reviews).
export const GOOGLE_REVIEWS_URL = "https://www.google.com/maps?cid=6378439859517805393";

export type TeamMember = { name: string; role: string; photo?: string };

// Co-owners (featured with the dock photo + story).
export const OWNERS: TeamMember[] = [
  { name: "Nicolas Timmons", role: "Co-Owner" },
  { name: "Noah Perkins", role: "Co-Owner" },
];

// The crew. Add a `photo` path (e.g. "/team/yael.jpg") to replace the
// initials avatar with a real headshot.
export const CREW: TeamMember[] = [
  { name: "Yael Acuna", role: "Sales & Outreach" },
  { name: "Ethan Fitzgibbon", role: "Sales & Outreach" },
];

export type Faq = { q: string; a: string };

export const FAQS: Faq[] = [
  {
    q: "What areas do you serve?",
    a: "We're based in Louisville and proudly serve Louisville & Oldham County, KY and the surrounding areas. Not sure if you're in range? Just call or text and ask.",
  },
  {
    q: "What services do you offer?",
    a: "Residential and commercial pressure washing, industrial cleaning, landscaping & mulching, and seasonal snow removal — from driveways and siding to full property cleanups.",
  },
  {
    q: "How much will my job cost?",
    a: "Every property is different, so we give free, no-pressure quotes. Tell us what needs cleaning and we'll get you a fast estimate with no obligation.",
  },
  {
    q: "What can you pressure wash?",
    a: "Driveways, sidewalks, patios, decks, vinyl siding, brick, fences, dumpster pads, storefronts, and more. If it's dirty, we can probably clean it — just ask.",
  },
  {
    q: "How do I get a quote or book?",
    a: 'Use the "Get your free quote" form on this site, or call/text us at (502) 599-6855. We\'ll confirm your spot and bring the shine.',
  },
  {
    q: "What are your hours?",
    a: "We're available Monday through Sunday, 9:00 AM – 7:00 PM.",
  },
  {
    q: "Are you local?",
    a: "100%. Grime Busters KY is locally owned and operated by two Louisville entrepreneurs — when you hire us, you're supporting a local small business.",
  },
];

export type Service = {
  icon: LucideIcon;
  title: string;
  description: string;
  points: string[];
};

export const SERVICES: Service[] = [
  {
    icon: Home,
    title: "Residential Pressure Washing",
    description:
      "Bring back the curb appeal of your home — driveways, sidewalks, decks, patios, and vinyl siding cleaned to look brand new.",
    points: ["Driveways & walkways", "House & siding wash", "Decks & patios"],
  },
  {
    icon: Building2,
    title: "Commercial Power Washing",
    description:
      "Keep your storefront and property spotless and professional, with minimal disruption to your operations.",
    points: ["Storefronts & entries", "Parking lots", "Dumpster pads"],
  },
  {
    icon: Factory,
    title: "Industrial Cleaning",
    description:
      "Heavy-duty cleaning for facilities and warehouses — built for large-scale jobs and tough buildup.",
    points: ["Warehouses", "Equipment & floors", "Large-scale jobs"],
  },
  {
    icon: Trees,
    title: "Landscaping & Mulching",
    description:
      "Finish the transformation with fresh mulch and tidy landscaping that makes the whole property pop.",
    points: ["Fresh mulch install", "Bed cleanup & edging", "Seasonal refresh"],
  },
  {
    icon: Snowflake,
    title: "Snow Removal",
    description:
      "When winter hits Louisville & Oldham County, we keep your driveways and walkways clear, safe, and ice-free.",
    points: ["Driveways & walkways", "Salting & de-icing", "Reliable storm response"],
  },
];

export const STATS = [
  { value: "100%", label: "Satisfaction focused" },
  { value: "7-Day", label: "Availability" },
  { value: "Free", label: "Quotes, always" },
  { value: "Local", label: "Louisville owned" },
];

export const STEPS = [
  {
    icon: Droplets,
    title: "Request a free quote",
    description:
      "Call or book online. Tell us what needs cleaning and we'll give you a fast, no-pressure estimate.",
  },
  {
    icon: Sparkles,
    title: "We bust the grime",
    description:
      "Our crew shows up on time with pro-grade gear and treats your property like our own.",
  },
  {
    icon: Trees,
    title: "Enjoy the transformation",
    description:
      "Step back and admire the curb appeal — and ask about a landscaping refresh to finish it off.",
  },
];

export type Testimonial = { quote: string; author: string; rating?: number };

// Real Google reviews from customers.
export const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "Grime Busters did an excellent job pressure washing our driveway and deck. They were very professional and communicated well with us. They were also reasonably priced. I would definitely recommend.",
    author: "Jacqui Bone",
  },
  {
    quote:
      "Outstanding job pressure washing vinyl siding, brick, and a deck. Prompt, great communication, stress-free experience all around. Thank you!",
    author: "Rebecca Woo",
  },
  {
    quote:
      "I cannot say enough good things about Nicolas and Noah! What a great team and fine young men they are! Their work ethic and communication is above and beyond. They have laid rock/edging all around our house, power washed, cleaned up leaves several times and more. I would HIGHLY recommend! Please give them a call or text. You will not be disappointed.",
    author: "Kim Nestor",
  },
  {
    quote:
      "Grime Busters did a good job pressure washing our sidewalk, driveway, deck, and siding. Pricing was reasonable.",
    author: "Robert Mattingly",
  },
  {
    quote:
      "Our driveway, patio, porch and sidewalks looked brand new. They even pressure washed our retaining wall and deck boards!",
    author: "Lance Perkins",
  },
  {
    quote:
      "They were very communicative, transparent with pricing, and worked diligently to complete the work.",
    author: "LaDonna Keddedy",
  },
  {
    quote:
      "Grime Busters did 3 houses for us including gutter cleaning, some concrete foundation, and a retaining wall. They did a great job making things look great. They are very professional when quoting and talking with the customer, and kept me informed about what they were doing and their next steps. I'll also give them a lot of credit — when they originally gave the quote they said they would be out the next day to start. I saw the weather was going to be cold and windy with snow flurries, so I texted that morning to see if they were still coming, and they said they were on the way. Very dedicated company. I would definitely recommend them for any of your pressure washing services. Thank you all for an amazing job.",
    author: "Donnie Webster",
  },
  {
    quote:
      "Grime Busters knocked it out of the park. They pressure washed our driveway and sidewalk, making them look brand new. Reasonably priced and detailed. Thanks Grime Busters!",
    author: "Hayden Shawler",
  },
  {
    quote:
      "We hired Nicolas and Noah of Grime Busters to remove the annual fall leaves and they did a great job with our entire yard. They had the right equipment and a great attitude to get the job done! I'd recommend you call them soon, before the winter begins!",
    author: "Jeremy Christ",
  },
  {
    quote: "A responsible, reliable, and professionally run company.",
    author: "Christine McCloy",
  },
  {
    quote:
      "The owners communicated well, were careful and detailed. I'd use them again.",
    author: "Andrew T.",
  },
  {
    quote:
      "The Grime Busters were amazing — very professional and very skilled at their task. They pressure washed and sealed my driveway and it looks fantastic. I will be having them come again!!",
    author: "Jack Meade",
  },
  {
    quote:
      "Grime Busters did a great job on my driveway and patio. Definitely recommend them.",
    author: "jjandk W.",
  },
  {
    quote:
      "Nicolas is a hard worker. He shows up on time and does a great job.",
    author: "Judith Grazette",
    rating: 4,
  },
];

export type Pair = {
  before: string;
  after: string;
  title: string;
};

// Real, correctly-matched before/after job pairs (customer-provided photos).
export const PAIRS: Pair[] = [
  {
    before: "/pairs/p1-before.jpg",
    after: "/pairs/p1-after.jpg",
    title: "Foundation bed cleared, re-mulched & drainage tidied up",
  },
  {
    before: "/pairs/p2-before.jpg",
    after: "/pairs/p2-after.jpg",
    title: "Overgrown bed around the tree, fully refreshed",
  },
  {
    before: "/pairs/p3-before.jpg",
    after: "/pairs/p3-after.jpg",
    title: "Weedy slope reborn with stepping stones & fresh mulch",
  },
  {
    before: "/pairs/p4-before.jpg",
    after: "/pairs/p4-after.jpg",
    title: "Whole lot cleared, graded, and finished clean",
  },
];

// ─── Instant AI Quote tool ───────────────────────────────────────────────
// PRESSURE WASHING pricing is Grime Busters' real rate (per Nic, 7/12/26):
//   $0.20 per square foot, $200 job minimum.
// LANDSCAPING/MULCHING uses Louisville-area industry rates (researched from
//   HomeGuide/Angi/GreenPal, 2026: ~$0.35–$0.70/sq ft installed) — adjust anytime.
// The tool always shows "ballpark, confirmed on-site."
export type QuoteService = {
  id: string;
  label: string;
  ratePerSqftLow: number;
  ratePerSqftHigh: number;
  minimum: number;
  /** Manual fallback sizes when the customer doesn't upload a photo. */
  sizes: { label: string; sqft: number }[];
};

const PW = { ratePerSqftLow: 0.2, ratePerSqftHigh: 0.2, minimum: 200 };

export const QUOTE_SERVICES: QuoteService[] = [
  {
    id: "driveway",
    label: "Driveway / Concrete",
    ...PW,
    sizes: [
      { label: "1-car driveway", sqft: 300 },
      { label: "2-car driveway", sqft: 600 },
      { label: "3-car driveway", sqft: 900 },
      { label: "Large / long driveway", sqft: 1400 },
    ],
  },
  {
    id: "deck",
    label: "Deck / Patio",
    ...PW,
    sizes: [
      { label: "Small (up to 200 sq ft)", sqft: 200 },
      { label: "Medium (~350 sq ft)", sqft: 350 },
      { label: "Large (~600 sq ft)", sqft: 600 },
    ],
  },
  {
    id: "siding",
    label: "House Siding / Exterior",
    ...PW,
    sizes: [
      { label: "1-story home", sqft: 1200 },
      { label: "2-story home", sqft: 2200 },
      { label: "Large 2-story +", sqft: 3000 },
    ],
  },
  {
    id: "sidewalk",
    label: "Sidewalk / Walkway",
    ...PW,
    sizes: [
      { label: "Short walkway", sqft: 100 },
      { label: "Standard walkway", sqft: 200 },
      { label: "Long / wraparound", sqft: 400 },
    ],
  },
  {
    id: "mulch",
    label: "Mulching / Bed Refresh",
    ratePerSqftLow: 0.35,
    ratePerSqftHigh: 0.7,
    minimum: 150,
    sizes: [
      { label: "Small beds (~150 sq ft)", sqft: 150 },
      { label: "Front yard beds (~300 sq ft)", sqft: 300 },
      { label: "Front + back beds (~600 sq ft)", sqft: 600 },
      { label: "Large property (~1,000 sq ft)", sqft: 1000 },
    ],
  },
];

const round5 = (n: number) => Math.round(n / 5) * 5;

/** Price range from a square-footage range (pass the same value twice for a single size). */
export function quotePriceRange(service: QuoteService, sqftLow: number, sqftHigh: number) {
  const low = Math.max(service.minimum, round5(sqftLow * service.ratePerSqftLow));
  const high = Math.max(low, round5(sqftHigh * service.ratePerSqftHigh));
  return { low, high };
}
