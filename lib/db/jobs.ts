import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { JOB_STATUSES, SERVICE_TYPES } from "@/lib/types";
import type { Author, Job, JobStatus, Photo, ServiceType } from "@/lib/types";

function asPhotos(value: unknown): Photo[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DocumentData => typeof item === "object" && item !== null)
    .map((item) => ({
      url: typeof item.url === "string" ? item.url : "",
      path: typeof item.path === "string" ? item.path : "",
      takenBy: typeof item.takenBy === "string" ? item.takenBy : "",
      takenByName: typeof item.takenByName === "string" ? item.takenByName : "Unknown",
      takenAt: item.takenAt instanceof Timestamp ? item.takenAt : Timestamp.now(),
    }))
    .filter((photo) => photo.url.length > 0);
}

export function toJob(snap: QueryDocumentSnapshot<DocumentData>): Job {
  const data = snap.data();
  const serviceType = SERVICE_TYPES.includes(data.serviceType as ServiceType)
    ? (data.serviceType as ServiceType)
    : "pressure_washing";
  const status = JOB_STATUSES.includes(data.status as JobStatus)
    ? (data.status as JobStatus)
    : "scheduled";

  return {
    id: snap.id,
    customerId: typeof data.customerId === "string" ? data.customerId : "",
    serviceType,
    scheduledStart:
      data.scheduledStart instanceof Timestamp ? data.scheduledStart : Timestamp.now(),
    scheduledEnd:
      data.scheduledEnd instanceof Timestamp ? data.scheduledEnd : Timestamp.now(),
    status,
    price: typeof data.price === "number" ? data.price : 0,
    assignedTo: Array.isArray(data.assignedTo)
      ? data.assignedTo.filter((uid): uid is string => typeof uid === "string")
      : [],
    beforePhotos: asPhotos(data.beforePhotos),
    afterPhotos: asPhotos(data.afterPhotos),
    jobNotes: typeof data.jobNotes === "string" ? data.jobNotes : "",
    completedAt: data.completedAt instanceof Timestamp ? data.completedAt : null,
    completedBy: typeof data.completedBy === "string" ? data.completedBy : null,
    paidAt: data.paidAt instanceof Timestamp ? data.paidAt : null,
    paidBy: typeof data.paidBy === "string" ? data.paidBy : null,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : Timestamp.now(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "Unknown",
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedByName: typeof data.updatedByName === "string" ? data.updatedByName : null,
  };
}

/**
 * Sorted client-side rather than with orderBy so this needs no composite index —
 * one customer's job history is a handful of documents.
 */
export function subscribeJobsForCustomer(
  customerId: string,
  onChange: (jobs: Job[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const byRecent = (a: Job, b: Job) =>
    b.scheduledStart.toMillis() - a.scheduledStart.toMillis();

  if (isDemoMode) {
    return demo.subscribe<Job>(COLLECTIONS.jobs, (items) =>
      onChange(items.filter((job) => job.customerId === customerId).sort(byRecent)),
    );
  }

  const q = query(
    collection(getDb(), COLLECTIONS.jobs),
    where("customerId", "==", customerId),
  );
  return onSnapshot(
    q,
    (snap) =>
      onChange(snap.docs.map(toJob).sort(byRecent)),
    (error) => onError?.(error),
  );
}

/**
 * Rolling window of jobs for the calendar and dashboard, rather than the whole
 * collection — after a few seasons that would be thousands of documents
 * re-read on every app start. The range and the sort are on the same field, so
 * this needs no composite index. A customer's full history still comes from
 * subscribeJobsForCustomer.
 */
export function subscribeJobsFrom(
  from: Date,
  onChange: (jobs: Job[]) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isDemoMode) {
    const cutoff = from.getTime();
    return demo.subscribe<Job>(COLLECTIONS.jobs, (items) =>
      onChange(
        items
          .filter((job) => job.scheduledStart.toMillis() >= cutoff)
          .sort((a, b) => a.scheduledStart.toMillis() - b.scheduledStart.toMillis()),
      ),
    );
  }

  const q = query(
    collection(getDb(), COLLECTIONS.jobs),
    where("scheduledStart", ">=", Timestamp.fromDate(from)),
    orderBy("scheduledStart", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(toJob)),
    (error) => onError?.(error),
  );
}

/** One-shot read for reporting over an arbitrary range. */
export async function fetchJobsBetween(from: Date, to: Date): Promise<Job[]> {
  if (isDemoMode) {
    return demo
      .rows<Job>(COLLECTIONS.jobs)
      .filter((job) => {
        const at = job.scheduledStart.toMillis();
        return at >= from.getTime() && at <= to.getTime();
      })
      .sort((a, b) => a.scheduledStart.toMillis() - b.scheduledStart.toMillis());
  }

  const q = query(
    collection(getDb(), COLLECTIONS.jobs),
    where("scheduledStart", ">=", Timestamp.fromDate(from)),
    where("scheduledStart", "<=", Timestamp.fromDate(to)),
    orderBy("scheduledStart", "asc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map(toJob);
}

/** Revenue actually earned from a customer: completed jobs only. */
export function completedRevenue(jobs: Job[]): number {
  return jobs
    .filter((job) => job.status === "complete")
    .reduce((total, job) => total + job.price, 0);
}

export interface NewJobInput {
  customerId: string;
  serviceType: ServiceType;
  scheduledStart: Date;
  scheduledEnd: Date;
  price: number;
  assignedTo: string[];
  jobNotes: string;
}

export async function createJob(input: NewJobInput, author: Author): Promise<string> {
  const payload = {
    customerId: input.customerId,
    serviceType: input.serviceType,
    scheduledStart: Timestamp.fromDate(input.scheduledStart),
    scheduledEnd: Timestamp.fromDate(input.scheduledEnd),
    status: "scheduled" satisfies JobStatus,
    price: input.price,
    assignedTo: input.assignedTo,
    beforePhotos: [],
    afterPhotos: [],
    jobNotes: input.jobNotes,
    completedAt: null,
    completedBy: null,
    paidAt: null,
    paidBy: null,
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  if (isDemoMode) return demo.add(COLLECTIONS.jobs, payload);
  const ref = await addDoc(collection(getDb(), COLLECTIONS.jobs), payload);
  return ref.id;
}

/** Single persistence point, so demo mode swaps the write and nothing else. */
async function writeJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTIONS.jobs, jobId, patch);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTIONS.jobs, jobId), patch);
}

export type JobPatch = Partial<{
  serviceType: ServiceType;
  scheduledStart: Date;
  scheduledEnd: Date;
  price: number;
  assignedTo: string[];
  jobNotes: string;
  status: JobStatus;
}>;

export async function updateJob(
  jobId: string,
  patch: JobPatch,
  author: Author,
): Promise<void> {
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    payload[key] = value instanceof Date ? Timestamp.fromDate(value) : value;
  }

  await writeJob(jobId, payload);
}

