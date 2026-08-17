/**
 * Tests for the notification catalogue.
 *
 * Two things here can break silently, which is what makes them worth pinning.
 *
 * A notification nobody receives looks identical to a notification nobody
 * raised — there is no error, no log line, and no badge. So the recipient
 * filter is tested directly, including the default-on behaviour for an event
 * type that did not exist when somebody last opened their settings.
 *
 * And every event has to resolve to a screen. A notification that opens nothing
 * is worse than no notification: you have already picked up the phone.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENTS,
  NOTIFICATION_TYPES,
  CATEGORY_LABEL,
  CATEGORY_HINT,
  categoryOf,
  isNotificationType,
  isNotificationCategory,
  destinationFor,
  recipientsFor,
  titleOf,
  wantsCategory,
  allowsCategory,
  receivesCategory,
  receivesEvent,
} = await import("../lib/notifications/events.ts");

describe("the catalogue", () => {
  test("covers every area of the app, not just the schedule", () => {
    // The five job types were the whole system before this. If a future edit
    // narrows it back to one area, that is a regression, not a simplification.
    const covered = new Set(NOTIFICATION_TYPES.map(categoryOf));
    for (const category of NOTIFICATION_CATEGORIES) {
      assert.ok(covered.has(category), `no event raises a "${category}" notification`);
    }
  });

  test("every event has a title, a real category and a label", () => {
    for (const type of NOTIFICATION_TYPES) {
      assert.ok(titleOf(type).length > 0, `${type} has no title`);
      assert.ok(isNotificationCategory(categoryOf(type)), `${type} has a bogus category`);
    }
    for (const category of NOTIFICATION_CATEGORIES) {
      assert.ok(CATEGORY_LABEL[category], `${category} has no label`);
      assert.ok(CATEGORY_HINT[category], `${category} has no hint`);
    }
  });

  test("titles are the event, not the specifics", () => {
    // The body carries the name and the amount. A title with a colon or a
    // digit in it is a sign somebody has started formatting data into the one
    // string that is supposed to be fixed per event.
    for (const type of NOTIFICATION_TYPES) {
      assert.doesNotMatch(titleOf(type), /[:$\d]/, `${type}'s title carries specifics`);
    }
  });

  test("an unknown type is rejected rather than crashing a render", () => {
    assert.equal(isNotificationType("job_created"), true);
    assert.equal(isNotificationType("something_else"), false);
    assert.equal(isNotificationType(undefined), false);
  });
});

describe("where a notification lands", () => {
  const SCREENS = new Set([
    "customer",
    "customers",
    "document",
    "invoices",
    "knockRoutes",
    "schedule",
    "pipeline",
    "chat",
    "chatThread",
  ]);

  test("every event resolves to a screen the app has", () => {
    for (const type of NOTIFICATION_TYPES) {
      const target = destinationFor({ type, customerId: "c1", documentId: "d1" });
      assert.ok(SCREENS.has(target.screen), `${type} points nowhere`);
    }
  });

  test("money opens the document it is about", () => {
    assert.deepEqual(
      destinationFor({ type: "payment_received", customerId: "c1", documentId: "d1" }),
      { screen: "document", id: "d1" },
    );
  });

  test("a missing id degrades to a screen rather than a broken link", () => {
    // Documents get deleted. The notification about one outlives it.
    assert.deepEqual(
      destinationFor({ type: "payment_received", customerId: "c1", documentId: null }),
      { screen: "customer", id: "c1" },
    );
    assert.deepEqual(
      destinationFor({ type: "payment_received", customerId: null, documentId: null }),
      { screen: "invoices" },
    );
    assert.deepEqual(
      destinationFor({ type: "customer_added", customerId: null, documentId: null }),
      { screen: "customers" },
    );
  });

  test("schedule events open the calendar, not a customer", () => {
    assert.deepEqual(
      destinationFor({ type: "job_rescheduled", customerId: "c1", documentId: null }),
      { screen: "schedule" },
    );
  });
});

describe("who gets told", () => {
  const crew = [
    { uid: "alice", mutedNotifications: [] },
    { uid: "bob", mutedNotifications: ["money"] },
  ];

  test("never the person who did it", () => {
    assert.deepEqual(recipientsFor(crew, "alice", "job_created"), ["bob"]);
    assert.deepEqual(recipientsFor(crew, "bob", "job_created"), ["alice"]);
  });

  test("a muted category is not written at all", () => {
    // Filtered at the sending end on purpose: writing it and hiding it would
    // still climb the unread badge for something they asked not to hear about.
    assert.deepEqual(recipientsFor(crew, "alice", "payment_received"), []);
    assert.deepEqual(recipientsFor(crew, "alice", "job_completed"), ["bob"]);
  });

  test("muting money does not mute the schedule", () => {
    assert.equal(wantsCategory(["money"], "jobs"), true);
    assert.equal(wantsCategory(["money"], "money"), false);
  });

  test("an event type nobody has heard of still reaches everyone", () => {
    // Stored as the exceptions rather than the selections, so a category added
    // after somebody last opened their settings is on rather than off.
    assert.equal(wantsCategory(["money"], "a_category_from_next_year"), true);
    assert.equal(wantsCategory(undefined, "leads"), true);
    assert.equal(wantsCategory(null, "leads"), true);
  });

  test("a profile with no preference set behaves as everything on", () => {
    const fresh = [{ uid: "carol" }];
    for (const type of NOTIFICATION_TYPES) {
      assert.deepEqual(recipientsFor(fresh, "alice", type), ["carol"]);
    }
  });

  test("a server-raised event with no actor still reaches both", () => {
    // Nobody tapped anything when a customer texts back, so nothing is excluded.
    assert.deepEqual(recipientsFor(crew, null, "sms_in"), ["alice", "bob"]);
  });
});

describe("the shape the demo and the server both rely on", () => {
  test("destinations are limited to screens that exist", () => {
    const known = new Set([
      "customer",
      "document",
      "invoices",
      "knockRoutes",
      "schedule",
      "pipeline",
      "chat",
    ]);
    for (const type of NOTIFICATION_TYPES) {
      assert.ok(
        known.has(NOTIFICATION_EVENTS[type].destination),
        `${type} points at an unknown destination`,
      );
    }
  });
});


/* ------------------------------------------------- granted vs. chosen */

