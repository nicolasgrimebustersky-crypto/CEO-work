"use client";

import { useEffect, useState } from "react";

import { canNavigateTo, directionsUrl, isApplePlatform, type Destination } from "@/lib/maps";

/**
 * A link that hands an address to the phone's own maps app.
 *
 * The app draws its own map for deciding where to go; getting there is a job
 * the phone already does better — turn-by-turn, traffic, CarPlay, a voice. So
 * this leaves the app rather than trying to compete with it.
 *
 * The platform is read in an effect rather than during render because the
 * server has no user agent, and guessing one would make the first paint
 * disagree with what the browser then decides. Google is the pre-hydration
 * default: it opens as a web page anywhere, so the worst case for a link
 * tapped in that first instant is a familiar map rather than a dead scheme.
 *
 * Renders nothing when there is nowhere to go. A button that opens an empty
 * map is worse than no button.
 */
export function NavigateLink({
  destination,
  children,
  className,
  label,
}: {
  destination: Destination;
  children?: React.ReactNode;
  className?: string;
  /** Screen-reader name, when the visible text is just an address. */
  label?: string;
}) {
  const [apple, setApple] = useState(false);

  useEffect(() => {
    setApple(isApplePlatform(navigator.userAgent));
  }, []);

  if (!canNavigateTo(destination)) return null;
  const href = directionsUrl(destination, { apple });
  if (!href) return null;

  return (
    <a
      href={href}
      // Out of the app entirely. `noreferrer` keeps the customer's address out
      // of a referrer header on the way to a third party.
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={className}
    >
      {children ?? "Navigate"}
    </a>
  );
}
