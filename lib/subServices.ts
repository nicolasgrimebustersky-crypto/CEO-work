/**
 * The specific services under each main service, and picking several at once.
 *
 * A job or an estimate used to carry exactly one service — pressure washing,
 * landscaping or snow removal — so "house wash plus fresh mulch" had to be
 * filed as one or the other, and "mulching" did not exist at all. The owner
 * asked for the specific services the business actually sells, and for the
 * ability to pick as many as a visit covers.
 *
 * The list follows the website (grimebusterskyllc.com): each main service's
 * bullet points, the quote tool's surfaces, and the commercial and industrial
 * work. The main three stay the top level because they drive the price book,
 * revenue by service and the security rules; a selection always has at least
 * one, and the first one picked is the record's `serviceType` so every report
 * and rule written before this keeps working unchanged.
 *
 * Pure and import-free so the rules can be tested by calling them.
 */

export const MAIN_SERVICES = ["pressure_washing", "landscaping", "snow_removal"] as const;
export type MainService = (typeof MAIN_SERVICES)[number];

export interface SubService {
  key: string;
  label: string;
  main: MainService;
}

export const SUB_SERVICES: readonly SubService[] = [
  // Pressure washing — residential
  { key: "house_wash", label: "House & siding wash", main: "pressure_washing" },
  { key: "driveway", label: "Driveway & concrete", main: "pressure_washing" },
  { key: "walkway", label: "Sidewalks & walkways", main: "pressure_washing" },
  { key: "deck_patio", label: "Deck & patio", main: "pressure_washing" },
  { key: "fence", label: "Fence", main: "pressure_washing" },
  { key: "roof", label: "Roof soft wash", main: "pressure_washing" },
  { key: "gutters", label: "Gutter cleaning & brightening", main: "pressure_washing" },
  { key: "windows", label: "Window cleaning", main: "pressure_washing" },
  // Pressure washing — commercial and industrial
  { key: "storefront", label: "Storefront & entry", main: "pressure_washing" },
  { key: "parking_lot", label: "Parking lot", main: "pressure_washing" },
  { key: "dumpster_pad", label: "Dumpster pad", main: "pressure_washing" },
  { key: "industrial", label: "Warehouse / industrial", main: "pressure_washing" },
  // Landscaping
  { key: "mulching", label: "Mulching", main: "landscaping" },
  { key: "bed_cleanup", label: "Bed cleanup & edging", main: "landscaping" },
  { key: "weeding", label: "Weeding", main: "landscaping" },
  { key: "leaf_removal", label: "Leaf removal", main: "landscaping" },
  { key: "shrub_trimming", label: "Shrub & hedge trimming", main: "landscaping" },
  { key: "lawn_mowing", label: "Lawn mowing", main: "landscaping" },
  { key: "yard_cleanup", label: "Seasonal yard cleanup", main: "landscaping" },
  { key: "grading", label: "Lot clearing & grading", main: "landscaping" },
  { key: "planting", label: "Planting", main: "landscaping" },
  // Snow removal
  { key: "plowing", label: "Driveway plowing", main: "snow_removal" },
  { key: "shoveling", label: "Walkway shoveling", main: "snow_removal" },
  { key: "salting", label: "Salting & de-icing", main: "snow_removal" },
];

const BY_KEY = new Map(SUB_SERVICES.map((sub) => [sub.key, sub]));

export function subServicesFor(main: MainService): SubService[] {
  return SUB_SERVICES.filter((sub) => sub.main === main);
}

export function subServiceLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? "";
}

export interface ServiceSelection {
  /** The main services picked, in the order picked. Never empty once cleaned. */
  serviceTypes: MainService[];
  /** Specific services, each belonging to one of the picked main services. */
  subServices: string[];
}

function isMain(value: unknown): value is MainService {
  return typeof value === "string" && (MAIN_SERVICES as readonly string[]).includes(value);
}

/**
 * A stored or edited selection, made consistent.
 *
 * Unknown values are dropped, duplicates removed, and a specific service is
 * dropped when its main service is not picked — unticking Landscaping must
 * not leave Mulching behind on the record. When nothing valid is left, the
 * record's single `serviceType` (every record has one) is the selection, which
 * is also how every record saved before this reads.
 */
export function cleanSelection(
  raw: { serviceTypes?: unknown; subServices?: unknown },
  fallback: MainService,
): ServiceSelection {
  const mains: MainService[] = [];
  for (const value of Array.isArray(raw.serviceTypes) ? raw.serviceTypes : []) {
    if (isMain(value) && !mains.includes(value)) mains.push(value);
  }
  if (mains.length === 0) mains.push(isMain(fallback) ? fallback : "pressure_washing");

  const subs: string[] = [];
  for (const value of Array.isArray(raw.subServices) ? raw.subServices : []) {
    if (typeof value !== "string" || subs.includes(value)) continue;
    const sub = BY_KEY.get(value);
    if (sub && mains.includes(sub.main)) subs.push(value);
  }
  return { serviceTypes: mains, subServices: subs };
}

/** Turns a main service on or off. The last one cannot be turned off. */
export function toggleMain(selection: ServiceSelection, main: MainService): ServiceSelection {
  const on = selection.serviceTypes.includes(main);
  if (on && selection.serviceTypes.length === 1) return selection;
  const serviceTypes = on
    ? selection.serviceTypes.filter((value) => value !== main)
    : [...selection.serviceTypes, main];
  return cleanSelection({ serviceTypes, subServices: selection.subServices }, serviceTypes[0]);
}

/** Turns a specific service on or off. */
export function toggleSub(selection: ServiceSelection, key: string): ServiceSelection {
  const subServices = selection.subServices.includes(key)
    ? selection.subServices.filter((value) => value !== key)
    : [...selection.subServices, key];
  return cleanSelection({ ...selection, subServices }, selection.serviceTypes[0]);
}

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The selection in words, for the crew and the customer.
 *
 * The specific services when there are any — "House & siding wash and
 * Mulching" says more than "Pressure washing and Landscaping" — plus any main
 * service picked with nothing specific under it, so nothing chosen goes
 * unsaid. `mainLabel` is passed in so this file stays import-free.
 */
export function describeSelection(
  selection: ServiceSelection,
  mainLabel: (main: MainService) => string,
): string {
  const parts: string[] = [];
  for (const main of selection.serviceTypes) {
    const subs = selection.subServices.filter((key) => BY_KEY.get(key)?.main === main);
    if (subs.length === 0) parts.push(mainLabel(main));
    else parts.push(...subs.map(subServiceLabel));
  }
  return listOf(parts);
}
