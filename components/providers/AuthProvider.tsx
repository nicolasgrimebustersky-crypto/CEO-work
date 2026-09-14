"use client";

import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
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

import { isCrew as roleIsCrew } from "@/lib/auth/roles";
import { OTP_CLAIM, sessionIsVerified } from "@/lib/otp";
import { isDemoMode } from "@/lib/demo/enabled";
import { DEMO_NICK } from "@/lib/demo/fixtures";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";
import { ensureUserDoc, subscribeOwnProfile } from "@/lib/db/users";
import type { Author } from "@/lib/types";

const DEMO_AUTHOR: Author = { uid: DEMO_NICK, displayName: "Nick" };
const DEMO_SESSION_KEY = "gb:demo-session";

/**
 * "pending" is signed in but not approved. It is a separate status rather than
 * a flag on "signed-in" so that no screen can forget to check it — AuthGate
 * switches on this one value, and a pending account never reaches the app.
 *
 * "code" is approved crew whose sign-in has not yet entered its emailed code.
 * Same reasoning: the database rules refuse such a session everything, so the
 * app must not open underneath it and collect a screen full of permission
 * errors — it shows the six boxes instead.
 */
export type AuthStatus =
  | "loading"
  | "unconfigured"
  | "signed-out"
  | "pending"
  | "code"
  | "signed-in";

interface AuthContextValue {
  status: AuthStatus;
  author: Author | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  /** Emails a reset link. Firebase answers the same whether or not the address exists. */
  resetPassword: (email: string) => Promise<void>;
  /**
   * After the server has accepted a code: fetch a fresh token carrying the
   * claim and move on to the app. The status changes by itself — callers
   * await this and render nothing special.
   */
  confirmCode: () => Promise<void>;
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
      if (!next) {
        setStatus("signed-out");
        return;
      }
      // Signed in is not the same as allowed in. Stay on "loading" until the
      // profile says which — landing on "signed-in" first would flash the whole
      // app, customer list included, at an account that is not approved.
      setStatus("loading");
      void ensureUserDoc(
        next.uid,
        next.displayName ?? nameFromEmail(next.email),
      ).catch(() => {
        // A blocked write here means the profile already exists and this
        // account may not rewrite it, or the rules are not deployed. Either
        // way the role subscription below is what decides access.
      });
    });
  }, []);

  /**
   * Crew, yes — but has THIS sign-in entered its code? Read from the ID token,
   * which is where the server puts the answer and where the rules read it.
   *
   * `force` fetches a new token first. Needed straight after a code is
   * accepted: the claim is on the account, but the token in hand is the one
   * minted before it was.
   */
  const settleCode = useCallback(async (current: User, force = false) => {
    try {
      if (force) await current.getIdToken(true);
      const { claims } = await current.getIdTokenResult();
      // The SDK types auth_time as a string; the decoded payload is a number.
      // Normalised so the one shared rule sees what the rules and the server
      // see, rather than a type quirk deciding who gets in.
      const authTime =
        typeof claims.auth_time === "string" ? Number(claims.auth_time) : claims.auth_time;
      setStatus(
        sessionIsVerified({ auth_time: authTime, [OTP_CLAIM]: claims[OTP_CLAIM] })
          ? "signed-in"
          : "code",
      );
    } catch {
      // Cannot read our own token: ask for the code. Refusing is the direction
      // a failure here has to fail in.
      setStatus("code");
    }
  }, []);

  // Watch our own profile for the role. A live subscription rather than a
  // one-off read so that being approved takes effect on the pending person's
  // phone immediately, without them knowing to reload.
  useEffect(() => {
    if (isDemoMode || !user) return;
    return subscribeOwnProfile(
      user.uid,
      (profile) => {
        if (!roleIsCrew(user.uid, profile?.role, user.email)) {
          setStatus("pending");
          return;
        }
        void settleCode(user);
      },
      () => {
        // Cannot even read our own profile: the rules are older than this
        // feature, or Firestore is unreachable. Fail closed for everyone
        // except the admin, who would otherwise be locked out of the only
        // screen that can fix it — and the admin still owes a code.
        if (roleIsCrew(user.uid, undefined, user.email)) void settleCode(user);
        else setStatus("pending");
      },
    );
  }, [user, settleCode]);

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

  /**
   * Register. Creates the auth user, names it, and lets `ensureUserDoc` write
   * the profile as pending — this function grants no access by itself, which
   * is the property that makes an open sign-up form safe here.
   */
  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      if (isDemoMode) {
        throw new Error("This is the demo — accounts are not real here.");
      }
      const credential = await createUserWithEmailAndPassword(
        getFirebaseAuth(),
        email.trim(),
        password,
      );
      const trimmed = name.trim();
      if (trimmed) {
        await updateProfile(credential.user, { displayName: trimmed });
      }
      await ensureUserDoc(credential.user.uid, trimmed || nameFromEmail(email));
    },
    [],
  );

  const resetPassword = useCallback(async (email: string) => {
    if (isDemoMode) {
      throw new Error("This is the demo — there is no real account to reset.");
    }
    await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
  }, []);

  const confirmCode = useCallback(async () => {
    if (isDemoMode || !user) return;
    await settleCode(user, true);
  }, [user, settleCode]);

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
        signUp,
        resetPassword,
        confirmCode,
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
      signUp,
      resetPassword,
      confirmCode,
      signOutNow,
    };
  }, [status, user, demoEmail, signIn, signUp, resetPassword, confirmCode, signOutNow]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
