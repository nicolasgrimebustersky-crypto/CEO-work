"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";

import { readableInkOn } from "@/lib/userColor";
import type { LatLng } from "@/lib/types";

/**
 * A person, drawn as a dot — deliberately a different shape from the teardrop
 * customer pins so a glance tells you whether you're looking at a house or a
 * teammate. The halo pulses only for a live fix; a stale one goes flat and
 * dimmed so you don't chase a position from twenty minutes ago.
 */
export function TeammateDot({
  position,
  name,
  color,
  isMe,
  stale,
}: {
  position: LatLng;
  name: string;
  color: string;
  isMe: boolean;
  stale: boolean;
}) {
  return (
    <AdvancedMarker position={position} zIndex={isMe ? 12 : 11} title={name}>
      <div className="relative flex flex-col items-center">
        <div className="relative flex size-11 items-center justify-center">
          {!stale ? (
            <span
              className="absolute size-5 rounded-full"
              style={{ backgroundColor: color, animation: "gb-pulse 2s ease-out infinite" }}
            />
          ) : null}
          <span
            className="relative size-5 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.9)]"
            style={{ backgroundColor: color, opacity: stale ? 0.55 : 1 }}
          />
        </div>
        <span
          className="-mt-1 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap shadow-[0_1px_4px_rgba(0,0,0,0.9)]"
          style={{
            backgroundColor: color,
            color: readableInkOn(color),
            opacity: stale ? 0.7 : 1,
          }}
        >
          {isMe ? "You" : name}
        </span>
      </div>
    </AdvancedMarker>
  );
}
