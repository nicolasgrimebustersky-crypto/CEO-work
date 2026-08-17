import { Suspense } from "react";

import { ThreadScreen } from "@/components/chat/ThreadScreen";

export default function ChatThreadPage() {
  return (
    <Suspense>
      <ThreadScreen />
    </Suspense>
  );
}
