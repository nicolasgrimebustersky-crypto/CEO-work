import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { adminAuth, adminDb } from "@/lib/server/admin";
import { audit } from "@/lib/server/audit";
import { corsHeaders } from "@/lib/server/cors";
import { isAdmin, isBootstrapCrew } from "@/lib/auth/roles";
import { COLLECTIONS } from "@/lib/firebase";

/**
 * Deleting somebody's account outright: their crew profile and their sign-in.
 *
 * "Remove access" already existed and is the right answer most of the time —
 * it drops the person back to pending, keeps the record of who they were, and
 * is one tap to undo. This is the other answer: the test account, the typo
 * sign-up, the person who is not coming back. Until now that meant opening the
 * Firebase console, which is not a thing to ask of somebody standing in a
 * driveway.
 *
 * Both halves or neither is the goal, and the profile goes first. Deleting the
 * sign-in while leaving the profile behind would leave a crew member in the
 * list who cannot exist; the reverse — profile gone, sign-in live — is
 * recoverable, because signing in again simply creates a fresh pending
 * profile that the admin can delete a second time.
 */
export async function OPTIONS(request: Request) {
  return new Response(null, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const caller = await requireCrew(request);

    if (!isAdmin(caller.email)) {
      await audit({
        action: "auth.denied",
        actorUid: caller.uid,
        ok: false,
        detail: "users.delete: not admin",
        request,
      });
      throw new ApiError(403, "Only the admin can delete accounts.");
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = (body as { uid?: unknown } | null)?.uid;
    const uid = typeof raw === "string" ? raw.trim() : "";
    if (!uid) throw new ApiError(400, "Missing uid.");

    // Two accounts this endpoint will not touch. The bootstrap uids are the
    // owners, allowed by uid in firestore.rules and in CREW_UIDS — deleting
    // one leaves those lists pointing at nothing. And the admin deleting
    // themselves would remove the only account that can undo it.
    if (isBootstrapCrew(uid)) {
      throw new ApiError(400, "Owner accounts cannot be deleted.");
    }
    if (uid === caller.uid) {
      throw new ApiError(400, "You cannot delete your own account.");
    }

    await adminDb().collection(COLLECTIONS.users).doc(uid).delete();

    // A profile can outlive its sign-in — somebody deleted themselves from the
    // account screen, or the auth user was removed in the console. That is
    // exactly the mess this endpoint is for clearing up, so a missing sign-in
    // is a completed delete, not a failure.
    try {
      await adminAuth().deleteUser(uid);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== "auth/user-not-found") throw error;
    }

    await audit({
      action: "admin.user.deleted",
      actorUid: caller.uid,
      target: uid,
      ok: true,
      request,
    });

    return Response.json({ ok: true }, { headers: corsHeaders(request) });
  } catch (error) {
    return errorResponse(error, request);
  }
}
