import { DEFAULT_ORG_ID } from "@/lib/org";
import { plannedCount, planReplyImport } from "@/lib/replyImport";
import { classifyReply, recordOptOut, type ReplyKind } from "@/lib/smsConsent";
import { audit } from "@/lib/server/audit";
import { ApiError, errorResponse, requireCrew } from "@/lib/server/auth";
import { preflight, withCors } from "@/lib/server/cors";
import {
  appendImportedReplies,
  customersForReplyImport,
  setSmsOptOut,
} from "@/lib/server/customerNotes";
import { importUnmatchedInbound } from "@/lib/server/inboundSms";
import { consumeRateLimit, REPLY_IMPORT_LIMIT } from "@/lib/server/rateLimit";
import { isTwilioConfigured, listInboundMessages, twilioProblem } from "@/lib/server/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How far back to look. Twilio keeps message logs for 400 days. */
const LOOKBACK_DAYS = 365;
/**
 * Messages read, sent and received together — Twilio's log cannot be filtered
 * by direction. Bounded so the route finishes inside maxDuration.
 */
const MAX_MESSAGES = 5000;

/**
 * Files the replies customers sent before the inbound webhook was connected.
 *
 * Twilio accepted every one of them and kept it in its log, but the business
 * number had nowhere to forward them, so none reached the CRM. This reads the
 * log and files each reply exactly as the webhook would have: on the
 * customer's timeline when the number is on file, on the Messages screen's
 * "numbers we don't know" list when it is not.
 *
 * Differences from the webhook, all deliberate:
 *   - nobody's phone buzzes — a hundred old replies arriving as a hundred
 *     notifications would bury the one that matters today;
 *   - each reply keeps the time it was sent, so it sits in the right place;
 *   - the client gets the blue dot, so it is visible who wrote back.
 *
 * Running it again files only what is new. See lib/replyImport.ts.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const caller = await requireCrew(request);
    if (!isTwilioConfigured) {
      throw new ApiError(503, twilioProblem || "Twilio is not configured.");
    }
    await consumeRateLimit(caller.uid, "reply_import", REPLY_IMPORT_LIMIT);

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const [{ replies, reachedLimit }, customers] = await Promise.all([
      listInboundMessages({ since, limit: MAX_MESSAGES }),
      customersForReplyImport(DEFAULT_ORG_ID),
    ]);

    const plan = planReplyImport(replies, customers);
    const names = new Map(customers.map((customer) => [customer.id, customer.name]));

    let optOuts = 0;
    for (const [customerId, notes] of plan.byCustomer) {
      // STOP and START are filed the way the webhook files them, and the last
      // one sent decides where the record ends up — a customer who said STOP
      // and later START is textable; one who said START and later STOP is not.
      let lastKeyword: { kind: ReplyKind; body: string; sentAt: number } | null = null;
      const filed: { id: string; text: string; sentAt: number }[] = [];
      for (const note of notes) {
        const kind = classifyReply(note.body);
        if (kind === "opt_out" || kind === "opt_in") {
          lastKeyword = { kind, body: note.body, sentAt: note.sentAt };
        }
        filed.push({
          id: note.id,
          sentAt: note.sentAt,
          text:
            kind === "opt_out"
              ? `${note.body}\n\n[Opted out of text messages. Call them instead, or ask them to text START.]`
              : kind === "opt_in"
                ? `${note.body}\n\n[Opted back in to text messages.]`
                : note.body,
        });
      }

      await appendImportedReplies(customerId, filed, { name: names.get(customerId) ?? "Customer" });

      if (lastKeyword?.kind === "opt_out") {
        await setSmsOptOut(customerId, recordOptOut(lastKeyword.body, new Date(lastKeyword.sentAt)));
        optOuts += 1;
      } else if (lastKeyword?.kind === "opt_in") {
        await setSmsOptOut(customerId, null);
      }
    }

    let unknownNumbers = 0;
    for (const reply of plan.unmatched) {
      const added = await importUnmatchedInbound({
        from: reply.from,
        body: reply.body,
        messageSid: reply.sid,
        receivedAt: new Date(reply.sentAt),
      });
      if (added) unknownNumbers += 1;
    }

    const result = {
      ok: true,
      read: replies.length,
      filed: plannedCount(plan),
      customers: plan.byCustomer.size,
      unknownNumbers,
      alreadyFiled: plan.alreadyFiled,
      optOuts,
      // The cap was hit, so older replies may remain in Twilio's log.
      truncated: reachedLimit,
    };

    await audit({
      action: "sms.import_replies",
      actorUid: caller.uid,
      actorName: caller.displayName,
      ok: true,
      detail: `${result.filed} replies on ${result.customers} clients, ${unknownNumbers} from unknown numbers`,
      request,
    });

    return withCors(request, result);
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** Preflight for the iOS shell, which calls this cross-origin. */
export function OPTIONS(request: Request): Response {
  return preflight(request);
}
