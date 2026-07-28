"use client";

import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

import { hasPlugin, isNative } from "./platform";

/**
 * Photo capture.
 *
 * On the web this is an `<input type="file" capture>`; the native path uses the
 * real camera API, which matters for two reasons beyond feeling nicer. It can
 * take several shots in one session without re-opening a picker, and it hands
 * back an already-compressed JPEG instead of a 6 MB HEIC that the browser then
 * has to decode and re-encode on the main thread — noticeably slow on an older
 * phone standing in a driveway.
 */

/** Matches the in-browser downscale in lib/db/photos.ts. */
const MAX_DIMENSION = 1600;
const QUALITY = 82;

export function canUseNativeCamera(): boolean {
  return isNative() && hasPlugin("Camera");
}

export async function requestCameraPermission(): Promise<boolean> {
  if (!canUseNativeCamera()) return true;
  try {
    const status = await Camera.requestPermissions({ permissions: ["camera"] });
    return status.camera === "granted" || status.camera === "limited";
  } catch {
    return false;
  }
}

/**
 * Takes one photo and returns it as a File, so callers can hand it to the same
 * upload path the web file input feeds.
 */
export async function capturePhoto(): Promise<File | null> {
  if (!canUseNativeCamera()) return null;

  const photo = await Camera.getPhoto({
    quality: QUALITY,
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    // Fit, not fill: cropping a "before" shot loses the part of the driveway
    // the customer is going to want to compare against.
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    correctOrientation: true,
    saveToGallery: false,
    presentationStyle: "fullscreen",
  });

  if (!photo.webPath) return null;

  const response = await fetch(photo.webPath);
  const blob = await response.blob();
  return new File([blob], `photo-${Date.now()}.jpg`, {
    type: blob.type || "image/jpeg",
  });
}
