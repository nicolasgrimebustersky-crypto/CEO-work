"use client";

import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";

import { distanceMeters } from "./geo";
import type { LatLng } from "./types";

/**
 * Straight-line distance, inflated for the fact that roads are not straight,
 * at a county-road average speed with a minute of parking and unpacking.
 * Rough, but it is always available — including offline — and it is close
 * enough to tell you whether two jobs are ten minutes apart or forty.
 */
const ROAD_WINDING_FACTOR = 1.35;
const AVERAGE_MPH = 32;
const PARKING_MINUTES = 2;

export function estimateDriveMinutes(from: LatLng, to: LatLng): number {
  const meters = distanceMeters(from, to) * ROAD_WINDING_FACTOR;
  const miles = meters / 1609.34;
  return Math.max(1, Math.round((miles / AVERAGE_MPH) * 60) + PARKING_MINUTES);
}

export type DriveTimeSource = "google" | "estimate";

export interface DriveLeg {
  minutes: number;
  source: DriveTimeSource;
}

/** Above this many stops we stay on estimates rather than burn a large matrix call. */
const MAX_MATRIX_STOPS = 10;

/**
 * Drive time between consecutive stops. Returns one leg per gap, so N stops
 * produce N-1 legs.
 *
 * Uses the Distance Matrix API when it is enabled on the key, which accounts
 * for actual roads. That API is optional: if it is not enabled, or the call
 * fails, or the Maps script never loaded, every leg silently falls back to the
 * straight-line estimate rather than showing nothing.
 */
export function useDriveTimes(stops: LatLng[]): DriveLeg[] {
  const routesLib = useMapsLibrary("routes");
  const [googleLegs, setGoogleLegs] = useState<number[] | null>(null);

  // A stable key so the effect doesn't refire on every render of an
  // equivalent array.
  const stopsKey = useMemo(
    () => stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|"),
    [stops],
  );

  const fallback = useMemo<DriveLeg[]>(() => {
    const legs: DriveLeg[] = [];
    for (let i = 1; i < stops.length; i += 1) {
      legs.push({ minutes: estimateDriveMinutes(stops[i - 1], stops[i]), source: "estimate" });
    }
    return legs;
  }, [stops]);

  useEffect(() => {
    setGoogleLegs(null);
    if (!routesLib || stops.length < 2 || stops.length > MAX_MATRIX_STOPS) return;

    let cancelled = false;
    const service = new routesLib.DistanceMatrixService();
    const origins = stops.slice(0, -1);
    const destinations = stops.slice(1);

    service
      .getDistanceMatrix({
        origins,
        destinations,
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL,
      })
      .then((response) => {
        if (cancelled) return;
        // Only the diagonal matters: leg i is origin i to destination i.
        const legs = response.rows.map((row, index) => {
          const element = row.elements[index];
          if (!element || element.status !== "OK" || !element.duration) return null;
          return Math.max(1, Math.round(element.duration.value / 60));
        });
        if (legs.some((leg) => leg === null)) return;
        setGoogleLegs(legs as number[]);
      })
      .catch(() => {
        // Distance Matrix API not enabled, over quota, or offline — the
        // estimate already covers this case.
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesLib, stopsKey]);

  if (!googleLegs || googleLegs.length !== fallback.length) return fallback;
  return googleLegs.map((minutes) => ({ minutes, source: "google" as const }));
}

export function formatDriveMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
