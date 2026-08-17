"use client";

import { useCallback, useEffect, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { setMutedNotifications, setQuietHours } from "@/lib/db/users";
import {
  CATEGORY_HINT,
  CATEGORY_LABEL,
  NOTIFICATION_CATEGORIES,
  allowsCategory,
  wantsCategory,
  type NotificationCategory,
} from "@/lib/notifications/events";
import { quietHoursLabel } from "@/lib/notifications/quietHours";
import { disablePush, enablePush, pushStatus, type PushStatus } from "@/lib/push/client";

/**
 * Notification settings.
 *
 * Two separate questions, and keeping them apart is the point:
 *
 *   Which events do I care about?   — per account, applies to both devices
 *   Should this phone buzz?         — per device, because permission is
 *                                     granted per browser and per install
 *
 * Muting is stored on the profile and honoured by whoever raises the event, so
 * a muted category is never written at all rather than being written and
 * hidden. That is what keeps the badge count honest.
 */
export function NotificationSettings() {
  const { me, author } = useTeam();

  const [status, setStatus] = useState<PushStatus | null>(null);
  const [working, setWorking] = useState(false);
  const [muteError, setMuteError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void pushStatus().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const togglePush = useCallback(async () => {
    if (!author) return;
    setWorking(true);
    try {
      setStatus(status?.enabled ? await disablePush() : await enablePush(author.uid));
    } finally {
      setWorking(false);
    }
  }, [author, status?.enabled]);

  const toggleCategory = useCallback(
    async (category: NotificationCategory) => {
      if (!author || !me) return;
      const muted = me.mutedNotifications ?? [];
      const next = muted.includes(category)
        ? muted.filter((entry) => entry !== category)
        : [...muted, category];

      setMuteError(null);
      try {
        // The roster listener writes the new value back into `me`, so there is
        // no local copy here to drift out of step with what was saved.
        await setMutedNotifications(
          author.uid,
          next.filter((entry): entry is NotificationCategory =>
            (NOTIFICATION_CATEGORIES as readonly string[]).includes(entry),
          ),
        );
      } catch (err) {
        setMuteError(err instanceof Error ? err.message : "Could not save that.");
      }
    },
    [author, me],
  );

  const muted = me?.mutedNotifications ?? [];
  // What the admin has granted. Categories outside this are not switches this
  // person can flip, so they are listed as unavailable rather than hidden —
  // silently missing settings read as a bug, and somebody who expected an
  // alert needs to know it was a permission, not a fault.
  const scopes = me?.notificationScopes;
  const allowed = NOTIFICATION_CATEGORIES.filter((category) =>
    allowsCategory(scopes, category),
  );
  const withheld = NOTIFICATION_CATEGORIES.filter(
    (category) => !allowsCategory(scopes, category),
  );

  return (
    <section>
      <h2 className="mb-2 text-lg font-bold text-ink">Notifications</h2>

      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-ink">
              {status?.enabled ? "This device is on" : "Push on this device"}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-muted">
              {status?.message ?? "Checking…"}
            </p>
          </div>

          {status && status.blocker === null ? (
            <button
              type="button"
              role="switch"
              aria-checked={status.enabled}
              aria-label="Push notifications on this device"
              disabled={working}
              onClick={() => void togglePush()}
              className={`tap-target relative flex w-16 shrink-0 items-center rounded-full p-1 transition ${
                status.enabled ? "bg-accent" : "bg-surface-3"
              } ${working ? "opacity-60" : ""}`}
            >
              <span
                className={`size-8 rounded-full bg-white transition-transform ${
                  status.enabled ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          ) : null}
        </div>

        {/* A blocked permission cannot be re-asked from script — the browser
            ignores the prompt for good. Retrying is the only thing that can
            help once it has been changed in the OS. */}
        {status?.blocker === "denied" ? (
          <Button
            variant="secondary"
            full
            className="mt-3"
            onClick={() => void pushStatus().then(setStatus)}
          >
            I&apos;ve allowed it — check again
          </Button>
        ) : null}
      </div>

      {/* Holds the buzz, not the notification. Worth saying on the switch:
          somebody who thinks overnight events are being dropped will turn this
          straight back off. */}
      <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
        <div className="min-w-0">
          <p className="text-base font-bold text-ink">Quiet hours</p>
          <p className="mt-0.5 text-sm font-semibold text-muted">
            {me?.quietHours === false
              ? `Your phone buzzes at any hour, including ${quietHoursLabel()}.`
              : `Nothing buzzes between ${quietHoursLabel()}. It still lands in the bell, so it's waiting for you in the morning.`}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={me?.quietHours !== false}
          aria-label="Quiet hours"
          disabled={!author}
          onClick={() => {
            if (author) void setQuietHours(author.uid, me?.quietHours === false);
          }}
          className={`tap-target relative flex w-16 shrink-0 items-center rounded-full p-1 transition ${
            me?.quietHours !== false ? "bg-accent" : "bg-surface-3"
          }`}
        >
          <span
            className={`size-8 rounded-full bg-white transition-transform ${
              me?.quietHours !== false ? "translate-x-6" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <p className="mt-4 mb-2 text-sm font-bold tracking-wide text-muted uppercase">
        What to tell me about
      </p>

      <ul className="flex flex-col gap-2">
        {allowed.map((category) => {
          const on = wantsCategory(muted, category);
          return (
            <li
              key={category}
              className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3"
            >
              <div className="min-w-0">
                <p className="text-base font-bold text-ink">
                  {CATEGORY_LABEL[category]}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-muted">
                  {CATEGORY_HINT[category]}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={CATEGORY_LABEL[category]}
                disabled={!author}
                onClick={() => void toggleCategory(category)}
                className={`tap-target relative flex w-16 shrink-0 items-center rounded-full p-1 transition ${
                  on ? "bg-accent" : "bg-surface-3"
                }`}
              >
                <span
                  className={`size-8 rounded-full bg-white transition-transform ${
                    on ? "translate-x-6" : "translate-x-0"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>

      {withheld.length > 0 ? (
        <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-base font-bold text-ink">Not available to you</p>
          <p className="mt-0.5 text-sm font-semibold text-muted">
            {withheld.map((category) => CATEGORY_LABEL[category]).join(", ")} —
            ask the admin if you need these.
          </p>
        </div>
      ) : null}

      {muteError ? (
        <p
          role="alert"
          className="mt-2 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
        >
          {muteError}
        </p>
      ) : null}

      <p className="mt-2 text-sm font-semibold text-muted">
        Switching one off applies to both your phone and the bell in the app.
        The other crew member&apos;s settings are their own.
      </p>
    </section>
  );
}
