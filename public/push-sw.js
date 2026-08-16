/*
 * The push service worker.
 *
 * Registered at the /gb-push-scope scope by lib/push/client.ts, so it sits
 * alongside the next-pwa offline worker at / instead of evicting it.
 *
 * It does not load the Firebase SDK. The usual recipe importScripts() ~100KB of
 * firebase-messaging-compat on every wake just to unwrap a JSON body — but a
 * message sent as data-only arrives at the standard `push` event with the
 * payload right there, and the browser has to start this worker either way. So
 * this is the whole thing: read it, show it, open the right screen when it is
 * tapped.
 *
 * Every push MUST result in a visible notification. Subscriptions are made with
 * userVisibleOnly, and a browser that sees a push handled silently will revoke
 * the subscription after a few offences — which is why the catch-all at the end
 * still shows something rather than returning quietly.
 */

const FALLBACK = {
  title: "Grime Busters",
  body: "Something happened in the app.",
  url: "/dashboard",
};

/**
 * FCM delivers data-only messages as `{ data: {...} }`, but a message sent with
 * a notification block arrives shaped differently, and a raw Web Push from
 * anything else could be either. Read all three shapes rather than assuming the
 * sender we happen to use today.
 */
function readPayload(event) {
  if (!event.data) return FALLBACK;
  let raw;
  try {
    raw = event.data.json();
  } catch {
    return { ...FALLBACK, body: event.data.text() || FALLBACK.body };
  }

  const fields = raw.data || raw.notification || raw || {};
  return {
    title: fields.title || FALLBACK.title,
    body: fields.body || "",
    url: fields.url || FALLBACK.url,
    tag: fields.tag || "grime-busters",
  };
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Same tag per event type, so five payments landing in a minute collapse
      // into one line on the lock screen instead of burying everything else.
      tag: payload.tag,
      renotify: true,
      data: { url: payload.url },
    }),
  );
});

/**
 * Tapping it should land on the thing it is about — and in the window that is
 * already open, if there is one. Opening a second copy of a PWA leaves the
 * first one behind with stale state and is jarring on a phone.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || FALLBACK.url,
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (new URL(client.url).origin === self.location.origin && "focus" in client) {
            // navigate() can reject if the client is mid-navigation; focusing
            // is the part that matters, so it must not depend on it.
            return Promise.resolve(client.navigate(target))
              .catch(() => undefined)
              .then(() => client.focus());
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});

// A fresh worker should take over immediately rather than waiting for every tab
// to close: this one has no cached assets to invalidate, so there is nothing to
// be careful about.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
