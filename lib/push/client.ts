"use client";

import { apiUrl } from "@/lib/apiBase";
import { isDemoMode } from "@/lib/demo/enabled";
import { deletePushToken, savePushToken, touchPushToken } from "@/lib/db/pushTokens";
import { getFirebaseApp, getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";

/**
 * Push notifications — the half that runs in the browser.
 *
 * The bell inside the app is a pull surface: it is there when you look. This is
 * the other kind, the one that reaches a phone in a pocket with the app closed,
 * which is the only kind that is any use when the other person books a job
 * while you are on a ladder.
 *
 * How the pieces fit:
 *
 *   public/push-sw.js   a service worker with a `push` handler and nothing else
 *   this file           asks permission, gets an FCM token, files it
 *   lib/db/pushTokens   one Firestore document per device
 *   /api/push/send      the server, which is the only side that may send
 *
 * The Firebase Messaging SDK is loaded dynamically, never at module scope.
 * Every screen imports the notification helpers transitively, and there is no
 * reason for a phone opening the map to download a messaging SDK it may never
 * use.
 */

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "";

/**
 * A dedicated scope, not the root.
 *
 * next-pwa already owns a service worker at `/` for the offline shell.  Two
 * registrations cannot both control the same scope — the second would evict the
 * first, and the app would silently lose its offline behaviour the moment
 * somebody switched push on. A narrower scope lets both live.
 *
 * The path does not have to resolve to a real page; a scope is a URL prefix for
 * matching, and nothing is ever fetched from it.
 */
const PUSH_SCOPE = "/gb-push-scope";
const PUSH_WORKER = "/push-sw.js";

export type PushBlocker =
  | "demo"
  | "unconfigured"
  | "unsupported"
  | "needs-install"
  | "denied";

export interface PushStatus {
  /** Null when push can be switched on from here. */
  blocker: PushBlocker | null;
  /** True when this device is registered and will receive push. */
  enabled: boolean;
  /** What to tell the user. Empty when there is nothing to say. */
  message: string;
}

const BLOCKER_MESSAGE: Record<PushBlocker, string> = {
  demo: "Demo mode has no server to send from. Push is off.",
  unconfigured:
    "Push is not set up for this deployment yet. It needs a Web Push certificate from the Firebase console — see the README.",
  unsupported: "This browser can't receive push notifications.",
  "needs-install":
    "On iPhone, push only works once the app is on your home screen. Tap Share → Add to Home Screen, open it from there, then come back.",
  denied:
    "Notifications are blocked for this site. Turn them back on in your browser or iOS Settings → Notifications, then try again.",
};

/**
 * iOS grants Web Push only to a PWA launched from the home screen — in Safari
 * proper the API exists and every attempt to use it fails. Detecting that up
 * front turns a dead button into an instruction that actually gets somewhere.
 */
function isIosBrowserNotInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return false;

  const standalone =
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone) ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

function detectBlocker(): PushBlocker | null {
  if (isDemoMode) return "demo";
  if (!isFirebaseConfigured || !VAPID_KEY) return "unconfigured";
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return isIosBrowserNotInstalled() ? "needs-install" : "unsupported";
  }
  if (!("Notification" in window)) return "unsupported";
  if (isIosBrowserNotInstalled()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  return null;
}

/**
 * The token this device currently holds, or null.
 *
 * Never prompts: `getToken` throws when permission has not been granted, so the
 * permission state is checked first. That keeps this safe to call on every
 * sign-in, which is what keeps a rotated token from quietly going stale.
 */
async function currentToken(): Promise<string | null> {
  if (detectBlocker() !== null) return null;
  if (Notification.permission !== "granted") return null;

  try {
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return null;

    const registration = await navigator.serviceWorker.register(PUSH_WORKER, {
      scope: PUSH_SCOPE,
    });
    return await getToken(getMessaging(getFirebaseApp()), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
  } catch {
    return null;
  }
}

export async function pushStatus(): Promise<PushStatus> {
  const blocker = detectBlocker();
  if (blocker) return { blocker, enabled: false, message: BLOCKER_MESSAGE[blocker] };

  const enabled = Notification.permission === "granted" && (await currentToken()) !== null;
  return {
    blocker: null,
    enabled,
    message: enabled
      ? ""
      : "Turn this on and your phone will buzz when the other person books a job, a customer texts back, or money lands.",
  };
}

/**
 * Asks for permission and files this device's token.
 *
 * Returns the resulting status rather than throwing, because every failure here
 * is something the user has to be told in words — a blocked permission, an
 * iPhone that has not been added to the home screen — and a thrown error would
 * only reach a console nobody is looking at while standing on a driveway.
 */
export async function enablePush(uid: string): Promise<PushStatus> {
  const blocker = detectBlocker();
  if (blocker) return { blocker, enabled: false, message: BLOCKER_MESSAGE[blocker] };

  // Safari requires this to be called from a user gesture, which is why it is
  // here and not in a provider effect.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      blocker: "denied",
      enabled: false,
      message:
        permission === "denied"
          ? BLOCKER_MESSAGE.denied
          : "Permission wasn't granted, so nothing will come through yet.",
    };
  }

  const token = await currentToken();
  if (!token) {
    return {
      blocker: "unsupported",
      enabled: false,
      message:
        "Permission was granted but this browser wouldn't issue a push token. Try reopening the app.",
    };
  }

  await savePushToken(uid, token);
  return {
    blocker: null,
    enabled: true,
    message: "This device will now get notifications with the app closed.",
  };
}

/** Unregisters this device. The other one keeps working. */
export async function disablePush(): Promise<PushStatus> {
  const token = await currentToken();
  if (token) {
    await deletePushToken(token).catch(() => {});
    try {
      const { deleteToken, getMessaging } = await import("firebase/messaging");
      await deleteToken(getMessaging(getFirebaseApp()));
    } catch {
      // The Firestore row is gone, which is what stops the sending. A failure
      // to release the token with FCM is not worth surfacing.
    }
  }
  return {
    blocker: null,
    enabled: false,
    message: "Push is off for this device. The bell inside the app still works.",
  };
}

/**
 * Keeps an already-granted device current, without prompting.
 *
 * Browsers rotate registration tokens on their own schedule. Without this, push
 * works for a few weeks after somebody switches it on and then stops, with no
 * error anywhere — the worst possible failure mode for a notification system.
 */
export async function refreshPushToken(uid: string): Promise<void> {
  const token = await currentToken();
  if (!token) return;
  await savePushToken(uid, token).catch(() => {});
  await touchPushToken(token).catch(() => {});
}

/**
 * Hands a notification to the server to fan out as push.
 *
 * Deliberately best-effort and never awaited by callers: the Firestore record
 * is already written by the time this runs, so a failure here costs an
 * interruption, not the event itself.
 */
export async function deliverPush(payload: {
  forUids: string[];
  title: string;
  body: string;
  url: string;
  tag: string;
}): Promise<void> {
  if (isDemoMode || payload.forUids.length === 0) return;

  try {
    const user = getFirebaseAuth().currentUser;
    if (!user) return;

    await fetch(apiUrl("/api/push/send"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Offline, or push is not configured on this deployment. The bell already
    // has the event; nothing here is worth interrupting a save for.
  }
}
