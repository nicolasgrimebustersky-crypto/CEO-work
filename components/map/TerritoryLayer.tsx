"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useEffect, useRef } from "react";

import { colorForUser, buildUserColorMap, FALLBACK_USER_COLOR } from "@/lib/userColor";
import type { AppUser, LatLng, Territory } from "@/lib/types";

/**
 * Draws territory outlines onto the map.
 *
 * Imperative rather than declarative because google.maps.Polygon is not a React
 * component — @vis.gl gives us the map instance and the polygons are attached
 * to it directly. Every one is removed on cleanup; a polygon left behind after
 * a re-render is invisible to React and stays on the map forever.
 *
 * Each territory is tinted with its owner's colour — the same colour as their
 * map dot and their calendar blocks — so who owns which ground is answered by
 * glancing rather than by tapping. Unclaimed ground is grey, which reads as
 * "nobody has taken this" rather than as somebody's.
 */
export function TerritoryLayer({
  territories,
  users,
  highlightId,
}: {
  territories: Territory[];
  users: AppUser[];
  /** Drawn heavier, for the one being looked at. */
  highlightId?: string | null;
}) {
  const map = useMap();
  const drawn = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (!map) return;

    const colorMap = buildUserColorMap(users);
    const shapes = territories
      .filter((territory) => territory.active && territory.boundary.length >= 3)
      .map((territory) => {
        const owner = territory.assignedTo[0];
        const color = owner ? colorForUser(owner, colorMap) : FALLBACK_USER_COLOR;
        const highlighted = territory.id === highlightId;

        return new google.maps.Polygon({
          paths: territory.boundary,
          map,
          strokeColor: color,
          strokeOpacity: highlighted ? 1 : 0.85,
          strokeWeight: highlighted ? 4 : 2.5,
          // Deliberately faint. This sits on satellite imagery that the crew
          // are reading roofs and driveways off; a solid fill would hide the
          // thing the map is for.
          fillColor: color,
          fillOpacity: highlighted ? 0.22 : 0.12,
          // Pins and the tap-to-drop gesture have to keep working through it.
          clickable: false,
          zIndex: highlighted ? 2 : 1,
        });
      });

    drawn.current = shapes;
    return () => {
      for (const shape of shapes) shape.setMap(null);
      drawn.current = [];
    };
  }, [map, territories, users, highlightId]);

  return null;
}

/**
 * The outline that has been drawn, between letting go and saving.
 *
 * Separate from the layer above because it changes on every gesture and has to
 * redraw instantly; rebuilding every saved territory each time would be
 * wasteful and would flicker.
 *
 * Under three points there is no polygon yet, so it draws as a line — which is
 * also the honest picture of what you have so far.
 */

/**
 * Above this many points the shape came from a freehand drag, and numbering
 * every vertex would bury the map under sixty labels describing a finger's
 * path. Handles are for the handful of corners you placed on purpose.
 */
const MAX_LABELLED_CORNERS = 12;

export function DraftTerritory({ boundary }: { boundary: LatLng[] }) {
  const map = useMap();
  const shape = useRef<google.maps.Polygon | google.maps.Polyline | null>(null);
  const dots = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    if (!map || boundary.length === 0) return;

    const common = {
      map,
      strokeColor: "#00d9ff",
      strokeOpacity: 1,
      strokeWeight: 3,
      clickable: false,
      zIndex: 3,
    };

    shape.current =
      boundary.length >= 3
        ? new google.maps.Polygon({
            ...common,
            paths: boundary,
            fillColor: "#00d9ff",
            fillOpacity: 0.18,
          })
        : new google.maps.Polyline({ ...common, path: boundary });

    // A dot on every corner, so it is obvious which taps registered — on a
    // phone in sunlight a thin cyan line alone is easy to miscount. Only for
    // shapes small enough to have been tapped out one corner at a time.
    const corners =
      boundary.length <= MAX_LABELLED_CORNERS ? boundary : ([] as LatLng[]);
    dots.current = corners.map(
      (point, index) =>
        new google.maps.Marker({
          map,
          position: point,
          zIndex: 4,
          label: {
            text: String(index + 1),
            color: "#00181f",
            fontSize: "11px",
            fontWeight: "700",
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: "#00d9ff",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        }),
    );

    return () => {
      shape.current?.setMap(null);
      shape.current = null;
      for (const dot of dots.current) dot.setMap(null);
      dots.current = [];
    };
  }, [map, boundary]);

  return null;
}
