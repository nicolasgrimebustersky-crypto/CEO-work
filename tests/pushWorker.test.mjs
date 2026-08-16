/**
 * Tests for public/push-sw.js.
 *
 * The push service worker is the one piece of this app that nothing else
 * checks. It is plain JavaScript, so the typechecker never sees it; it runs in
 * a worker, so the browser audits never load it; and when it goes wrong the
 * symptom is a notification that silently does not appear.
 *
 * It is also the piece with a hard rule attached: a subscription is made with
 * `userVisibleOnly`, and a browser that catches a push being handled without a
 * notification being shown revokes the subscription after a few offences. So
 * "always shows something" is not a nicety, it is what keeps push working.
 *
 * The worker is loaded as source and run against a stub `self`, which is close
 * enough to what a browser does with it and needs no browser.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, describe } from "node:test";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "public", "push-sw.js"),
  "utf8",
);

/** Loads the worker and returns its handlers plus whatever it showed. */
function loadWorker() {
  const listeners = {};
  const shown = [];
  const opened = [];

  const self = {
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    location: { origin: "https://grimebusters.example" },
    registration: {
      showNotification: (title, options) => {
        shown.push({ title, ...options });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url) => {
        opened.push(url);
      },
    },
    skipWaiting: () => {},
  };

  new Function("self", source)(self);
  return { listeners, shown, opened, self };
}

/** A push event carrying a body, the way the browser delivers one. */
function pushEvent(payload) {
  const waits = [];
  return {
    waitUntil: (promise) => waits.push(promise),
    data:
      payload === undefined
        ? null
        : {
            json: () => {
              if (typeof payload === "string") throw new Error("not json");
              return payload;
            },
            text: () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
          },
    waits,
  };
}

describe("the push service worker", () => {
  test("registers the handlers a push subscription needs", () => {
    const { listeners } = loadWorker();
    for (const type of ["push", "notificationclick", "install", "activate"]) {
      assert.equal(typeof listeners[type], "function", `no ${type} handler`);
    }
  });

  test("shows what the server sent", () => {
    const { listeners, shown } = loadWorker();
    listeners.push(
      pushEvent({
        data: {
          title: "Payment received",
          body: "Marta Oakley · $1,160.70",
          url: "/invoices/detail?id=d1",
          tag: "payment_received",
        },
      }),
    );

    assert.equal(shown.length, 1);
    assert.equal(shown[0].title, "Payment received");
    assert.equal(shown[0].body, "Marta Oakley · $1,160.70");
    assert.equal(shown[0].tag, "payment_received");
    assert.equal(shown[0].data.url, "/invoices/detail?id=d1");
  });

  test("reads a notification-shaped payload too", () => {
    // Data-only is what this app sends, but a message sent any other way — or
    // by anything else — must not arrive as a blank notification.
    const { listeners, shown } = loadWorker();
    listeners.push(pushEvent({ notification: { title: "Job scheduled", body: "Tomorrow" } }));
    assert.equal(shown[0].title, "Job scheduled");
    assert.equal(shown[0].body, "Tomorrow");
  });

  test("always shows something, whatever arrives", () => {
    // The rule that keeps the subscription alive. Each of these is a payload
    // the worker cannot make sense of, and each must still produce a banner.
    for (const payload of [undefined, "not json at all", {}, { data: {} }]) {
      const { listeners, shown } = loadWorker();
      listeners.push(pushEvent(payload));
      assert.equal(shown.length, 1, `nothing shown for ${JSON.stringify(payload)}`);
      assert.ok(shown[0].title, `no title for ${JSON.stringify(payload)}`);
    }
  });

  test("a payload with no url still lands somewhere real", () => {
    const { listeners, shown } = loadWorker();
    listeners.push(pushEvent({ data: { title: "Something", body: "" } }));
    assert.match(shown[0].data.url, /^\//);
  });

  test("tapping one opens a window when the app is closed", async () => {
    const { listeners, opened } = loadWorker();
    const waits = [];
    listeners.notificationclick({
      notification: { close: () => {}, data: { url: "/customers/detail?id=c1" } },
      waitUntil: (promise) => waits.push(promise),
    });
    await Promise.all(waits);

    assert.equal(opened.length, 1);
    assert.equal(opened[0], "https://grimebusters.example/customers/detail?id=c1");
  });

  test("tapping one focuses the app when it is already open", async () => {
    const { listeners, self } = loadWorker();
    const navigated = [];
    let focused = false;
    self.clients.matchAll = async () => [
      {
        url: "https://grimebusters.example/map",
        focus: () => {
          focused = true;
        },
        navigate: (url) => {
          navigated.push(url);
          return Promise.resolve();
        },
      },
    ];

    const waits = [];
    listeners.notificationclick({
      notification: { close: () => {}, data: { url: "/schedule" } },
      waitUntil: (promise) => waits.push(promise),
    });
    await Promise.all(waits);

    assert.deepEqual(navigated, ["https://grimebusters.example/schedule"]);
    assert.equal(focused, true);
  });

  test("a client that refuses to navigate is still focused", async () => {
    // navigate() rejects if the client is mid-navigation. Focusing is the part
    // that matters, so it must not be chained behind it.
    const { listeners, self } = loadWorker();
    let focused = false;
    self.clients.matchAll = async () => [
      {
        url: "https://grimebusters.example/map",
        focus: () => {
          focused = true;
        },
        navigate: () => Promise.reject(new Error("busy")),
      },
    ];

    const waits = [];
    listeners.notificationclick({
      notification: { close: () => {}, data: { url: "/schedule" } },
      waitUntil: (promise) => waits.push(promise),
    });
    await Promise.all(waits);

    assert.equal(focused, true);
  });
});
