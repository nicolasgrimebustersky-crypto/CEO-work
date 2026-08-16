"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  markAllRead,
  markRead,
  notifyOthers,
  subscribeNotifications,
  type AppNotification,
  type NotifyPayload,
} from "@/lib/db/notifications";
import { refreshPushToken } from "@/lib/push/client";
import { useAuth } from "./AuthProvider";
import { useTeam } from "./TeamProvider";

interface NotificationsContextValue {
  items: AppNotification[];
  unreadCount: number;
  error: string | null;
  markOneRead: (id: string) => Promise<void>;
  markEverythingRead: () => Promise<void>;
  /** Raises an event for everyone else on the crew. See lib/notifications/events.ts. */
  notify: (payload: NotifyPayload) => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { users, author } = useTeam();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const uid = author?.uid ?? null;

  useEffect(() => {
    if (status !== "signed-in" || !uid) {
      setItems([]);
      return;
    }
    return subscribeNotifications(
      uid,
      (next) => {
        setItems(next);
        setError(null);
      },
      (err) => setError(err.message),
    );
  }, [status, uid]);

  /**
   * Keep this device's push registration current.
   *
   * Silent and prompt-free — it does nothing at all unless permission has
   * already been granted. Browsers rotate push tokens on their own schedule, and
   * without a refresh on sign-in push would work for a few weeks after somebody
   * switched it on and then stop with no error anywhere.
   */
  useEffect(() => {
    if (status !== "signed-in" || !uid) return;
    void refreshPushToken(uid);
  }, [status, uid]);

  const markOneRead = useCallback((id: string) => markRead(id), []);
  const markEverythingRead = useCallback(() => markAllRead(items), [items]);

  /**
   * Call sites pass the event and the specifics; the roster, the actor and the
   * recipients' muted categories are supplied from here. That is the whole
   * reason this lives on the provider rather than being imported directly — a
   * screen that has to remember to fetch the crew list before it can tell
   * anybody anything is a screen that will eventually forget.
   */
  const notify = useCallback(
    async (payload: NotifyPayload) => {
      if (!author) return;
      try {
        await notifyOthers(users, author, payload);
      } catch {
        // Never fail the action that raised it. The job is already saved; a
        // notification that did not send is not worth an error on a phone
        // held at arm's length in a driveway.
      }
    },
    [users, author],
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      items,
      unreadCount: items.filter((item) => item.readAt === null).length,
      error,
      markOneRead,
      markEverythingRead,
      notify,
    }),
    [items, error, markOneRead, markEverythingRead, notify],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    return {
      items: [],
      unreadCount: 0,
      error: null,
      markOneRead: async () => {},
      markEverythingRead: async () => {},
      notify: async () => {},
    };
  }
  return ctx;
}

/**
 * Just the raising half, for the many screens that announce things without
 * displaying anything.
 */
export function useNotify(): (payload: NotifyPayload) => Promise<void> {
  return useNotifications().notify;
}
