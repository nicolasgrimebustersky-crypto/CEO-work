import { Suspense } from "react";

import { CustomerDetailScreen } from "@/components/customers/CustomerDetailScreen";
import { Spinner } from "@/components/ui/Spinner";

/**
 * `/customers/detail?id=<customerId>` rather than `/customers/[id]`.
 *
 * The iOS build is a static export, and a dynamic path segment would need
 * every customer id at build time — ids that get created at a front door long
 * after the build. One static page reading a query param works on the web and
 * on device alike. See lib/routes.ts.
 */
export default function CustomerDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner label="Loading…" />
        </div>
      }
    >
      <CustomerDetailScreen />
    </Suspense>
  );
}
