import { Timestamp } from "firebase/firestore";

import * as demo from "@/lib/demo/store";
import { COLLECTIONS } from "@/lib/firebase";
import type { AppUser, Customer, Note } from "@/lib/types";

/**
 * What the demo does instead of texting.
 *
 * There is no Twilio account behind the demo and no real phone numbers worth
 * dialling, so nothing leaves the browser. But a demo that silently swallows
 * the message is misleading in the one way that matters: the whole point of
 * the on-site buttons is that the customer gets told something specific, and a
 * walkthrough where nothing appears anywhere cannot show that.
 *
 * So the message is written to the customer's timeline exactly as the real API
 * route writes it — same `sms_out` kind, same verbatim body — and the banner
 * across the top of the app says the data is not real.
 */
export function recordDemoText(customerId: string, body: string): void {
  const customer = demo.get<Customer>(COLLECTIONS.customers, customerId);
  if (!customer) return;

  const author = demo.rows<AppUser>(COLLECTIONS.users)[0];
  const note: Note = {
    id: `demo-sms-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    text: body,
    kind: "sms_out",
    authorUid: author?.uid ?? "demo",
    authorName: author?.displayName ?? "Demo",
    createdAt: Timestamp.now(),
  };

  demo.update(COLLECTIONS.customers, customerId, {
    notes: [...customer.notes, note],
    lastContactedAt: Timestamp.now(),
    lastContactedBy: note.authorUid,
    lastContactedByName: note.authorName,
  });
}
