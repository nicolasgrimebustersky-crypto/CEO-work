/**
 * The residential/commercial contract, in one place and free of Firebase
 * imports so it can be tested by running it.
 *
 * The rule the whole feature rests on is one sentence: a residential customer
 * has exactly one address, and a commercial customer has that one plus as many
 * more as they have sites. Everything here exists to make that true no matter
 * which way a record arrives — typed in today, imported last year, or written
 * before the field existed at all.
 */

import type { CustomerLocation, PropertyType } from "./types";

/**
 * The same list as PROPERTY_TYPES in lib/types.ts, written out again because
 * this module is imported by a plain `node --test` run, where only type
 * imports are erased — a value import of ./types would not resolve.
 *
 * The duplication cannot drift: `satisfies` rejects a value that is not a
 * property type, and `exhaustive` below stops compiling the moment a third one
 * is added to lib/types.ts without being added here.
 */
const KNOWN = ["residential", "commercial"] as const satisfies readonly PropertyType[];
const exhaustive: (typeof KNOWN)[number] = "residential" as PropertyType;
void exhaustive;

/**
 * A stored property type, or the reading that changes nothing: residential.
 *
 * Every record written before this field existed comes back here, and they are
 * overwhelmingly houses. Guessing "commercial" for them would invent a second
 * address slot on thousands of records that have one front door.
 */
export function asPropertyType(value: unknown): PropertyType {
  return KNOWN.includes(value as PropertyType) ? (value as PropertyType) : "residential";
}

/**
 * The extra sites, keeping every row that names a place.
 *
 * A written address is the whole requirement; coordinates fall back to 0,0
 * rather than dropping the row. An address nobody could geocode is still an
 * address somebody has to drive to, and lib/maps.ts already navigates to
 * written text when there is no fix — so the degraded case is a working
 * directions link, not a lost site.
 */
export function asLocations(value: unknown): CustomerLocation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { address, lat, lng } = entry as Record<string, unknown>;
    if (typeof address !== "string" || !address.trim()) return [];
    return [
      {
        address: address.trim(),
        lat: typeof lat === "number" && Number.isFinite(lat) ? lat : 0,
        lng: typeof lng === "number" && Number.isFinite(lng) ? lng : 0,
      },
    ];
  });
}

/**
 * The pair of fields as they go to the database.
 *
 * Residential clears its sites rather than merely hiding them. Keeping them
 * around invisibly is the worse bug of the two: they come back the moment
 * somebody flips the type again, and by then nobody can say whether they were
 * meant to still be there.
 */
export function propertyFields(
  propertyType: PropertyType,
  addresses: readonly CustomerLocation[],
): { propertyType: PropertyType; addresses: CustomerLocation[] } {
  if (propertyType !== "commercial") return { propertyType, addresses: [] };
  return { propertyType, addresses: asLocations(addresses) };
}
