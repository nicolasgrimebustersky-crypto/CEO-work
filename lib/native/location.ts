"use client";

import { Geolocation, type Position } from "@capacitor/geolocation";

import type { LatLng } from "@/lib/types";
import { hasPlugin, isNative } from "./platform";

export type LocationPermission = "granted" | "denied" | "prompt" | "unknown";

export interface LocationFix {
  position: LatLng;
  accuracy: number | null;
}

export interface LocationWatcher {
  stop: () => void;
}

const WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 20_000,
};

/**
 * Current permission state, without prompting.
 *
 * iOS distinguishes "while using the app" from "always". The crew need
 * *always* for the dots to keep updating with the phone in a pocket between
 * houses, but the app is fully usable on "while using" — so this reports
 * granted for either and the UI nudges separately.
 */
export async function checkLocationPermission(): Promise<LocationPermission> {
  if (!isNative() || !hasPlugin("Geolocation")) {
    if (typeof navigator === "undefined" || !navigator.permissions) return "unknown";
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      return status.state as LocationPermission;
    } catch {
      return "unknown";
    }
  }

  try {
    const status = await Geolocation.checkPermissions();
    if (status.location === "granted" || status.coarseLocation === "granted") {
      return "granted";
    }
    return status.location === "denied" ? "denied" : "prompt";
  } catch {
    return "unknown";
  }
}

/**
 * Prompts for location. iOS only ever shows this dialog once per install, so
 * the app primes it with an explanation first — see LocationPrimer.
 */
export async function requestLocationPermission(): Promise<LocationPermission> {
  if (!isNative() || !hasPlugin("Geolocation")) return "unknown";
  try {
    const status = await Geolocation.requestPermissions({ permissions: ["location"] });
    return status.location === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Watches position, using the native plugin on device and the browser API
 * everywhere else.
 *
 * The native path is what makes background tracking possible at all: a web
 * `watchPosition` stops the moment iOS suspends the webview, which on a phone
 * in a pocket is within seconds. With the location background mode declared,
 * the plugin keeps delivering fixes, which is the whole point of the feature —
 * a dot that freezes when the phone locks tells you nothing.
 */
export function watchLocation(
  onFix: (fix: LocationFix) => void,
  onError: (message: string) => void,
): LocationWatcher {
  if (isNative() && hasPlugin("Geolocation")) {
    let watchId: string | null = null;
    let cancelled = false;

    void Geolocation.watchPosition(WATCH_OPTIONS, (position: Position | null, err) => {
      if (cancelled) return;
      if (err) {
        onError(err.message || "Location unavailable.");
        return;
      }
      if (!position) return;
      onFix({
        position: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        },
        accuracy: position.coords.accuracy ?? null,
      });
    })
      .then((id) => {
        if (cancelled) {
          void Geolocation.clearWatch({ id });
          return;
        }
        watchId = id;
      })
      .catch((err: unknown) => {
        onError(err instanceof Error ? err.message : "Could not start location.");
      });

    return {
      stop: () => {
        cancelled = true;
        if (watchId) void Geolocation.clearWatch({ id: watchId });
      },
    };
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onError("This device doesn't support location.");
    return { stop: () => {} };
  }

  const id = navigator.geolocation.watchPosition(
    (fix) => {
      onFix({
        position: { lat: fix.coords.latitude, lng: fix.coords.longitude },
        accuracy: fix.coords.accuracy,
      });
    },
    (error) => onError(messageForGeolocationError(error)),
    WATCH_OPTIONS,
  );

  return { stop: () => navigator.geolocation.clearWatch(id) };
}

export function messageForGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied. Turn it on in Settings to share your position.";
    case error.POSITION_UNAVAILABLE:
      return "Can't get a GPS fix right now.";
    case error.TIMEOUT:
      return "GPS is taking too long to respond.";
    default:
      return "Location unavailable.";
  }
}
