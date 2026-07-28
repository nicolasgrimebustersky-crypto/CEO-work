import type { Timestamp } from "firebase/firestore";

export const CUSTOMER_STATUSES = [
  "lead",
  "quoted",
  "customer",
  "not_interested",
  "do_not_knock",
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const SERVICE_TYPES = [
  "pressure_washing",
  "landscaping",
  "snow_removal",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const JOB_STATUSES = [
  "scheduled",
  "in_progress",
  "complete",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const QUOTE_STATUSES = [
  "sent",
  "accepted",
  "declined",
  "no_response",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/**
 * Note kinds share one timeline per customer. SMS entries are written by the
 * SMS API routes; everything else is written from the client.
 */
export const NOTE_KINDS = [
  "note",
  "status_change",
  "sms_out",
  "sms_in",
  "quote",
  "job",
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface Note {
  id: string;
  text: string;
  kind: NoteKind;
  authorUid: string;
  /** Denormalised so the timeline renders without a second read. */
  authorName: string;
  createdAt: Timestamp;
}

export interface AppUser {
  uid: string;
  displayName: string;
  phone: string;
  currentLat: number | null;
  currentLng: number | null;
  lastLocationUpdate: Timestamp | null;
  isActive: boolean;
  /** Optional override; otherwise assigned deterministically. See lib/userColor.ts */
  color?: string | null;
}

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  lat: number;
  lng: number;
  status: CustomerStatus;
  notes: Note[];
  tags: string[];
  /** Service types this customer has been quoted for or bought. Drives map filtering. */
  serviceTypes: ServiceType[];
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  lastContactedAt: Timestamp | null;
  lastContactedBy: string | null;
  lastContactedByName: string | null;
  lifetimeValue: number;
  /** Last-write-wins conflict stamp, surfaced in the UI. */
  updatedAt: Timestamp | null;
  updatedBy: string | null;
  updatedByName: string | null;
}

export interface Photo {
  url: string;
  /** Storage path, kept so the file can be deleted with the job. */
  path: string;
  takenBy: string;
  takenByName: string;
  takenAt: Timestamp;
}

export interface Job {
  id: string;
  customerId: string;
  serviceType: ServiceType;
  scheduledStart: Timestamp;
  scheduledEnd: Timestamp;
  status: JobStatus;
  price: number;
  assignedTo: string[];
  beforePhotos: Photo[];
  afterPhotos: Photo[];
  jobNotes: string;
  completedAt: Timestamp | null;
  completedBy: string | null;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
  updatedByName: string | null;
}

export interface Quote {
  id: string;
  customerId: string;
  serviceType: ServiceType;
  amount: number;
  sentAt: Timestamp;
  sentBy: string;
  sentByName: string;
  status: QuoteStatus;
  followUpCount: number;
  lastFollowUpAt: Timestamp | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Whoever is signed in on this device. Every write is stamped with one. */
export interface Author {
  uid: string;
  displayName: string;
}
