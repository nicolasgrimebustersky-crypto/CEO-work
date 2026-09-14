import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb, isAdminConfigured } from "./admin";

/**
 * The audit log: what the server did, for whom, and whether it worked.
 *
 * Until this existed, the only record of a server-side action was the data it
 * changed — and a `console.error` when it failed. That is enough to see what
 * happened; it is not enough to see what was *attempted*. A hundred wrong
 * sign-in codes leave no trace on any document. A stolen API key used to read
 * the whole book leaves only `lastUsedAt`. This collection is the trace.
 *
 * Written only by the Admin SDK. No client can write it (there is no rule
 * that allows it), and only the admin with a verified session can read it
 * (see firestore.rules). That is what makes it an audit log rather than a
 * notebook: the people it records cannot edit it.
 *
 * Never throws. Every caller has already done its real work by the time this
 * runs, and a logging failure must not undo a text that was sent or a code
 * that was verified.
 */

export type AuditAction =
  | "auth.denied"
  | "otp.sent"
  | "otp.verified"
  | "otp.wrong"
  | "otp.locked"
  | "sms.sent"
  | "sms.blast"
  | "sms.test"
  | "estimate.drafted"
  | "push.sent"
  | "mcp.call"
  | "mcp.denied"
  | "quote.answered";

export interface AuditEntry {
  action: AuditAction;
  /** Who did it: a crew uid, an API key id, "customer", or null when unknown. */
  actorUid: string | null;
  actorName?: string;
  /** What it was done to — a customer id, a document id, a tool name. */
  target?: string | null;
  ok: boolean;
  /** One line. Never a secret, never a code, never a message body. */
  detail?: string;
  /** Where the request came from, when the caller has a Request in hand. */
  request?: Request;
}

/** The client's address and agent, as far as the edge reports them. */
function requestMeta(request: Request | undefined): { ip: string | null; ua: string | null } {
  if (!request) return { ip: null, ua: null };
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  const ua = request.headers.get("user-agent");
  return { ip, ua: ua ? ua.slice(0, 200) : null };
}

export async function audit(entry: AuditEntry): Promise<void> {
  if (!isAdminConfigured) return;
  try {
    await adminDb()
      .collection("auditLog")
      .add({
        action: entry.action,
        actorUid: entry.actorUid,
        actorName: entry.actorName ?? null,
        target: entry.target ?? null,
        ok: entry.ok,
        detail: (entry.detail ?? "").slice(0, 300),
        ...requestMeta(entry.request),
        at: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    // Logged, not raised. See the file comment.
    console.error(`Could not write audit entry ${entry.action}`, error);
  }
}
