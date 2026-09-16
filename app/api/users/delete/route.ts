import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { adminAuth, adminDb } from "@/lib/server/admin";
import { audit } from "@/lib/server/audit";
import { corsHeaders } from "@/lib/server/cors";
import { isAdmin, isBootstrapCrew } from "@/lib/auth/roles";
import { COLLECTIONS } from "@/lib/firebase";

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
        detail: "not admin",
        request,
      });
      throw new ApiError(403, "Only the admin can delete accounts.");
    }

    const body = (await request.json()) as unknown;
    const uid = typeof (body as { uid?: unknown })?.uid === "string" ? (body as { uid: string }).uid : null;

    if (!uid) throw new ApiError(400, "Missing uid.");

    if (isBootstrapCrew(uid)) {
      throw new ApiError(400, "Cannot delete owner accounts.");
    }

    await adminDb().collection(COLLECTIONS.users).doc(uid).delete();
    await adminAuth().deleteUser(uid);

    await audit({
      action: "admin.user.deleted",
      actorUid: caller.uid,
      ok: true,
      detail: uid,
      request,
    });

    return Response.json(
      { ok: true },
      { status: 200, headers: corsHeaders(request) },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
