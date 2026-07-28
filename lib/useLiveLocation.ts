"use client";

import { useEffect, useRef, useState } from "react";

import { setUserActive, updateUserLocation } from "@/lib/db/users";
import { distanceMeters } from "@/lib/geo";
import { watchLocation, type LocationWatcher } from "@/lib/native/location";
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

/**
 * Watches GPS and mirrors it to this user's Firestore document so the other
 * phone can draw the dot. Writes are throttled by both time and distance —
 * watchPosition fires several times a second while walking, and every one of
 * those would otherwise be a billed write plus a snapshot on the other device.
 *
 * `sharing` is the user's own switch. When it is off nothing is watched and
 * nothing is written: no background GPS, no position on the other phone. That
 * is a requirement for shipping background location on the App Store, and it is
 * the right default behaviour anyway — nobody should have to delete the app to
 * stop broadcasting where they are on a Sunday.
 */
export function useLiveLocation(uid: string | null, sharing: boolean): LiveLocation {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const lastWriteAt = useRef(0);
  const lastWritten = useRef<LatLng | null>(null);

  useEffect(() => {
    if (!sharing) {
      setPosition(null);
      setAccuracy(null);
      setError(null);
      setReady(true);
      // Tell the other phone this dot is stale rather than leaving the last
      // known position sitting on their map looking live.
      if (uid) void setUserActive(uid, false).catch(() => {});
      return;
    }

    let watcher: LocationWatcher | null = null;

    watcher = watchLocation(
      ({ position: next, accuracy: nextAccuracy }) => {
        setPosition(next);
        setAccuracy(nextAccuracy);
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
      (message) => {
        setError(message);
        setReady(true);
      },
    );

    return () => watcher?.stop();
  }, [uid, sharing]);

  return { position, accuracy, error, ready };
}
