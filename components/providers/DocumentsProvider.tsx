"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { subscribeDocuments } from "@/lib/db/documents";
import { isOutstanding, type BusinessDocument } from "@/lib/documents";
import { useAuth } from "./AuthProvider";

interface DocumentsContextValue {
  documents: BusinessDocument[];
  byId: Map<string, BusinessDocument>;
  forCustomer: (customerId: string) => BusinessDocument[];
  /** Every dollar still owed across open invoices. */
  outstanding: number;
  loading: boolean;
  error: string | null;
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

/**
 * One realtime listener for every estimate and invoice.
 *
 * A two-person business raises a few hundred documents a year, so holding them
 * all in memory costs nothing and means the customer detail page, the invoice
 * list and the "you are owed" figure all read the same numbers at the same
 * instant. Paginating would save nothing and would let those three disagree.
 */
export function DocumentsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [documents, setDocuments] = useState<BusinessDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signed-in") {
      setDocuments([]);
      setLoading(status === "loading");
      return;
    }
    setLoading(true);
    return subscribeDocuments(
      (next) => {
        setDocuments(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
  }, [status]);

  const value = useMemo<DocumentsContextValue>(() => {
    const byCustomer = new Map<string, BusinessDocument[]>();
    for (const document of documents) {
      const list = byCustomer.get(document.customerId);
      if (list) list.push(document);
      else byCustomer.set(document.customerId, [document]);
    }

    return {
      documents,
      byId: new Map(documents.map((d) => [d.id, d])),
      forCustomer: (customerId: string) => byCustomer.get(customerId) ?? [],
      outstanding: Number(
        documents
          .filter(isOutstanding)
          .reduce((sum, d) => sum + d.balanceDue, 0)
          .toFixed(2),
      ),
      loading,
      error,
    };
  }, [documents, loading, error]);

  return (
    <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>
  );
}

export function useDocuments(): DocumentsContextValue {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error("useDocuments must be used inside <DocumentsProvider>");
  return ctx;
}
