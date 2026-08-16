"use client";

import Link from "next/link";
import { useState } from "react";

import { useNotifications } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { UserChip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { notificationLink } from "@/lib/db/notifications";
import { formatRelative } from "@/lib/format";
import { CATEGORY_LABEL, categoryOf } from "@/lib/notifications/events";

/**
 * Everything that happened while you were not looking, newest first.
 *
 * This is the in-app half of the notification system and it is a pull surface
 * on purpose — a toast that covers the map while someone is mid-knock is worse
 * than a badge they check between houses. The push notification is the half
 * that interrupts, and it only fires on a device that asked for it. See
 * lib/push/client.ts.
 */
export function NotificationBell() {
  const { items, unreadCount, markEverythingRead, markOneRead, error } =
    useNotifications();
  const { colorFor } = useTeam();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
        }
        className="tap-target relative flex size-12 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink"
      >
        <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
          <path
            d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d="M10 19a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-extrabold text-accent-ink">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      <Sheet
        open={open}
        title="Notifications"
        onClose={() => setOpen(false)}
        footer={
          <Button
            variant="secondary"
            full
            onClick={() => void markEverythingRead()}
            disabled={unreadCount === 0}
          >
            Mark all read
          </Button>
        }
      >
        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error.includes("index")
              ? "Notifications need a Firestore index. Run: npx firebase deploy --only firestore:indexes"
              : error}
          </p>
        ) : null}

        {items.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
            Nothing yet. Jobs, payments, new customers, texts back and Facebook
            leads all land here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const unread = item.readAt === null;
              const inner = (
                <>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <UserChip name={item.actorName} color={colorFor(item.actorUid)} />
                    <span className="text-sm font-bold text-muted">
                      {CATEGORY_LABEL[categoryOf(item.type)]}
                    </span>
                    {unread ? (
                      <span className="size-2.5 rounded-full bg-accent" aria-label="Unread" />
                    ) : null}
                  </div>
                  <p className="text-base font-bold text-ink">{item.title}</p>
                  <p className="text-base text-muted">{item.body}</p>
                  <p className="mt-1 text-sm font-semibold text-muted">
                    {formatRelative(item.createdAt)}
                  </p>
                </>
              );

              return (
                <li
                  key={item.id}
                  className={`rounded-xl border p-3 ${
                    unread ? "border-accent/60 bg-surface-2" : "border-line bg-surface-2"
                  }`}
                >
                  {/* Every event type resolves to a screen — a payment opens the
                      invoice, a reschedule opens the calendar. */}
                  <Link
                    href={notificationLink(item)}
                    onClick={() => {
                      void markOneRead(item.id);
                      setOpen(false);
                    }}
                    className="block"
                  >
                    {inner}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </>
  );
}
