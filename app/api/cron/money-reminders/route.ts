import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { formatMoneyExact } from "@/lib/format";
import { hourInBusinessTimezone, BUSINESS_TIMEZONE } from "@/lib/notifications/quietHours";
import { adminDb } from "@/lib/server/admin";
import { errorResponse, requireCronSecret } from "@/lib/server/auth";
import { notifyCrew } from "@/lib/server/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The money that has not come in yet.
 *
 * Every other notification in this app fires because a person did something.
 * Nothing was on a clock, which meant an invoice could sit unpaid indefinitely
 * and the app would never say a word — the Money screen shows it, but only if
 * you go and look, and the whole point of a notification is the day you don't.
 *
 * Two things happen here, both deliberately quiet:
 *
 *   Every day — an invoice that has just passed its due date is called out
 *   once, the morning it happens. Once, not daily: a notification that repeats
 *   until you act is one you learn to swipe away, and swiping away is a habit
 *   that costs you the next real one too.
 *
 *   Mondays — a single line for everything still outstanding, so the week
 *   starts with a number rather than a scroll.
 *
 * Runs with the Admin SDK and is gated on CRON_SECRET rather than a user token.
 */

/** Marked on the invoice once it has been called out, so it is called out once. */
const OVERDUE_FLAG = "overdueNotifiedAt";

/** Invoices that can still be paid. Draft was never sent; void was written off. */
const CHASEABLE = ["sent", "partial"];

interface Outstanding {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  balanceDue: number;
  dueAt: Timestamp | null;
}

function readInvoice(doc: FirebaseFirestore.QueryDocumentSnapshot): Outstanding | null {
  const balanceDue = doc.get("balanceDue");
  if (typeof balanceDue !== "number" || balanceDue <= 0) return null;

  return {
    id: doc.id,
    number: typeof doc.get("number") === "string" ? doc.get("number") : "",
    customerId: typeof doc.get("customerId") === "string" ? doc.get("customerId") : "",
    customerName:
      typeof doc.get("customerName") === "string" ? doc.get("customerName") : "A customer",
    balanceDue,
    dueAt: doc.get("dueAt") instanceof Timestamp ? doc.get("dueAt") : null,
  };
}

/** Whole days late, floored — "1 day late" should not appear at 23:59 on the day. */
function daysLate(dueAt: Timestamp, now: number): number {
  return Math.floor((now - dueAt.toMillis()) / 86_400_000);
}

export async function GET(request: Request): Promise<Response> {
  try {
    requireCronSecret(request);

    const db = adminDb();
    const now = Date.now();

    const snap = await db
      .collection("documents")
      .where("kind", "==", "invoice")
      .where("status", "in", CHASEABLE)
      .get();

    const open = snap.docs
      .map((doc) => ({ doc, invoice: readInvoice(doc) }))
      .filter((row): row is { doc: (typeof snap.docs)[number]; invoice: Outstanding } =>
        row.invoice !== null,
      );

    /* ----------------------------------------------- newly past its due date */

    const newlyOverdue = open.filter(
      ({ doc, invoice }) =>
        invoice.dueAt !== null &&
        invoice.dueAt.toMillis() < now &&
        // Called out once. The flag is what makes that true across restarts,
        // retries and a double firing on the same morning.
        doc.get(OVERDUE_FLAG) == null,
    );

    for (const { doc, invoice } of newlyOverdue) {
      const late = daysLate(invoice.dueAt as Timestamp, now);
      await notifyCrew({
        type: "invoice_overdue",
        actorName: "Grime Busters",
        body: `${invoice.customerName} · ${formatMoneyExact(invoice.balanceDue)} · #${invoice.number} · ${
          late <= 0 ? "due today" : `${late} day${late === 1 ? "" : "s"} late`
        }`,
        customerId: invoice.customerId || null,
        documentId: invoice.id,
      });
      // Stamped after the notification, so a failure to notify leaves it to be
      // retried tomorrow rather than marking it done having said nothing.
      await doc.ref.update({ [OVERDUE_FLAG]: FieldValue.serverTimestamp() });
    }

    /* ------------------------------------------------------- Monday's total */

    // Monday in Louisville, not in UTC — the schedule fires at 13:00 UTC, which
    // is still Sunday evening for anyone reading this on a phone in Kentucky if
    // the day is taken from the server's clock.
    const local = new Date(
      new Date().toLocaleString("en-US", { timeZone: BUSINESS_TIMEZONE }),
    );
    const isMonday = local.getDay() === 1;

    let summarised = 0;
    if (isMonday && open.length > 0) {
      const total = open.reduce((sum, { invoice }) => sum + invoice.balanceDue, 0);
      const overdue = open.filter(
        ({ invoice }) => invoice.dueAt !== null && invoice.dueAt.toMillis() < now,
      );
      const oldest = [...overdue].sort(
        (a, b) => (a.invoice.dueAt?.toMillis() ?? 0) - (b.invoice.dueAt?.toMillis() ?? 0),
      )[0];

      await notifyCrew({
        type: "money_summary",
        actorName: "Grime Busters",
        body:
          `${formatMoneyExact(total)} across ${open.length} invoice${open.length === 1 ? "" : "s"}` +
          (overdue.length > 0
            ? `. ${overdue.length} past due, oldest is ${oldest.invoice.customerName}.`
            : ". Nothing past due."),
      });
      summarised = open.length;
    }

    return Response.json({
      ok: true,
      hourInBusiness: hourInBusinessTimezone(new Date()),
      openInvoices: open.length,
      newlyOverdue: newlyOverdue.length,
      summarised,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
