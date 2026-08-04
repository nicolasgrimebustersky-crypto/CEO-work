"use client";

import { Component, type ReactNode } from "react";

/**
 * Keeps a Google Maps failure inside the map.
 *
 * When the API key is rejected, the JS API still loads far enough for the
 * geocoding library to exist, but `google.maps.marker` never arrives — and
 * every pin on this screen is an AdvancedMarker. Ninety-odd of them mount,
 * one throws, and without a boundary the whole route dies: the crew loses the
 * nav bar and every other tab along with the map they could not use anyway.
 *
 * A class component because React error boundaries have no hook equivalent.
 */
export class MapBoundary extends Component<
  { children: ReactNode; fallback: (error: Error) => ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Map failed to render:", error);
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

/**
 * What replaces the map when it cannot render.
 *
 * Names the most likely cause and shows the exact hostname to paste into the
 * key's website restrictions, because that string is the whole fix and typing
 * it from memory is how the last hour got spent.
 */
export function MapUnavailable({ error }: { error: Error }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="max-w-sm">
        <h2 className="text-xl font-extrabold text-ink">The map didn&apos;t load</h2>
        <p className="mt-2 text-base font-semibold text-muted">
          Everything else still works — customers, pipeline, schedule and the
          dashboard don&apos;t need it.
        </p>

        <p className="mt-4 text-base font-semibold text-muted">
          This is almost always the Google Maps key being refused. In Google
          Cloud → Credentials → your Maps key, check that{" "}
          <strong className="text-ink">Maps JavaScript API</strong> is one of the
          allowed APIs, and that the website restrictions include:
        </p>

        <code className="mt-2 block rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm font-semibold break-all text-ink">
          {`${origin}/*`}
        </code>

        <p className="mt-4 text-sm font-semibold text-muted">
          Restriction changes take a few minutes to take effect.
        </p>

        <pre className="mt-4 max-h-32 overflow-auto rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs font-semibold whitespace-pre-wrap text-muted">
          {error.message}
        </pre>
      </div>
    </div>
  );
}
