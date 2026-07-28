"use client";

import { doc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb, getFirebaseStorage } from "@/lib/firebase";
import type { Author, Photo } from "@/lib/types";

export type PhotoSlot = "beforePhotos" | "afterPhotos";

/** Above this, phone photos get downscaled before upload. */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

/**
 * Phone cameras produce 3–8 MB files. Uploading those raw over a rural LTE
 * connection is slow enough that people stop taking photos, so they are
 * downscaled and re-encoded in the browser first. Falls back to the original
 * file if canvas encoding is unavailable.
 */
async function downscale(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) {
      bitmap.close();
      return file;
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Where the photo ends up: Storage normally, an object URL in demo mode. */
async function store(path: string, blob: Blob): Promise<string> {
  // Object URLs live as long as the tab, which is exactly as long as the demo
  // data does. Nothing leaves the device.
  if (isDemoMode) return URL.createObjectURL(blob);

  const storageRef = ref(getFirebaseStorage(), path);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  return getDownloadURL(storageRef);
}

async function writeJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  if (isDemoMode) {
    demo.update(COLLECTIONS.jobs, jobId, patch);
    return;
  }
  await updateDoc(doc(getDb(), COLLECTIONS.jobs, jobId), patch);
}

export async function uploadJobPhoto(
  jobId: string,
  slot: PhotoSlot,
  file: File,
  existing: Photo[],
  author: Author,
): Promise<Photo> {
  const blob = await downscale(file);
  const name = `${slot === "beforePhotos" ? "before" : "after"}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 8)}.jpg`;
  // Path must match the storage.rules pattern: jobs/{jobId}/{fileName}
  const path = `jobs/${jobId}/${name}`;

  const url = await store(path, blob);

  const photo: Photo = {
    url,
    path,
    takenBy: author.uid,
    takenByName: author.displayName,
    takenAt: Timestamp.now(),
  };

  await writeJob(jobId, {
    [slot]: [...existing, photo],
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });

  return photo;
}

export async function removeJobPhoto(
  jobId: string,
  slot: PhotoSlot,
  photo: Photo,
  existing: Photo[],
  author: Author,
): Promise<void> {
  await writeJob(jobId, {
    [slot]: existing.filter((item) => item.path !== photo.path),
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  });

  if (isDemoMode) {
    if (photo.url.startsWith("blob:")) URL.revokeObjectURL(photo.url);
    return;
  }

  // Remove the file second: an orphaned Storage object is cheap, but a job
  // record pointing at a deleted file renders as a broken image.
  try {
    await deleteObject(ref(getFirebaseStorage(), photo.path));
  } catch {
    // Already gone, or a rules change removed delete permission. The record is
    // what the UI reads, and that is already correct.
  }
}
