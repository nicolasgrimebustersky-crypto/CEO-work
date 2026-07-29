"use client";

import type { LatLng } from "@/lib/types";

/**
 * Device capabilities, web only.
 *
 * The app is installed from the browser via Add to Home Screen rather than an
 * app store, so everything here goes through standard web APIs. An earlier
 * revision wrapped these in Capacitor plugins for a native build; that is in
 * git history at 6661bdf if it is ever wanted again.
 */

export type LocationPermission = "granted" | "denied" | "prompt" | "unknown";

export interface LocationFix {
  position: LatLng;
  accuracy: number | null;
}

export interface LocationWatcher {
  stop: () => void;
}

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 20_000,
};

/** Current permission state, without prompting. */
export async function checkLocationPermission(): Promise<LocationPermission> {
  if (typeof navigator === "undefined" || !navigator.permissions) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state as LocationPermission;
  } catch {
    // Safari only gained Permissions API support for geolocation recently;
    // "unknown" is honest and the UI treats it as "we'll find out when asked".
    return "unknown";
  }
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

/**
 * Watches position.
 *
 * Note the limit this carries: iOS suspends a web app's timers and geolocation
 * when it is backgrounded, so the dot stops updating once the phone locks. An
 * installed home-screen app resumes promptly when reopened, which is enough for
 * "where is my partner right now" — but it is not true background tracking, and
 * the UI is honest about a stale fix rather than pretending otherwise.
 */
export function watchLocation(
  onFix: (fix: LocationFix) => void,
  onError: (message: string) => void,
): LocationWatcher {
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

/** A short buzz. Android honours it; iOS Safari ignores vibrate entirely. */
export function impact(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.(15);
  }
}

/** True when running as an installed home-screen app rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari predates the display-mode media query and uses this instead.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
