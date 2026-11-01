"use client";

import { arrayUnion, doc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type BusinessDocument,
  type DocumentAttachment,
} from "@/lib/documents";
import { COLLECTIONS, getDb, getFirebaseStorage } from "@/lib/firebase";
import type { Author } from "@/lib/types";

/**
 * Attaching files to an estimate or invoice.
 *
 * The file goes to documents/{id}/files/ (storage.rules allows crew only,
 * PDFs and photos, under 20 MB), then a record of it is added to the
 * document. Customers never read the bucket: their copy asks the server for a
 * short-lived link — see app/api/files/[token]/[fileId].
 */

const demoUrls = new Map<string, string>();

/** Why a file cannot be attached, or "" when it can. Checked before uploading. */
export function attachmentProblem(file: File): string {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    return "Only PDFs and photos (JPG, PNG, WEBP, HEIC) can be attached.";
  }
  if (file.size >= MAX_ATTACHMENT_BYTES) return "That file is over 20 MB.";
  return "";
}

/** A storage-safe name that still reads like the original. */
function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(-80) || "file";
}

export async function attachFile(
  document: BusinessDocument,
  file: File,
  author: Author,
): Promise<DocumentAttachment> {
  const problem = attachmentProblem(file);
  if (problem) throw new Error(problem);

  const id = crypto.randomUUID();
  const path = `documents/${document.id}/files/${id}-${safeName(file.name)}`;
  const attachment: DocumentAttachment = {
    id,
    name: file.name.slice(0, 120) || "File",
    path,
    contentType: file.type,
    size: file.size,
    uploadedBy: author.uid,
    uploadedByName: author.displayName,
    uploadedAt: Timestamp.now(),
  };

  if (isDemoMode) {
    demoUrls.set(path, URL.createObjectURL(file));
    demo.update(COLLECTIONS.documents, document.id, {
      attachments: [...document.attachments, attachment],
    });
    return attachment;
  }

  await uploadBytes(ref(getFirebaseStorage(), path), file, { contentType: file.type });
  await updateDoc(doc(getDb(), COLLECTIONS.documents, document.id), {
    attachments: arrayUnion(attachment),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
  return attachment;
}

export async function removeFile(
  document: BusinessDocument,
  attachment: DocumentAttachment,
  author: Author,
): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTIONS.documents, document.id, {
      attachments: document.attachments.filter((file) => file.id !== attachment.id),
    });
    return;
  }

  // The record first: a file nobody can see is harmless, a tile pointing at
  // nothing is a broken link on the customer's page.
  await updateDoc(doc(getDb(), COLLECTIONS.documents, document.id), {
    // The whole list, not arrayRemove: arrayRemove matches on exact equality
    // with the stored object, and a record read back with a default filled in
    // would silently never match.
    attachments: document.attachments.filter((file) => file.id !== attachment.id),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });
  await deleteObject(ref(getFirebaseStorage(), attachment.path)).catch(() => {
    // Already gone, or a transient failure — either way the document no
    // longer lists it, which is what the customer sees.
  });
}

/** A link for the crew to open a file from their own screen. */
export async function crewFileUrl(attachment: DocumentAttachment): Promise<string> {
  if (isDemoMode) return demoUrls.get(attachment.path) ?? "";
  return getDownloadURL(ref(getFirebaseStorage(), attachment.path));
}