describe("what the admin allows, and what you choose", () => {
  test("no scope stored means everything is allowed", () => {
    // A profile written before scopes existed must not silently stop hearing
    // about the job it was just assigned. Somebody who quietly stops being
    // told anything, and does not know why, is the worst failure this system
    // has — so restricting is always an explicit act.
    for (const category of NOTIFICATION_CATEGORIES) {
      assert.equal(allowsCategory(undefined, category), true);
      assert.equal(allowsCategory(null, category), true);
    }
  });

  test("an empty list means nothing is allowed", () => {
    // Distinct from absent. "Granted nothing" is a real state the admin can
    // choose, and conflating it with "not restricted yet" would make the
    // last toggle silently do the opposite of what it says.
    for (const category of NOTIFICATION_CATEGORIES) {
      assert.equal(allowsCategory([], category), false);
    }
  });

  test("only the listed categories are allowed", () => {
    assert.equal(allowsCategory(["money"], "money"), true);
    assert.equal(allowsCategory(["money"], "jobs"), false);
  });

  test("granted and muted is not received", () => {
    // Two different questions. Being allowed something you switched off still
    // means you do not get it.
    assert.equal(receivesCategory(["money"], ["money"], "money"), false);
    assert.equal(receivesCategory(["money"], [], "money"), true);
  });

  test("un-muting cannot beat a missing grant", () => {
    // The permission has to win, or the preference would be a way around it.
    assert.equal(receivesCategory([], [], "money"), false);
    assert.equal(receivesCategory(["jobs"], [], "money"), false);
  });

  test("events follow their category", () => {
    assert.equal(receivesEvent(["money"], [], "payment_received"), true);
    assert.equal(receivesEvent(["jobs"], [], "payment_received"), false);
  });
});

describe("who actually gets sent it", () => {
  const crew = [
    { uid: "admin" },
    { uid: "restricted", notificationScopes: ["jobs"] },
    { uid: "muted", mutedNotifications: ["money"] },
    { uid: "granted", notificationScopes: ["money", "jobs"] },
  ];

  test("a scope the admin never granted drops the recipient", () => {
    const got = recipientsFor(crew, "nobody", "payment_received");
    assert.ok(got.includes("admin"), "no scope stored means everything");
    assert.ok(got.includes("granted"));
    assert.ok(!got.includes("restricted"), "money was never granted");
    assert.ok(!got.includes("muted"), "money was muted");
  });

  test("the actor is still never notified about their own tap", () => {
    assert.ok(!recipientsFor(crew, "admin", "payment_received").includes("admin"));
  });

  test("filtering happens at the sending end", () => {
    // A notification nobody may receive must not be written at all, or the
    // unread badge climbs for something the person cannot even open.
    assert.deepEqual(
      recipientsFor([{ uid: "restricted", notificationScopes: [] }], null, "payment_received"),
      [],
    );
  });
});


describe("a chat notification opens the thread", () => {
  test("straight into the conversation when we know which", () => {
    // Landing on the list instead would leave the notification one tap short
    // of the thing it is telling you about.
    assert.deepEqual(
      destinationFor({ type: "chat_message", conversationId: "conv1" }),
      { screen: "chatThread", id: "conv1" },
    );
  });

  test("the list when we do not", () => {
    assert.deepEqual(destinationFor({ type: "chat_message" }), { screen: "chat" });
  });

  test("chat is its own category, separate from customer texts", () => {
    // One is the crew talking to each other and costs nothing; the other goes
    // out over SMS to a customer. Being able to mute one and not the other is
    // the point of keeping them apart.
    assert.equal(categoryOf("chat_message"), "chat");
    assert.equal(categoryOf("sms_in"), "messages");
  });
});
