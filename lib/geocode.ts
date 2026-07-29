import type { LatLng } from "./types";

/**
 * Reverse geocode a dropped pin to a street address. Returns an empty string
 * rather than throwing — a pin with no address is still a useful pin, and a
 * failed lookup should never block saving one at a front door.
 */
export async function reverseGeocode(
  geocoder: google.maps.Geocoder,
  position: LatLng,
): Promise<string> {
  try {
    const { results } = await geocoder.geocode({ location: position });
    if (results.length === 0) return "";

    // Prefer a precise street address over the neighbourhood/city fallbacks
    // that the Geocoding API returns further down the list.
    const streetAddress =
      results.find((r) => r.types.includes("street_address")) ??
      results.find((r) => r.types.includes("premise")) ??
      results[0];

    return shortenAddress(streetAddress.formatted_address);
  } catch {
    return "";
  }
}

/**
 * Address -> coordinates, for placing records that arrived without a pin.
 *
 * Bounded to Kentucky and biased to Oldham County, because the export is full
 * of partial addresses like "Chapel View" or "Polo Fields, Louisville KY" that
 * would otherwise match a street of the same name in another state. A wrong
 * pin is worse than no pin: it sends someone to the wrong house.
 */
export async function forwardGeocode(
  geocoder: google.maps.Geocoder,
  address: string,
): Promise<LatLng | null> {
  const query = address.trim();
  if (!query) return null;

  try {
    const { results } = await geocoder.geocode({
      address: /\bKY\b|kentucky/i.test(query) ? query : `${query}, KY`,
      componentRestrictions: { country: "US", administrativeArea: "KY" },
    });
    if (results.length === 0) return null;

    const best = results[0];
    // APPROXIMATE means Google matched a city or postcode rather than the
    // building. That is a pin in the middle of a town, which looks like a
    // located customer and is not one.
    const precision = best.geometry.location_type;
    if (precision === "APPROXIMATE") return null;

    const { lat, lng } = best.geometry.location.toJSON();
    return { lat, lng };
  } catch {
    return null;
  }
}

/** "123 Main St, La Grange, KY 40031, USA" -> "123 Main St, La Grange, KY 40031" */
function shortenAddress(formatted: string): string {
  return formatted.replace(/,\s*USA$/, "");
}

/** Best-effort ZIP extraction, used by the SMS blast filters and reports. */
export function zipFromAddress(address: string): string | null {
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : null;
}
