import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { BUSINESS_TIMEZONE } from "@/lib/notifications/quietHours";
import { endOfDayIn, reminderBody, remindersDue, type ReminderTask } from "@/lib/tasks";
import { adminDb } from "./admin";
import { notifyCrew } from "./notify";

const stampOf = (value: unknown) => (value instanceof Timestamp ? value : null);
const stringOf = (value: unknown) => (typeof value === "string" && value ? value : null);

/**
 * This morning's follow-up reminders: one notification per person, listing
 * what is due today or already late, then each of those tasks is stamped so it
 * is not repeated tomorrow. Rescheduling clears the stamp (lib/db/tasks.ts),
 * so a snoozed task comes back on its new day.
 *
 * Runs from the money-reminders cron rather than a schedule of its own: the
 * project's cron slots are spoken for, and that one already fires at 8–9am
 * Kentucky time, which is when a list of today's calls is useful.
 */
export async function runTaskReminders(now = Date.now()): Promise<{ people: number; tasks: number }> {
  const db = adminDb();
  const snap = await db
    .collection("tasks")
    .where("doneAt", "==", null)
    .where("remindedAt", "==", null)
    .get();

  const open: (ReminderTask & { ref: FirebaseFirestore.DocumentReference })[] = snap.docs.map(
    (doc) => ({
      ref: doc.ref,
      id: doc.id,
      title: stringOf(doc.get("title")) ?? "A follow-up",
      dueAt: stampOf(doc.get("dueAt")),
      doneAt: stampOf(doc.get("doneAt")),
      remindedAt: stampOf(doc.get("remindedAt")),
      assignedTo: stringOf(doc.get("assignedTo")),
      createdBy: stringOf(doc.get("createdBy")) ?? "",
      customerName: stringOf(doc.get("customerName")),
    }),
  );

  const due = remindersDue(open, endOfDayIn(now, BUSINESS_TIMEZONE));
  let tasks = 0;
  for (const [uid, list] of due) {
    await notifyCrew({
      type: "task_due",
      actorName: "Solid Acre",
      body: reminderBody(list),
      toUids: [uid],
    });
    // Stamped after the notification, as the overdue-invoice flag is: a
    // failure to notify leaves it to be tried again tomorrow.
    const batch = db.batch();
    for (const task of list) batch.update(task.ref, { remindedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    tasks += list.length;
  }
  return { people: due.size, tasks };
}
