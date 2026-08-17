"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { subscribeCustomers } from "@/lib/db/customers";
import type { Customer } from "@/lib/types";
import { friendlyError } from "@/lib/db/errors";
import { useAuth } from "./AuthProvider";

interface CustomersContextValue {
  customers: Customer[];
  byId: Map<string, Customer>;
  loading: boolean;
  error: string | null;
}

const CustomersContext = createContext<CustomersContextValue | null>(null);

/**
 * One realtime listener for the whole app. The map, the list view and the
 * detail page all read from it, so a pin dropped on one phone lands on the
 * other's map without any screen needing to refetch.
 */
export function CustomersProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signed-in") {
      setCustomers([]);
      setLoading(status === "loading");
      return;
    }
    setLoading(true);
    return subscribeCustomers(
      (next) => {
        setCustomers(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(friendlyError(err, "customers"));
        setLoading(false);
      },
    );
  }, [status]);

  const value = useMemo<CustomersContextValue>(
    () => ({
      customers,
      byId: new Map(customers.map((c) => [c.id, c])),
      loading,
      error,
    }),
    [customers, loading, error],
  );

  return (
    <CustomersContext.Provider value={value}>{children}</CustomersContext.Provider>
  );
}

export function useCustomers(): CustomersContextValue {
  const ctx = useContext(CustomersContext);
  if (!ctx) throw new Error("useCustomers must be used inside <CustomersProvider>");
  return ctx;
}
