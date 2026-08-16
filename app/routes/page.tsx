import { Suspense } from "react";

import { RoutesScreen } from "@/components/knock/RoutesScreen";

export default function RoutesPage() {
  return (
    <Suspense>
      <RoutesScreen />
    </Suspense>
  );
}
