/**
 * Handing an address off to the phone's own maps app.
 *
 * The app draws its own map for deciding *where* to go. Getting there is a
 * different job, and one the phone already does better than anything that
 * could be built here: turn-by-turn, traffic, CarPlay, a voice. So this is a
 * link out, not a feature.
 *
 * Which app depends on the phone. On an iPhone the built-in Maps is the one
 * with the driver's ear, and sending them to Google Maps means either a web
 * page or an app they may not have installed. Everywhere else, Google Maps is
 * the safe default because it opens as a web page when the app is absent.
 *
 * Free of imports so it can be tested by running it.
 */

export interface Destination {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}

/**
 * Is this an Apple device?
 *
 * iPhone, iPad and Mac all ship Maps, and `maps.apple.com` opens it on every
 * one of them. That makes the check a simple keyword match — and it also
 * quietly handles the awkward case, which is that an iPad on iPadOS 13+
 * reports itself as "Macintosh" and is otherwise indistinguishable from a
 * desktop Mac. Both want Apple Maps, so the ambiguity does not matter.
 *
 * A preference, not a capability: being wrong costs a slightly less familiar
 * map, never a broken link.
 */
export function isApplePlatform(userAgent: string | null | undefined): boolean {
  return /iphone|ipad|ipod|macintosh|mac os x/i.test(userAgent ?? "");
}

/**
 * Coordinates when we have them, the written address when we do not.
 *
 * Coordinates win because they are unambiguous: a pin dropped at the back of a
 * long driveway is exactly where the crew stood, and re-geocoding the street
 * address can land the driver at the wrong end of it. A pin at 0,0 is an
 * un-geocoded import sitting in the Atlantic, so it is treated as no
 * coordinates at all.
 */
function targetFor(destination: Destination): string | null {
  const { lat, lng, address } = destination;
  const hasFix =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0);

  if (hasFix) return `${lat},${lng}`;
  const written = (address ?? "").trim();
  return written ? written : null;
}

/**
 * A link that opens directions in the phone's maps app.
 *
 * Returns null when there is nowhere to go — an un-geocoded pin with no
 * address typed in yet. A button that opens an empty map is worse than no
 * button, so the caller hides it.
 *
 * The Apple form uses `https://maps.apple.com/` rather than the `maps://`
 * scheme: the https link opens the Maps app on an iPhone and still resolves to
 * something usable if the same link is ever opened on a desktop, while
 * `maps://` simply fails there with nothing to show for it.
 */
export function directionsUrl(
  destination: Destination,
  options: { apple?: boolean } = {},
): string | null {
  const target = targetFor(destination);
  if (!target) return null;

  const encoded = encodeURIComponent(target);

  // dirflg=d asks for driving. Without it Apple Maps may open on whichever
  // mode was used last, and a walking route across a county is not useful.
  if (options.apple) return `https://maps.apple.com/?daddr=${encoded}&dirflg=d`;

  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}

/** True when there is somewhere to send them. */
export function canNavigateTo(destination: Destination): boolean {
  return targetFor(destination) !== null;
}
