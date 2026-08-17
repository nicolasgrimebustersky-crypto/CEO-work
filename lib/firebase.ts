import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

/**
 * The env vars ship blank so the repo builds before anyone has a Firebase
 * project. Every entry point checks this first and renders setup instructions
 * rather than throwing an opaque SDK error.
 */
export const isFirebaseConfigured =
  firebaseConfig.apiKey.length > 0 &&
  firebaseConfig.projectId.length > 0 &&
  firebaseConfig.appId.length > 0;

/**
 * Point the SDK at the local Firebase emulators instead of the real project.
 * Set NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true in .env.local and run
 * `npm run emulators` — useful for testing rules changes or seeding fake
 * customers without polluting production data.
 */
const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

export function missingFirebaseKeys(): string[] {
  return Object.entries(firebaseConfig)
    .filter(([, value]) => value.length === 0)
    .map(([key]) => key);
}

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;
let cachedStorage: FirebaseStorage | null = null;

/**
 * App Check attests that a request came from *this app* on a real device, not
 * from a script holding a stolen refresh token. It is the one control that
 * meaningfully protects Firestore and Storage from a caller who has somehow
 * obtained valid credentials — the security rules can only ask "who are you",
 * App Check asks "are you the app".
 *
 * Optional, because it needs a reCAPTCHA v3 site key and enforcement switched
 * on in the Firebase console. Set NEXT_PUBLIC_RECAPTCHA_SITE_KEY to enable.
 */
function initAppCheck(app: FirebaseApp): void {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? "";
  if (!siteKey || typeof window === "undefined" || useEmulators) return;

  void import("firebase/app-check")
    .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    })
    .catch(() => {
      // A failure here must not take the app down: without App Check the
      // security rules still apply, so this degrades rather than breaks.
    });
}

export function getFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  const isNew = getApps().length === 0;
  cachedApp = isNew ? initializeApp(firebaseConfig) : getApp();
  if (isNew) initAppCheck(cachedApp);
  return cachedApp;
}

/**
 * Firestore is initialised with a persistent IndexedDB cache so the app keeps
 * working in the dead spots between subdivisions — reads come from cache and
 * writes queue until the connection returns. The cache is browser-only; during
 * server rendering we fall back to the plain in-memory instance.
 */
export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  const app = getFirebaseApp();

  if (typeof window === "undefined") {
    cachedDb = getFirestore(app);
    return cachedDb;
  }

  try {
    cachedDb = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // initializeFirestore throws if the instance already exists (fast refresh,
    // or a second import racing this one). Reuse whatever is already there.
    cachedDb = getFirestore(app);
  }

  if (useEmulators) {
    connectFirestoreEmulator(cachedDb, "127.0.0.1", 8080);
  }
  return cachedDb;
}

export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getFirebaseApp());
  if (useEmulators && typeof window !== "undefined") {
    connectAuthEmulator(cachedAuth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  }
  return cachedAuth;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (cachedStorage) return cachedStorage;
  cachedStorage = getStorage(getFirebaseApp());
  if (useEmulators) {
    connectStorageEmulator(cachedStorage, "127.0.0.1", 9199);
  }
  return cachedStorage;
}

export const COLLECTIONS = {
  users: "users",
  customers: "customers",
  jobs: "jobs",
  quotes: "quotes",
  notifications: "notifications",
  documents: "documents",
  services: "services",
  /** One row per device that has agreed to receive push. See lib/db/pushTokens.ts. */
  pushTokens: "pushTokens",
  /** Door-knocking routes. See lib/db/knockRoutes.ts. */
  knockRoutes: "knockRoutes",
  /** Drawn areas of ground. See lib/db/territories.ts. */
  territories: "territories",
  /** Team chat threads. Messages and read state are subcollections. */
  conversations: "conversations",
  /** Demo mode only — the real app keeps these as subcollections. */
  chatMessages: "chatMessages",
  chatReads: "chatReads",
} as const;
