import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { asOrgId } from "@/lib/org";
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
 * Returns the opt-out from any matching record *in this org*. One STOP is
 * enough; a second record without one is not a retraction.
 *
 * Scoped by org, and the org is required rather than defaulted, because
 * getting this wrong is silent in both directions. Unscoped, a STOP recorded
 * by another business silenced our consented lead permanently — not delayed,
 * silenced, and reported as an ordinary skip nobody would look at twice. An
 * opt-out is a thing somebody told one business; it is not a global flag, and
 * a person who asked one company to stop has not revoked the consent they
 * gave another.
 */
export async function optOutForPhone(
  rawPhone: string,
  orgId: string,
): Promise<SmsOptOut | null> {
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
    // Another business's STOP is not this business's instruction.
    if (asOrgId(data.orgId) !== orgId) continue;
    const optOut = readOptOut(data.smsOptOut);
    if (optOut) return optOut;
  }
  return null;
}

/**
 * Everything on this phone number that says "do not send", across every record
 * that carries it.
 *
 * One scan answering three questions, because a number is not a customer and
 * each of the three has already been got wrong separately. The Meta lead
 * webhook creates a fresh record per form submission rather than matching an
 * existing one, so one handset can sit in the database several times:
 *
 *   an inbound text is matched to one record, so a reply hides on that one;
 *   an opt-out is written to one record, so STOP hides on that one;
 *   do not knock is set by somebody opening one record, so the mark hides on
 *   that one — usually the record that has since moved past `new_lead`,
 *   because moving it on is what you do after you have spoken to someone.
 *
 * Asked immediately before a nurture text goes out, not only when the nightly
 * run starts. The run reads the whole customer collection and then works
 * through it for minutes, and any of these three arriving on a *different*
 * record in that window used to be invisible.
 *
 * One record saying stop is enough. A second record without the mark is not a
 * retraction of the first — within one business. Records belonging to another
 * org are skipped entirely: a number is shared between companies often enough
 * (a landlord, a property manager, a spouse) and neither business's history is
 * the other's to act on.
 */
export interface NumberSuppression {
  /** Somebody on this number has written back. */
  replied: boolean;
  /** A record for this number is marked do_not_knock. */
  blocked: boolean;
  /** A recorded STOP, if there is one. */
  optOut: SmsOptOut | null;
}

export async function numberSuppression(
  rawPhone: string,
  orgId: string,
): Promise<NumberSuppression> {
  const none: NumberSuppression = { replied: false, blocked: false, optOut: null };
  const digits = String(rawPhone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return none;

  // The same full scan as findCustomerByPhone, and for the same reason:
  // numbers are stored however they were typed, so there is nothing to query
  // on. One scan for all three, rather than one each.
  const snap = await adminDb().collection("customers").get();
  const found: NumberSuppression = { ...none };

  for (const doc of snap.docs) {
    const data = doc.data();
    const phone = data.phone;
    if (typeof phone !== "string") continue;
    if (phone.replace(/\D/g, "").slice(-10) !== digits) continue;
    // A different business's record says nothing about this one's customer.
    // Two companies can hold the same number and one of them having been told
    // to stop is not the other's instruction — nor is one's reply a reason to
    // halt the other's sequence.
    if (asOrgId(data.orgId) !== orgId) continue;

    if (data.status === "do_not_knock") found.blocked = true;
    if (!found.optOut) found.optOut = readOptOut(data.smsOptOut);
    if (!found.replied) {
      const notes = Array.isArray(data.notes) ? data.notes : [];
      if (notes.some((note) => note && typeof note === "object" && note.kind === "sms_in")) {
        found.replied = true;
      }
    }
  }

  return found;
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
