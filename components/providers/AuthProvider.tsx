"use client";

import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { isDemoMode } from "@/lib/demo/enabled";
import { DEMO_NICK } from "@/lib/demo/fixtures";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";
import { ensureUserDoc } from "@/lib/db/users";
import type { Author } from "@/lib/types";

const DEMO_AUTHOR: Author = { uid: DEMO_NICK, displayName: "Nick" };
const DEMO_SESSION_KEY = "gb:demo-session";

export type AuthStatus = "loading" | "unconfigured" | "signed-out" | "signed-in";

interface AuthContextValue {
  status: AuthStatus;
  author: Author | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOutNow: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** "nicolas.grime" -> "Nicolas Grime", used until the profile doc is edited. */
function nameFromEmail(email: string | null): string {
  if (!email) return "Unknown";
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    isDemoMode || isFirebaseConfigured ? "loading" : "unconfigured",
  );
  const [user, setUser] = useState<User | null>(null);
  const [demoEmail, setDemoEmail] = useState<string | null>(null);

  // The demo session is restored from sessionStorage rather than kept in React
  // state alone, so a reload — or reopening the installed icon — does not throw
  // you back to the login screen the way it would with in-memory state only.
  // Real auth persists across restarts; the demo should not feel worse.
  useEffect(() => {
    if (!isDemoMode) return;
    const stored =
      typeof window === "undefined" ? null : window.sessionStorage.getItem(DEMO_SESSION_KEY);
    setDemoEmail(stored);
    // A fresh tab starts at the login screen on purpose: it is part of what
    // someone evaluating the app needs to see.
    setStatus(stored ? "signed-in" : "signed-out");
  }, []);

  useEffect(() => {
    if (isDemoMode || !isFirebaseConfigured) return;

    const auth = getFirebaseAuth();
    // Keep the session across app restarts — this runs on a phone all day and
    // a re-login prompt at a stranger's front door is not acceptable.
    void setPersistence(auth, browserLocalPersistence);

    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setStatus(next ? "signed-in" : "signed-out");
      if (next) {
        void ensureUserDoc(
          next.uid,
          next.displayName ?? nameFromEmail(next.email),
        ).catch(() => {
          // A blocked write here means the uid is missing from the Firestore
          // allowlist. The rest of the app surfaces that as a read error.
        });
      }
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (isDemoMode) {
      if (!email.trim() || !password) throw new Error("Enter an email and a password.");
      window.sessionStorage.setItem(DEMO_SESSION_KEY, email.trim());
      setDemoEmail(email.trim());
      setStatus("signed-in");
      return;
    }
    await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  }, []);

  const signOutNow = useCallback(async () => {
    if (isDemoMode) {
      window.sessionStorage.removeItem(DEMO_SESSION_KEY);
      setDemoEmail(null);
      setStatus("signed-out");
      return;
    }
    await signOut(getFirebaseAuth());
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    if (isDemoMode) {
      return {
        status,
        author: status === "signed-in" ? DEMO_AUTHOR : null,
        email: demoEmail,
        signIn,
        signOutNow,
      };
    }

    return {
      status,
      author: user
        ? {
            uid: user.uid,
            displayName: user.displayName ?? nameFromEmail(user.email),
          }
        : null,
      email: user?.email ?? null,
      signIn,
      signOutNow,
    };
  }, [status, user, demoEmail, signIn, signOutNow]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
