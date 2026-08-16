"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { subscribeKnockRoutes } from "@/lib/db/knockRoutes";
import type { KnockRoute } from "@/lib/types";
import { useAuth } from "./AuthProvider";

interface KnockRoutesContextValue {
  routes: KnockRoute[];
  byId: Map<string, KnockRoute>;
  loading: boolean;
  error: string | null;
}

const KnockRoutesContext = createContext<KnockRoutesContextValue | null>(null);

/**
 * One listener for every door-knocking route, like every other collection in
 * this app. That is what makes a route reassigned on one phone appear on the
 * other's list without either of them refetching — which matters more here than
 * anywhere else, because two people walking the same street is the exact waste
 * this feature exists to stop.
 */
export function KnockRoutesProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [routes, setRoutes] = useState<KnockRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signed-in") {
      setRoutes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeKnockRoutes(
      (next) => {
        setRoutes(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
  }, [status]);

  const value = useMemo<KnockRoutesContextValue>(
    () => ({
      routes,
      byId: new Map(routes.map((route) => [route.id, route])),
      loading,
      error,
    }),
    [routes, loading, error],
  );

  return (
    <KnockRoutesContext.Provider value={value}>{children}</KnockRoutesContext.Provider>
  );
}

export function useKnockRoutes(): KnockRoutesContextValue {
  const ctx = useContext(KnockRoutesContext);
  if (!ctx) return { routes: [], byId: new Map(), loading: false, error: null };
  return ctx;
}
