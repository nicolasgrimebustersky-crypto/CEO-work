import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "./admin";
import type { NoteKind } from "@/lib/types";

export interface AdminCustomer {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  status: string;
}

export async function getCustomer(customerId: string): Promise<AdminCustomer | null> {
  const snap = await adminDb().collection("customers").doc(customerId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return {
    id: snap.id,
    firstName: typeof data.firstName === "string" ? data.firstName : "",
    lastName: typeof data.lastName === "string" ? data.lastName : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    address: typeof data.address === "string" ? data.address : "",
    status: typeof data.status === "string" ? data.status : "lead",
  };
}

/**
 * Appends to the customer's notes timeline from the server. Every SMS the app
 * sends or receives lands here, stamped with whoever triggered it, so the
 * timeline is a complete record of contact rather than just the manual notes.
 *
 * arrayUnion is safe for this: each note carries a unique id, so two concurrent
 * appends cannot collapse into one the way they could with a read-modify-write.
 */
export async function appendNote(
  customerId: string,
  note: {
    text: string;
    kind: NoteKind;
    authorUid: string;
    authorName: string;
  },
  options: { markContacted?: boolean } = {},
): Promise<void> {
  const patch: Record<string, unknown> = {
    notes: FieldValue.arrayUnion({
      id: crypto.randomUUID(),
      text: note.text,
      kind: note.kind,
      authorUid: note.authorUid,
      authorName: note.authorName,
      createdAt: Timestamp.now(),
    }),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: note.authorUid,
    updatedByName: note.authorName,
  };

  if (options.markContacted !== false) {
    patch.lastContactedAt = FieldValue.serverTimestamp();
    patch.lastContactedBy = note.authorUid;
    patch.lastContactedByName = note.authorName;
  }

  await adminDb().collection("customers").doc(customerId).update(patch);
}

/** Finds a customer by phone number, for matching inbound texts. */
export async function findCustomerByPhone(e164: string): Promise<AdminCustomer | null> {
  const digits = e164.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return null;

  // Numbers are stored however they were typed at the door, so an equality
  // query would miss "(502) 555-0147". Scanning is fine at this scale — a
  // two-person crew's customer list is hundreds of documents, not millions.
  const snap = await adminDb().collection("customers").get();
  for (const doc of snap.docs) {
    const phone = doc.data().phone;
    if (typeof phone !== "string") continue;
    if (phone.replace(/\D/g, "").slice(-10) === digits) {
      const data = doc.data();
      return {
        id: doc.id,
        firstName: typeof data.firstName === "string" ? data.firstName : "",
        lastName: typeof data.lastName === "string" ? data.lastName : "",
        phone,
        address: typeof data.address === "string" ? data.address : "",
        status: typeof data.status === "string" ? data.status : "lead",
      };
    }
  }
  return null;
}