/**
 * Moves a job, preserving its duration. Dragging a block on the calendar only
 * ever expresses a new start time — the length of the visit doesn't change
 * because it landed on a different day.
 */
export async function rescheduleJob(
  job: Job,
  newStart: Date,
  author: Author,
): Promise<{ start: Date; end: Date }> {
  const durationMs = job.scheduledEnd.toMillis() - job.scheduledStart.toMillis();
  const end = new Date(newStart.getTime() + Math.max(durationMs, 0));
  await updateJob(job.id, { scheduledStart: newStart, scheduledEnd: end }, author);
  return { start: newStart, end };
}

export async function completeJob(jobId: string, author: Author): Promise<void> {
  await writeJob(jobId, {
    status: "complete" satisfies JobStatus,
    completedAt: serverTimestamp(),
    completedBy: author.uid,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

/** Records payment. This is what moves a lead out of "awaiting payment". */
export async function markJobPaid(jobId: string, author: Author): Promise<void> {
  await writeJob(jobId, {
    paidAt: serverTimestamp(),
    paidBy: author.uid,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

export async function markJobUnpaid(jobId: string, author: Author): Promise<void> {
  await writeJob(jobId, {
    paidAt: null,
    paidBy: null,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
}

/** Completed work that has not been settled — the money still owed to you. */
export function unpaidValue(jobs: Job[]): number {
  return jobs
    .filter((job) => job.status === "complete" && job.paidAt === null)
    .reduce((total, job) => total + job.price, 0);
}

export async function deleteJob(jobId: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTIONS.jobs, jobId);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTIONS.jobs, jobId));
}

/** Completed jobs only — a scheduled job is not revenue yet. */
export function revenueForCustomer(jobs: Job[], customerId: string): number {
  return completedRevenue(jobs.filter((job) => job.customerId === customerId));
}
