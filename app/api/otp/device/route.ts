import { daysLeft } from "@/lib/trustedDevice";
import { audit } from "@/lib/server/audit";
import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import { markSessionVerified } from "@/lib/server/otp";
import { consumeRateLimit, TRUSTED_DEVICE_LIMIT } from "@/lib/server/rateLimit";
import {
  listTrustedDevices,
  redeemTrustedDevice,
  revokeAllTrustedDevices,
} from "@/lib/server/trustedDevices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The "remember this device" half of the sign-in code.
 *
 * POST   — present a device token; on success this sign-in counts as verified.
 * GET    — which devices are trusted, for the Account screen.
 * DELETE — untrust all of them.
 *
 * POST is the third route allowed to run before the code has been entered,
 * and the only one added since the feature shipped. It is allowed for the same
 * reason the other two are: it is part of *becoming* verified, so requiring
 * verification first would be circular. What it is not is a way in — the
 * caller must already be signed in as approved crew, which means the password
 * has already been given. A device token replaces the second factor and never
 * the first.
 *
 * GET and DELETE take the ordinary gate. Looking at or tearing down the list
 * of trusted devices is something you do from inside the app, and somebody who
 * has not passed the code has no business doing either.
 */

export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request, { beforeCode: true });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "That did not arrive properly. Try again.");
    }
    const token = (body as { token?: unknown })?.token;

    await consumeRateLimit(caller.uid, "trusted_device", TRUSTED_DEVICE_LIMIT);

    const result = await redeemTrustedDevice(caller.uid, token);
    const who = { actorUid: caller.uid, actorName: caller.displayName, request };

    if (!result.ok) {
      // The real reason goes to the audit log; the caller gets one answer for
      // all of them. Telling somebody holding a token that it is valid for a
      // different account, or that it expired last week, is a fact they did
      // not have and could use.
      await audit({ ...who, action: "device.refused", ok: false, detail: result.reason });
      // Not a 401: that would send the client's retry-with-a-fresh-token path
      // down a road that cannot help, and this is a perfectly well-formed
      // request from a perfectly valid session. It simply does not have a
      // device this account trusts.
      return withCors(request, { ok: false, trusted: false });
    }

    await markSessionVerified(caller.uid, caller.authTime);
    await audit({ ...who, action: "device.trusted", ok: true });
    return withCors(request, { ok: true, trusted: true });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request);
    const now = Date.now();
    const devices = await listTrustedDevices(caller.uid, now);
    return withCors(request, {
      ok: true,
      devices: devices.map((device) => ({
        id: device.id,
        label: device.label,
        daysLeft: daysLeft(device.expiresAtMs, now),
        lastUsedAtMs: device.lastUsedAtMs,
      })),
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request);
    const revoked = await revokeAllTrustedDevices(caller.uid);
    await audit({
      actorUid: caller.uid,
      actorName: caller.displayName,
      request,
      action: "device.revoked",
      ok: true,
      detail: `${revoked}`,
    });
    return withCors(request, { ok: true, revoked });
  } catch (error) {
    return errorResponse(error, request);
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
