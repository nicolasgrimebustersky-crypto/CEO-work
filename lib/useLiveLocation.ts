"use client";

import { useEffect, useRef, useState } from "react";

import { updateUserLocation } from "@/lib/db/users";
import { distanceMeters } from "@/lib/geo";
import type { LatLng } from "@/lib/types";

/** Don't write more than once every 10s, or for movement under 12m. */
const MIN_WRITE_INTERVAL_MS = 10_000;
const MIN_WRITE_DISTANCE_M = 12;

export interface LiveLocation {
  position: LatLng | null;
  accuracy: number | null;
  error: string | null;
  /** True once the first fix has landed. */
  ready: boolean;
}

function messageForGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied. Enable it in your browser settings to share your position.";
    case error.POSITION_UNAVAILABLE:
      return "Can't get a GPS fix right now.";
    case error.TIMEOUT:
      return "GPS is taking too long to respond.";
    default:
      return "Location unavailable.";
  }
}

/**
 * Watches GPS and mirrors it to this user's Firestore document so the other
 * phone can draw the dot. Writes are throttled by both time and distance —
 * watchPosition fires several times a second while walking, and every one of
 * those would otherwise be a billed write plus a snapshot on the other device.
 */
export function useLiveLocation(uid: string | null): LiveLocation {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const lastWriteAt = useRef(0);
  const lastWritten = useRef<LatLng | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device doesn't support location.");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (fix) => {
        const next: LatLng = {
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
        };
        setPosition(next);
        setAccuracy(fix.coords.accuracy);
        setError(null);
        setReady(true);

        if (!uid) return;

        const now = Date.now();
        const movedFar =
          lastWritten.current === null ||
          distanceMeters(lastWritten.current, next) >= MIN_WRITE_DISTANCE_M;
        const waitedLongEnough = now - lastWriteAt.current >= MIN_WRITE_INTERVAL_MS;

        if (movedFar && waitedLongEnough) {
          lastWriteAt.current = now;
          lastWritten.current = next;
          void updateUserLocation(uid, next.lat, next.lng).catch(() => {
            // Offline: Firestore queues the write and flushes on reconnect.
            // Allow the next fix to retry rather than stranding the throttle.
            lastWriteAt.current = 0;
          });
        }
      },
      (err) => {
        setError(messageForGeolocationError(err));
        setReady(true);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [uid]);

  return { position, accuracy, error, ready };
}
