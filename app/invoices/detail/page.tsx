import { Suspense } from "react";

import { DocumentScreen } from "@/components/documents/DocumentScreen";
import { Spinner } from "@/components/ui/Spinner";

/**
 * `/invoices/detail?id=<documentId>`, or `?new=estimate&customer=<id>` to
 * start a fresh one. Query params rather than path segments for the same
 * reason the customer page uses them — see lib/routes.ts.
 */
export default function DocumentPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner label="Loading…" />
        </div>
      }
    >
      <DocumentScreen />
    </Suspense>
  );
}
