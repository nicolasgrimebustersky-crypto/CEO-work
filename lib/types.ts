import type { Timestamp } from "firebase/firestore";

import type { PipelineStage } from "./pipeline";

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
  "stage_change",
  "lead_import",
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
  /**
   * Notification categories this person has switched OFF. Stored as the
   * exceptions rather than the selections, so an event type added later reaches
   * everyone by default instead of nobody. See lib/notifications/events.ts.
   */
  mutedNotifications: string[];
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
  /** Where this lead sits in the pipeline. See lib/pipeline.ts. */
  pipelineStage: PipelineStage;
  /** When it last moved, for the "sitting untouched" warning on the board. */
  pipelineChangedAt: Timestamp | null;
  /** Value of the open opportunity — the latest quote, until a job prices it. */
  pipelineValue: number;
  /** Set when the lead came from a Meta Lead Ad rather than a door knock. */
  source: LeadSource;
  /** Meta's leadgen id, kept so the same lead can never be imported twice. */
  sourceLeadId: string | null;
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
  /** Null until the money actually lands. Drives the awaiting-payment stage. */
  paidAt: Timestamp | null;
  paidBy: string | null;
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

export const LEAD_SOURCES = ["door_knock", "meta_lead_ad", "referral", "manual"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  door_knock: "Door knock",
  meta_lead_ad: "Facebook / Instagram",
  referral: "Referral",
  manual: "Added by hand",
};

export interface LatLng {
  lat: number;
  lng: number;
}

/** Whoever is signed in on this device. Every write is stamped with one. */
export interface Author {
  uid: string;
  displayName: string;
}
