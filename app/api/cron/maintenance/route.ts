import { allStatuses, asEquipment, dueText, noticeKey, type LogEntry } from "@/lib/maintenance";
import { BUSINESS_TIMEZONE } from "@/lib/notifications/quietHours";
import { adminDb } from "@/lib/server/admin";
import { errorResponse, requireCronSecret } from "@/lib/server/auth";
import { notifyCrew } from "@/lib/server/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Equipment service coming due. Daily, with the Admin SDK, gated on
 * CRON_SECRET.
 *
 * A task is called out once when it comes due soon and once when it goes
 * overdue — never every morning, which is how a reminder becomes something
 * you swipe away. What was said is kept on the equipment under `notified`
 * (only this route writes it; firestore.rules keep the app's hands off), and
 * doing the work starts a fresh pair, because the key carries the date it
 * was last done (lib/maintenance.ts noticeKey).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    requireCronSecret(request);
    const db = adminDb();

    const [equipmentSnap, logSnap] = await Promise.all([db.collection("equipment").get(), db.collection("maintenanceLog").get()]);
    const equipment = equipmentSnap.docs.map((d) => ({ doc: d, item: asEquipment(d.id, d.data()) }));
    const log: LogEntry[] = logSnap.docs.map((d) => {
      const data = d.data();
      const createdAt = data.createdAt;
      return {
        id: d.id,
        equipmentId: typeof data.equipmentId === "string" ? data.equipmentId : "",
        date: typeof data.date === "string" ? data.date : "1970-01-01",
        taskIds: Array.isArray(data.taskIds) ? data.taskIds.filter((x: unknown): x is string => typeof x === "string") : [],
        reading: typeof data.reading === "number" && Number.isFinite(data.reading) ? data.reading : null,
        at: createdAt && typeof createdAt.toMillis === "function" ? createdAt.toMillis() : 0,
      };
    });

    // Today in Kentucky, not in UTC.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TIMEZONE });

    let sent = 0;
    for (const { doc, item } of equipment) {
      const notified = (doc.get("notified") ?? {}) as Record<string, unknown>;
      const next: Record<string, string> = {};
      let changed = false;
      for (const status of allStatuses([item], log, today)) {
        const key = noticeKey(status);
        if (!key) continue;
        next[status.task.id] = key;
        if (notified[status.task.id] === key) continue;
        await notifyCrew({
          type: "maintenance_due",
          actorName: "Solid Acre",
          body: `${item.name} · ${status.task.what} · ${dueText(status, item.meter)}`,
        });
        sent += 1;
        changed = true;
      }
      // Keys for tasks that are no longer due are dropped, so the next time
      // they come due it is news again.
      if (changed || Object.keys(notified).some((id) => !(id in next))) {
        await doc.ref.update({ notified: next });
      }
    }

    return Response.json({ ok: true, today, equipment: equipment.length, sent });
  } catch (error) {
    return errorResponse(error);
  }
}
