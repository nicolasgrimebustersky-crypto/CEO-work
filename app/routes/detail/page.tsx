import { Suspense } from "react";

import { RouteScreen } from "@/components/knock/RouteScreen";

export default function RouteDetailPage() {
  return (
    <Suspense>
      <RouteScreen />
    </Suspense>
  );
}
