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
  subscribeNotifications,
  type AppNotification,
} from "@/lib/db/notifications";
import { useAuth } from "./AuthProvider";

interface NotificationsContextValue {
  items: AppNotification[];
  unreadCount: number;
  error: string | null;
  markOneRead: (id: string) => Promise<void>;
  markEverythingRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status, author } = useAuth();
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

  const markOneRead = useCallback((id: string) => markRead(id), []);
  const markEverythingRead = useCallback(() => markAllRead(items), [items]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      items,
      unreadCount: items.filter((item) => item.readAt === null).length,
      error,
      markOneRead,
      markEverythingRead,
    }),
    [items, error, markOneRead, markEverythingRead],
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
    };
  }
  return ctx;
}
