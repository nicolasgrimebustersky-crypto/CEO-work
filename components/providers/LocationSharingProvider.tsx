"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { setUserActive } from "@/lib/db/users";
import {
  checkLocationPermission,
  type LocationPermission,
} from "@/lib/device/capabilities";
import { useAuth } from "./AuthProvider";

const STORAGE_KEY = "gb:location-sharing";

interface LocationSharingContextValue {
  /** Whether this device is broadcasting its position to the other phone. */
  sharing: boolean;
  setSharing: (next: boolean) => void;
  permission: LocationPermission;
  /** Asks iOS for location access. No-op on the web. */
  requestPermission: () => Promise<LocationPermission>;
  /** True until the stored preference has been read. */
  loading: boolean;
}

const LocationSharingContext = createContext<LocationSharingContextValue | null>(null);

/**
 * Owns the "share my location" switch.
 *
 * Kept out of the user document on purpose: this is a per-device decision. If
 * it lived in Firestore, turning it off on a phone that had been left at the
 * shop would also turn it off on the one out knocking doors.
 */
export function LocationSharingProvider({ children }: { children: ReactNode }) {
  const { status, author } = useAuth();
  const [sharing, setSharingState] = useState(false);
  const [permission, setPermission] = useState<LocationPermission>("unknown");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Defaults to on: seeing each other is the point of the app, and the OS
    // permission prompt is still the real gate.
    setSharingState(stored === null ? true : stored === "true");
    setLoading(false);

    void checkLocationPermission().then(setPermission);
  }, []);

  const setSharing = useCallback(
    (next: boolean) => {
      setSharingState(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      }
      if (author) void setUserActive(author.uid, next).catch(() => {});
    },
    [author],
  );

  const requestPermission = useCallback(async () => {
    // The browser has no "ask now" API — the prompt appears when
    // watchPosition first runs. This just re-reads the current state.
    const result = await checkLocationPermission();
    setPermission(result);
    return result;
  }, []);

  // Clear the flag on the way out so a signed-out phone isn't shown as live.
  useEffect(() => {
    if (status === "signed-out" && author) {
      void setUserActive(author.uid, false).catch(() => {});
    }
  }, [status, author]);

  const value = useMemo<LocationSharingContextValue>(
    () => ({ sharing, setSharing, permission, requestPermission, loading }),
    [sharing, setSharing, permission, requestPermission, loading],
  );

  return (
    <LocationSharingContext.Provider value={value}>
      {children}
    </LocationSharingContext.Provider>
  );
}

export function useLocationSharing(): LocationSharingContextValue {
  const ctx = useContext(LocationSharingContext);
  if (!ctx) {
    return {
      sharing: false,
      setSharing: () => {},
      permission: "unknown",
      requestPermission: async () => "unknown",
      loading: true,
    };
  }
  return ctx;
}
