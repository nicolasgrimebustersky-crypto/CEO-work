"use client";

import { onSnapshot, collection, type Unsubscribe } from "firebase/firestore";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { isDemoMode } from "@/lib/demo/enabled";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { useAuth } from "./AuthProvider";

interface ConnectionContextValue {
  online: boolean;
  /** True while Firestore is still holding writes that haven't reached the server. */
  pendingWrites: boolean;
}

const ConnectionContext = createContext<ConnectionContextValue>({
  online: true,
  pendingWrites: false,
});

/**
 * Surfaces the two facts someone standing in a driveway with one bar actually
 * needs: whether the device has a connection, and whether anything they typed
 * is still sitting in the queue.
 *
 * Firestore's persistent cache already queues writes and replays them on
 * reconnect — this does not implement that, it reports it. `hasPendingWrites`
 * on a snapshot is the SDK telling us a local write has not been acknowledged
 * by the server yet.
 */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [online, setOnline] = useState(true);
  const [pendingWrites, setPendingWrites] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setOnline(navigator.onLine);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    // Demo writes land in memory, so there is never a queue to report.
    if (isDemoMode || status !== "signed-in") {
      setPendingWrites(false);
      return;
    }

    // Watching metadata on the collections that accept offline writes is
    // enough; includeMetadataChanges is what makes the flag update at all.
    const watched = [COLLECTIONS.customers, COLLECTIONS.jobs] as const;
    const pendingByCollection = new Map<string, boolean>();

    const unsubscribes: Unsubscribe[] = watched.map((name) =>
      onSnapshot(
        collection(getDb(), name),
        { includeMetadataChanges: true },
        (snap) => {
          pendingByCollection.set(name, snap.metadata.hasPendingWrites);
          setPendingWrites([...pendingByCollection.values()].some(Boolean));
        },
        () => {
          pendingByCollection.set(name, false);
          setPendingWrites([...pendingByCollection.values()].some(Boolean));
        },
      ),
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [status]);

  const value = useMemo(() => ({ online, pendingWrites }), [online, pendingWrites]);

  return (
    <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionContextValue {
  return useContext(ConnectionContext);
}
