import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "./admin";
import type { SmsConsent, SmsOptOut } from "@/lib/smsConsent";
import type { NoteKind } from "@/lib/types";

export interface AdminCustomer {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  status: string;
  /** Read back so the send path can refuse before it reaches Twilio. */
  smsConsent?: SmsConsent | null;
  smsOptOut?: SmsOptOut | null;
}

/**
 * Reads a stored consent record back, or null.
 *
 * Deliberately strict about shape. A half-written record — `granted` missing,
 * or a number where a string belongs — must not be read as consent, because
 * the failure is silent and the consequence is texting somebody who never
 * agreed. Anything that is not plainly a consent record is nothing.
 */
function readConsent(value: unknown): SmsConsent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.granted !== "boolean") return null;
  const method = raw.method;
  if (method !== "verbal" && method !== "web_form" && method !== "written") return null;
  return {
    granted: raw.granted,
    method,
    at: typeof raw.at === "string" ? raw.at : "",
    byUid: typeof raw.byUid === "string" ? raw.byUid : "",
    byName: typeof raw.byName === "string" ? raw.byName : "",
  };
}

/**
 * Reads a stored opt-out back, or null.
 *
 * Errs the other way from readConsent, and for the same reason: where a
 * malformed consent must not be read as permission, a malformed opt-out must
 * still be read as an opt-out. The field being present at all is somebody
 * having said stop; a missing timestamp is a data problem, not a retraction.
 */
function readOptOut(value: unknown): SmsOptOut | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    at: typeof raw.at === "string" ? raw.at : "",
    keyword: typeof raw.keyword === "string" ? raw.keyword : "",
  };
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
    smsConsent: readConsent(data.smsConsent),
    smsOptOut: readOptOut(data.smsOptOut),
  };
}

/**
 * Flags a customer as having opted out, or clears it when they text START.
 *
 * Written from the inbound webhook, which is the only place that learns of it.
 * Null deletes the field rather than storing a false-y marker: "there is no
 * opt-out" and "there is an opt-out that says no" are different states, and a
 * stored empty object would read as the second.
 */
export async function setSmsOptOut(
  customerId: string,
  optOut: SmsOptOut | null,
): Promise<void> {
  await adminDb()
    .collection("customers")
    .doc(customerId)
    .update({
      smsOptOut: optOut ?? FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
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

/**
 * Any recorded opt-out for this number, across every record that carries it.
 *
 * Needed because a number is not a customer. The Meta lead webhook creates a
 * fresh record for every form submission rather than matching an existing one,
 * so somebody who replied STOP last spring and fills in an ad form today
 * arrives as a brand-new document with no opt-out on it — and a consent check
 * that reads only that document says yes.
 *
 * Twilio still refuses to deliver to a number that opted out, so the message
 * would not arrive either way. What this changes is that the app knows: the
 * timeline says "they asked us to stop" rather than "sent", which is the
 * difference between a record and a lie.
 *
 * Returns the opt-out from any matching record. One STOP is enough; a second
 * record without one is not a retraction.
 */
export async function optOutForPhone(rawPhone: string): Promise<SmsOptOut | null> {
  const digits = String(rawPhone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return null;

  // The same full scan as findCustomerByPhone, and for the same reason:
  // numbers are stored however they were typed, so there is nothing to query
  // on. Hundreds of documents, once per inbound lead.
  const snap = await adminDb().collection("customers").get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const phone = data.phone;
    if (typeof phone !== "string") continue;
    if (phone.replace(/\D/g, "").slice(-10) !== digits) continue;
    const optOut = readOptOut(data.smsOptOut);
    if (optOut) return optOut;
  }
  return null;
}

/**
 * Has anybody on this number ever written back, on any record?
 *
 * The companion to optOutForPhone, and needed for the same reason: a number is
 * not a customer. An inbound text is matched to one record by
 * findCustomerByPhone, so the reply lands on that document and the duplicates
 * for the same handset still look like somebody who has never answered.
 *
 * Asked immediately before a nurture text goes out, not only when the nightly
 * run starts. A run reads the whole customer collection and then spends
 * minutes working through it, and a reply arriving on a *different* record for
 * the same number in that window used to be invisible — so the automation
 * would text somebody who had just answered, which is the single worst thing
 * it can do.
 *
 * One reply is enough, and a second record without one is not a retraction.
 */
export async function hasReplyForPhone(rawPhone: string): Promise<boolean> {
  const digits = String(rawPhone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return false;

  // The same full scan as optOutForPhone, and for the same reason: numbers are
  // stored however they were typed, so there is nothing to query on.
  const snap = await adminDb().collection("customers").get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const phone = data.phone;
    if (typeof phone !== "string") continue;
    if (phone.replace(/\D/g, "").slice(-10) !== digits) continue;
    const notes = Array.isArray(data.notes) ? data.notes : [];
    if (notes.some((note) => note && typeof note === "object" && note.kind === "sms_in")) {
      return true;
    }
  }
  return false;
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
        // Read here as well as in getCustomer, and not decoration: the caller
        // that matched a number is the inbound webhook and anything replying
        // to it, and canSendTo reads these two fields. Leaving them undefined
        // on a record that has an opt-out makes the check answer "allowed" —
        // a refusal that silently becomes a permission, which is the worst
        // shape this particular bug can take.
        smsConsent: readConsent(data.smsConsent),
        smsOptOut: readOptOut(data.smsOptOut),
      };
    }
  }
  return null;
}
