"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { subscribeTerritories } from "@/lib/db/territories";
import type { Territory } from "@/lib/types";
import { friendlyError } from "@/lib/db/errors";
import { useAuth } from "./AuthProvider";

interface TerritoriesContextValue {
  territories: Territory[];
  byId: Map<string, Territory>;
  loading: boolean;
  error: string | null;
}

const TerritoriesContext = createContext<TerritoriesContextValue | null>(null);

/**
 * One listener for the drawn ground, like every other collection here.
 *
 * The map reads it to draw outlines, the routes screen reads it to build a
 * route from an area, and the quick-entry sheet reads it to say which territory
 * a new pin just landed in — all from the same subscription, so a boundary
 * redrawn on one phone is right everywhere on the other.
 */
export function TerritoriesProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signed-in") {
      setTerritories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeTerritories(
      (next) => {
        setTerritories(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(friendlyError(err, "territories"));
        setLoading(false);
      },
    );
  }, [status]);

  const value = useMemo<TerritoriesContextValue>(
    () => ({
      territories,
      byId: new Map(territories.map((territory) => [territory.id, territory])),
      loading,
      error,
    }),
    [territories, loading, error],
  );

  return (
    <TerritoriesContext.Provider value={value}>{children}</TerritoriesContext.Provider>
  );
}

export function useTerritories(): TerritoriesContextValue {
  const ctx = useContext(TerritoriesContext);
  if (!ctx) return { territories: [], byId: new Map(), loading: false, error: null };
  return ctx;
}
