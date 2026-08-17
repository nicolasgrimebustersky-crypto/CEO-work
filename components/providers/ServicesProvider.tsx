"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { subscribeServices, type SavedService } from "@/lib/db/services";
import { friendlyError } from "@/lib/db/errors";
import { useAuth } from "./AuthProvider";

interface ServicesContextValue {
  services: SavedService[];
  loading: boolean;
  error: string | null;
}

const ServicesContext = createContext<ServicesContextValue | null>(null);

/**
 * The price book, live on both phones.
 *
 * A service saved on one estimate is offered on the other person's next one
 * without either of them doing anything, which is the whole reason it is a
 * shared collection rather than something cached per device.
 */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [services, setServices] = useState<SavedService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signed-in") {
      setServices([]);
      setLoading(status === "loading");
      return;
    }
    setLoading(true);
    return subscribeServices(
      (next) => {
        setServices(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(friendlyError(err, "services"));
        setLoading(false);
      },
    );
  }, [status]);

  const value = useMemo<ServicesContextValue>(
    () => ({ services, loading, error }),
    [services, loading, error],
  );

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): ServicesContextValue {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useServices must be used inside <ServicesProvider>");
  return ctx;
}
