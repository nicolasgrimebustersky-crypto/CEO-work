"use client";

import { apiUrl } from "@/lib/apiBase";
import { isDemoMode } from "@/lib/demo/enabled";
import {
  MAX_PHOTOS,
  PHOTO_MAX_EDGE,
  fitWithin,
  isAllowedImageType,
  type PricedItem,
} from "@/lib/estimateDraft";
import { getFirebaseAuth } from "@/lib/firebase";

/**
 * Client half of estimate drafting.
 *
 * The photos are shrunk here rather than uploaded whole. A modern phone shoots
 * 4032x3024 at four or five megabytes, and four of those is twenty megabytes
 * going up an LTE connection from a driveway — most of a minute before the
 * model has even started. Shrinking to a 1024px edge in a canvas takes
 * milliseconds and loses nothing that matters for "is that a patio".
 *
 * It also fixes the format. An iPhone shoots HEIC by default and the API does
 * not read it; drawing it to a canvas and exporting JPEG converts it as a side
 * effect of the resize.
 */

export interface DraftPhotoPayload {
  mediaType: string;
  data: string;
}

/** A shrunk, JPEG-encoded copy of a picked file, ready to send. */
export async function preparePhoto(file: File): Promise<DraftPhotoPayload> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize photos.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Always JPEG: it is universally accepted by the API and is what a photo of a
  // driveway should be anyway.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  const comma = dataUrl.indexOf(",");
  return { mediaType: "image/jpeg", data: comma === -1 ? "" : dataUrl.slice(comma + 1) };
}

export async function preparePhotos(files: readonly File[]): Promise<DraftPhotoPayload[]> {
  const usable = files
    .filter((file) => isAllowedImageType(file.type) || file.type.startsWith("image/"))
    .slice(0, MAX_PHOTOS);
  return Promise.all(usable.map(preparePhoto));
}

/**
 * What the demo returns instead of calling a paid API.
 *
 * Shaped like a real answer so the flow can be walked end to end, and split so
 * the pricing arithmetic is visibly exercised rather than bypassed.
 */
function demoDraft(description: string, total: number): PricedItem[] {
  const half = Math.round(total * 0.6 * 100) / 100;
  return [
    {
      name: "Pressure washing",
      description: description.trim().slice(0, 160) || "As described on site.",
      quantity: 1,
      unitPrice: half,
    },
    {
      name: "Surface treatment",
      description: "Post-wash rinse and spot treatment of remaining staining.",
      quantity: 1,
      unitPrice: Math.round((total - half) * 100) / 100,
    },
  ];
}

export async function draftLineItems(input: {
  description: string;
  total: number;
  serviceType: string;
  photos: DraftPhotoPayload[];
}): Promise<PricedItem[]> {
  if (isDemoMode) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return demoDraft(input.description, input.total);
  }

  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();

  const response = await fetch(apiUrl("/api/estimate/draft"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await response.json().catch(() => ({}))) as {
    items?: PricedItem[];
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data.items ?? [];
}
