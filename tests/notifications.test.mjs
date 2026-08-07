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
    "schedule",
    "pipeline",
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
    const known = new Set(["customer", "document", "invoices", "schedule", "pipeline"]);
    for (const type of NOTIFICATION_TYPES) {
      assert.ok(
        known.has(NOTIFICATION_EVENTS[type].destination),
        `${type} points at an unknown destination`,
      );
    }
  });
});
