"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { isAdmin, isCrew } from "@/lib/auth/roles";
import { isDemoMode } from "@/lib/demo/enabled";
import { subscribeUsers } from "@/lib/db/users";
import { buildUserColorMap, colorForUser, FALLBACK_USER_COLOR } from "@/lib/userColor";
import type { AppUser, Author } from "@/lib/types";
import { useAuth } from "./AuthProvider";

interface TeamContextValue {
  /**
   * The crew. Pending registrations are deliberately not in here — every
   * consumer of this list treats it as "people who can be given work", and a
   * stranger awaiting approval must not appear in an assignment picker, on the
   * map, or in the colour legend.
   */
  users: AppUser[];
  /** Registered but not approved. Only the Account screen cares. */
  pendingUsers: AppUser[];
  /** Can the signed-in person grant and remove other people's access? */
  isAdmin: boolean;
  me: AppUser | null;
  /** Canonical stamp for writes — prefers the editable profile name. */
  author: Author | null;
  colorFor: (uid: string | null | undefined) => string;
  nameFor: (uid: string | null | undefined) => string;
  error: string | null;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export function TeamProvider({ children }: { children: ReactNode }) {
  const { status, author: authAuthor, email } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signed-in") {
      setUsers([]);
      return;
    }
    return subscribeUsers(
      (next) => {
        setUsers(next);
        setError(null);
      },
      (err) => setError(err.message),
    );
  }, [status]);

  const value = useMemo<TeamContextValue>(() => {
    // The signed-in person's own email decides admin; everybody else in the
    // roster is judged on their stored role alone.
    //
    // The demo has no real accounts and its user is the owner persona, so the
    // approvals screen is shown there — a preview that hides a feature is not
    // showing the product. Nothing in the demo is written anywhere.
    const amAdmin = isDemoMode || isAdmin(email);
    const isMe = (user: AppUser) => user.uid === authAuthor?.uid;
    const allowed = (user: AppUser) =>
      isCrew(user.uid, user.role, isMe(user) ? email : null);

    const crew = users.filter(allowed);
    const pendingUsers = users.filter((user) => !allowed(user));
    const colorMap = buildUserColorMap(crew);
    const me = crew.find((u) => u.uid === authAuthor?.uid) ?? null;

    return {
      users: crew,
      pendingUsers,
      isAdmin: amAdmin,
      me,
      author: authAuthor
        ? { uid: authAuthor.uid, displayName: me?.displayName ?? authAuthor.displayName }
        : null,
      colorFor: (uid) => colorForUser(uid, colorMap),
      nameFor: (uid) => {
        if (!uid) return "Unknown";
        return users.find((u) => u.uid === uid)?.displayName ?? "Unknown";
      },
      error,
    };
  }, [users, authAuthor, email, error]);

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam(): TeamContextValue {
  const ctx = useContext(TeamContext);
  if (!ctx) {
    return {
      users: [],
      pendingUsers: [],
      isAdmin: false,
      me: null,
      author: null,
      colorFor: () => FALLBACK_USER_COLOR,
      nameFor: () => "Unknown",
      error: null,
    };
  }
  return ctx;
}
