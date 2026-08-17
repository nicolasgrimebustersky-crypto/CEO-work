import { Suspense } from "react";

import { ChatScreen } from "@/components/chat/ChatScreen";

export default function ChatPage() {
  return (
    <Suspense>
      <ChatScreen />
    </Suspense>
  );
}
