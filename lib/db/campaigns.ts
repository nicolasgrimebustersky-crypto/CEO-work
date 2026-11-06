"use client";

import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, type DocumentData } from "firebase/firestore";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { DEFAULT_ORG_ID } from "@/lib/org";
import type { Author } from "@/lib/types";

/**
 * A sent seasonal campaign: what went out, to whom, when. Results aren't
 * stored — lib/campaigns.ts works them out from estimates and jobs — so this
 * is written once and never edited. The crew can read it (they follow up);
 * only the owner records one (firestore.rules), as only the owner can send.
 */
const COLLECTION = COLLECTIONS.campaigns;

export interface SentCampaign {
  id: string;
  templateId: string;
  name: string;
  service: string;
  message: string;
  recipients: string[];
  /** Left out for want of consent, already having it, or STOP. */
  excluded: number;
  sentAt: number;
  createdByName: string;
}

export function toCampaign(id: string, data: DocumentData): SentCampaign {
  const sentAt = data.sentAt instanceof Timestamp ? data.sentAt.toMillis() : typeof data.sentAt === "number" ? data.sentAt : Date.now();
  return {
    id,
    templateId: typeof data.templateId === "string" ? data.templateId : "",
    name: typeof data.name === "string" ? data.name : "Campaign",
    service: typeof data.service === "string" ? data.service : "",
    message: typeof data.message === "string" ? data.message : "",
    recipients: Array.isArray(data.recipients) ? data.recipients.filter((x: unknown): x is string => typeof x === "string") : [],
    excluded: typeof data.excluded === "number" ? data.excluded : 0,
    sentAt,
    createdByName: typeof data.createdByName === "string" ? data.createdByName : "",
  };
}

export function subscribeCampaigns(onChange: (items: SentCampaign[]) => void, onError?: (e: Error) => void): () => void {
  const sort = (items: SentCampaign[]) => [...items].sort((a, b) => b.sentAt - a.sentAt);
  if (isDemoMode) {
    return demo.subscribe<Record<string, unknown>>(COLLECTION, (rows) => onChange(sort(rows.map((r) => toCampaign(String(r.id), r)))));
  }
  return onSnapshot(
    query(collection(getDb(), COLLECTION)),
    (snap) => onChange(sort(snap.docs.map((d) => toCampaign(d.id, d.data())))),
    (error) => onError?.(error),
  );
}

export async function recordCampaign(
  c: { templateId: string; name: string; service: string; message: string; recipients: string[]; excluded: number },
  author: Author,
): Promise<void> {
  const payload = {
    orgId: DEFAULT_ORG_ID,
    templateId: c.templateId,
    name: c.name.slice(0, 80),
    service: c.service,
    message: c.message.slice(0, 1600),
    recipients: c.recipients.slice(0, 200),
    excluded: c.excluded,
    sentAt: isDemoMode ? Timestamp.now() : serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: author.uid,
    createdByName: author.displayName,
  };
  if (isDemoMode) {
    demo.add(COLLECTION, payload);
    return;
  }
  await setDoc(doc(collection(getDb(), COLLECTION)), payload);
}

export async function deleteCampaign(id: string): Promise<void> {
  if (isDemoMode) {
    demo.remove(COLLECTION, id);
    return;
  }
  await deleteDoc(doc(getDb(), COLLECTION, id));
}
