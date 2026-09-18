import { FieldValue } from "firebase-admin/firestore";

import { claimMatches } from "@/lib/portalMatch";
import { adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { preflight, withCors } from "@/lib/server/cors";
import { portalError, requirePortalIdentity } from "@/lib/server/portalAuth";
import { consumeRateLimit, PORTAL_CLAIM_LIMIT } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Linking an account to records we hold under a different phone or email.
 *
 * The case this exists for: somebody signs in with the number on their new
 * handset, or an email we never had, and the portal finds nothing. Rather than
 * making them ring the office, they prove they are holding one of their own
 * documents and we attach the identity they just verified to that customer.
 *
 * What makes that safe is NOT the document number. Numbers continue a sequence
 * — if EST-1042 is yours, EST-1041 is your neighbour's — so a claim on the
 * number alone would let somebody walk the sequence and attach themselves to
 * strangers' records. The total is the second half, and it is the half that
 * matters: printed on the same page, not derivable from the number, and not
 * something a script counting downwards can produce.
 *
 * Three further limits, none incidental:
 *
 *   1. Ten attempts a day per signed-in account. A customer linking their own
 *      record needs two or three; a script needs thousands. Making a fresh
 *      account to reset the counter costs an SMS verification each time.
 *   2. The same generic answer for "no such document" and "wrong total". A
 *      claim that distinguished them would confirm which numbers exist, which
 *      is exactly the oracle the sequence makes dangerous.
 *   3. Every attempt is written to the audit log, successful or not. A burst of
 *      failures against sequential numbers is the signature of the attack this
 *      is built against, and it should be visible after the fact.
 */

const REFUSED =
  "That estimate or invoice number and total don't match anything. Check both against " +
  "your copy — or call (502) 599-6855 and we'll link it for you.";

export async function POST(request: Request): Promise<Response> {
  try {
    const { uid, identity } = await requirePortalIdentity(request);

    try {
      await consumeRateLimit(uid, "portal_claim", PORTAL_CLAIM_LIMIT);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(429, "Too many attempts. Please try again tomorrow, or call us.");
    }

    const body = (await request.json().catch(() => null)) as
      | { number?: unknown; total?: unknown }
      | null;
    const number = typeof body?.number === "string" ? body.number : "";

    // Accepts "420.15" or "$420.15" — somebody copying off a printed document
    // includes the dollar sign about half the time. Parsed strictly: an empty
    // or non-numeric total must NOT fall through as 0, because a zero-total
    // document would then be claimable on the guessable number alone, which is
    // the whole attack this endpoint is shaped against.
    const rawTotal = typeof body?.total === "number" ? String(body.total) : String(body?.total ?? "");
    const cleanedTotal = rawTotal.replace(/[^0-9.]/g, "");
    const total = cleanedTotal === "" ? Number.NaN : Number(cleanedTotal);

    if (!number.trim() || !Number.isFinite(total) || total <= 0) {
      throw new ApiError(400, "Enter the number and the total from your estimate or invoice.");
    }

    // Stored numbers are bare digits — nextNumber() returns String(n), printed
    // as "#8904". Customers copy what they see, so "#8904", "8904" and even
    // "EST 8904" all have to find it. claimMatches normalises both sides, but
    // the Firestore query below cannot: it is an exact string match, so the
    // lookup key has to be built in the stored shape rather than passed
    // through verbatim.
    const lookup = number.replace(/\D/g, "");
    if (!lookup) {
      throw new ApiError(400, "Enter the number and the total from your estimate or invoice.");
    }

    const db = adminDb();
    // Matched on the stored number, which is indexed and exact. The claim check
    // below is what decides; this only narrows.
    const snap = await db
      .collection("documents")
      .where("number", "==", lookup)
      .limit(5)
      .get();

    const hit = snap.docs.find((doc) =>
      claimMatches(
        { number, total },
        { number: String(doc.get("number") ?? ""), total: Number(doc.get("total") ?? Number.NaN) },
      ),
    );

    if (!hit) {
      await audit({
        action: "portal.claim",
        actorUid: uid,
        target: number.trim(),
        ok: false,
        detail: "no match",
        request,
      });
      // Deliberately the same answer whether the number is unknown or the total
      // is wrong. Telling them apart confirms which numbers exist.
      throw new ApiError(404, REFUSED);
    }

    const customerId = String(hit.get("customerId") ?? "");
    if (!customerId) throw new ApiError(409, REFUSED);

    // Attach only what is missing. Overwriting a phone or email already on the
    // record would let a claim quietly redirect an existing customer's portal
    // access to somebody else — the claim proves they hold the document, not
    // that they are the only person who should reach the account.
    const customerRef = db.collection("customers").doc(customerId);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) throw new ApiError(409, REFUSED);

    const patch: Record<string, unknown> = {};
    // Both fields are checked, not just the normalised one. A record written
    // before phoneE164 existed — or by the Meta lead webhook — has a real phone
    // and an empty phoneE164, and treating that as "no phone on file" would
    // attach the claimant's number to a customer who already has one, quietly
    // redirecting the real customer's portal access to them.
    const hasPhone =
      String(customerSnap.get("phoneE164") ?? "").trim() || String(customerSnap.get("phone") ?? "").trim();
    if (identity.phone && !hasPhone) {
      patch.phoneE164 = identity.phone;
      patch.phone = identity.phone;
    }
    if (identity.email && !String(customerSnap.get("email") ?? "").trim()) {
      patch.email = identity.email;
    }

    if (Object.keys(patch).length === 0) {
      // Their proof is good, but the record already carries a different phone
      // and email. That is a person question, not a code one.
      await audit({
        action: "portal.claim",
        actorUid: uid,
        target: customerId,
        ok: false,
        detail: "record already has contact details",
        request,
      });
      throw new ApiError(
        409,
        "That document is already linked to a different phone or email. Call (502) 599-6855 " +
          "and we'll sort it out.",
      );
    }

    patch.updatedAt = FieldValue.serverTimestamp();
    patch.updatedBy = "portal-claim";
    patch.updatedByName = "Customer portal";
    await customerRef.update(patch);

    await audit({
      action: "portal.claim",
      actorUid: uid,
      target: customerId,
      ok: true,
      detail: `linked via ${String(hit.get("number") ?? "")}`,
      request,
    });

    return withCors(request, { ok: true, linked: Object.keys(patch).filter((k) => k !== "updatedAt") });
  } catch (error) {
    return portalError(request, error);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
