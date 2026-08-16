import { metersBetween } from "./knock/plan";
import type { LatLng } from "./types";

/** La Grange, KY — used only until the first GPS fix arrives. */
export const OLDHAM_COUNTY_CENTER: LatLng = { lat: 38.4076, lng: -85.3791 };

/** Close enough to read individual houses and driveways on satellite imagery. */
export const DEFAULT_ZOOM = 18;

/**
 * Great-circle distance between two points.
 *
 * The implementation lives in lib/knock/plan.ts, which has to stay free of
 * imports so the route planner can be unit tested by running it. Re-exported
 * here so the rest of the app keeps calling the name it always has, and so
 * there is exactly one haversine to be wrong.
 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  return metersBetween(a, b);
}

export function formatCoords({ lat, lng }: LatLng): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
