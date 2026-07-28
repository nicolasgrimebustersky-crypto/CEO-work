"use client";

import { Capacitor } from "@capacitor/core";

/**
 * One place to ask "are we inside the native shell". Every native capability in
 * this folder degrades to its web equivalent when the answer is no, so the same
 * code runs in a desktop browser, as an installed PWA, and inside the iOS app.
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function isIOS(): boolean {
  return Capacitor.getPlatform() === "ios";
}

export function platformName(): string {
  return Capacitor.getPlatform();
}

/** True when a given Capacitor plugin is actually available to call. */
export function hasPlugin(name: string): boolean {
  return Capacitor.isPluginAvailable(name);
}
