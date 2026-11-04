import { errorResponse, requireCrew, ApiError } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { adminDb } from "@/lib/server/admin";
import { applyVenmoPayment, VENMO_COLLECTION } from "@/lib/server/venmo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

/**
 * A crew member matching a Venmo payment by hand: "that $45 was Larry's 10/31
 * cut". Or dismissing one that is not for any bill ("ignore").
 *
 * Goes through the server rather than writing from the phone so a hand match
 * takes the same transaction as an automatic one (lib/server/venmo.ts): the
 * bill is re-read, a bill already paid is refused, and the same payment can
 * never land on two bills. A payment that failed Venmo's signature check can
 * still be matched, because the person matching it is looking at their own
 * Venmo app — but only on purpose, with `confirmUnverified`.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request);
    const body = (await request.json().catch(() => ({}))) as {
      paymentId?: unknown;
      kind?: unknown;
      billId?: unknown;
      ignore?: unknown;
      confirmUnverified?: unknown;
    };
    const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
    if (!paymentId) throw new ApiError(400, "paymentId is required.");

    const ref = adminDb().collection(VENMO_COLLECTION).doc(paymentId);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, "That Venmo payment is not on record.");
    const data = snap.data() ?? {};
    if (data.status === "applied") throw new ApiError(409, "That Venmo payment is already applied.");

    if (body.ignore === true) {
      await ref.update({ status: "ignored", appliedBy: caller.uid, appliedByName: caller.displayName });
      return withCors(request, { ok: true });
    }

    const kind = body.kind === "invoice" || body.kind === "job" ? body.kind : null;
    const billId = typeof body.billId === "string" ? body.billId : "";
    if (!kind || !billId) throw new ApiError(400, "kind and billId are required.");
    if (data.verified !== true && body.confirmUnverified !== true) {
      throw new ApiError(409, "This email failed Venmo's signature check. Confirm in your Venmo app that the payment is real first.");
    }

    const result = await applyVenmoPayment(
      paymentId,
      { payerName: String(data.payerName ?? ""), amount: Number(data.amount ?? 0), note: String(data.note ?? "") },
      { kind, id: billId },
      data.receivedAt,
      { uid: caller.uid, name: caller.displayName },
    );
    if (!result.applied) throw new ApiError(409, result.problem);
    return withCors(request, { ok: true });
  } catch (error) {
    return errorResponse(error, request);
  }
}
