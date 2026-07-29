import { Suspense } from "react";

import { MapScreen } from "@/components/map/MapScreen";
import { Spinner } from "@/components/ui/Spinner";

export default function MapPage() {
  return (
    // MapScreen reads ?focus= via useSearchParams, which needs a Suspense
    // boundary to keep the rest of the route statically renderable.
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner label="Loading map…" />
        </div>
      }
    >
      <MapScreen />
    </Suspense>
  );
}
