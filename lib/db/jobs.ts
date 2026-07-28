import {
  collection,
  onSnapshot,
  query,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { COLLECTIONS, getDb } from "@/lib/firebase";
import { JOB_STATUSES, SERVICE_TYPES } from "@/lib/types";
import type { Job, JobStatus, Photo, ServiceType } from "@/lib/types";

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
  const q = query(
    collection(getDb(), COLLECTIONS.jobs),
    where("customerId", "==", customerId),
  );
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs
          .map(toJob)
          .sort((a, b) => b.scheduledStart.toMillis() - a.scheduledStart.toMillis()),
      ),
    (error) => onError?.(error),
  );
}

export function subscribeAllJobs(
  onChange: (jobs: Job[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    collection(getDb(), COLLECTIONS.jobs),
    (snap) =>
      onChange(
        snap.docs
          .map(toJob)
          .sort((a, b) => a.scheduledStart.toMillis() - b.scheduledStart.toMillis()),
      ),
    (error) => onError?.(error),
  );
}

/** Revenue actually earned from a customer: completed jobs only. */
export function completedRevenue(jobs: Job[]): number {
  return jobs
    .filter((job) => job.status === "complete")
    .reduce((total, job) => total + job.price, 0);
}
