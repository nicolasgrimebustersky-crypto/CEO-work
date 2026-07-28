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

/** "123 Main St, La Grange, KY 40031, USA" -> "123 Main St, La Grange, KY 40031" */
function shortenAddress(formatted: string): string {
  return formatted.replace(/,\s*USA$/, "");
}

/** Best-effort ZIP extraction, used by the SMS blast filters and reports. */
export function zipFromAddress(address: string): string | null {
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : null;
}
