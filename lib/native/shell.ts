"use client";

import { App } from "@capacitor/app";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

import { hasPlugin, isNative } from "./platform";

/**
 * Native shell behaviour: the small things that separate an app from a page in
 * a browser, and that App Review looks for under Guideline 4.2.
 */

/** Called once the first authenticated screen is ready to show. */
export async function hideSplash(): Promise<void> {
  if (!isNative() || !hasPlugin("SplashScreen")) return;
  try {
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    // A splash that fails to hide is bad, but not worth taking the app down.
  }
}

export async function applyStatusBarStyle(): Promise<void> {
  if (!isNative() || !hasPlugin("StatusBar")) return;
  try {
    // Light glyphs on the dark chrome.
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* not fatal */
  }
}

/**
 * A short tap when a drag picks up a job. The web build calls
 * navigator.vibrate, which iOS Safari ignores entirely — this is the only way
 * the gesture gets any physical confirmation on an iPhone.
 */
export async function impact(style: "light" | "medium" = "light"): Promise<void> {
  if (!isNative() || !hasPlugin("Haptics")) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(15);
    }
    return;
  }
  try {
    await Haptics.impact({
      style: style === "medium" ? ImpactStyle.Medium : ImpactStyle.Light,
    });
  } catch {
    /* not fatal */
  }
}

/**
 * Runs `onResume` when the app comes back to the foreground.
 *
 * Firestore's listeners reconnect on their own, but the calendar's "today"
 * anchor and the day view's route are computed once — after a phone has been in
 * a pocket since this morning, they are showing yesterday until something
 * nudges them.
 */
export function onAppResume(callback: () => void): () => void {
  if (!isNative() || !hasPlugin("App")) {
    if (typeof document === "undefined") return () => {};
    const handler = () => {
      if (document.visibilityState === "visible") callback();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }

  const listener = App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) callback();
  });
  return () => {
    void listener.then((handle) => handle.remove());
  };
}

/**
 * Hardware/system back handling. iOS has no back button, but Capacitor routes
 * the edge-swipe through the same event, and without this the gesture exits the
 * app from a sheet instead of closing it.
 */
export function onBackButton(callback: () => boolean): () => void {
  if (!isNative() || !hasPlugin("App")) return () => {};

  const listener = App.addListener("backButton", () => {
    // The callback returns true when it handled the gesture itself.
    if (!callback()) void App.exitApp();
  });
  return () => {
    void listener.then((handle) => handle.remove());
  };
}
