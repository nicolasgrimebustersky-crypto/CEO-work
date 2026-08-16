/**
 * Tests for quiet hours.
 *
 * The window wraps midnight, which is the single commonest way to get this
 * wrong: written as `hour >= 21 && hour < 7` it is never true, the feature
 * silently does nothing, and the only symptom is a phone that still buzzes at
 * 3am — which reads as "quiet hours are broken" long after anyone would think
 * to look at the comparison.
 *
 * The timezone matters just as much. This decision is made on a Vercel function
 * running in UTC as well as in a browser in Kentucky, and "9pm" resolved
 * against UTC silences the wrong five hours of the day.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const {
  BUSINESS_TIMEZONE,
  QUIET_FROM_HOUR,
  QUIET_UNTIL_HOUR,
  hourInBusinessTimezone,
  isQuietHour,
  quietHoursLabel,
  shouldPushNow,
} = await import("../lib/notifications/quietHours.ts");

/** A moment at a given Eastern hour, expressed in UTC. EST is UTC-5. */
const easternWinter = (hour) =>
  new Date(Date.UTC(2026, 0, 15, (hour + 5) % 24, 30, 0));

describe("reading the local hour", () => {
  test("resolves against Kentucky, not against the server", () => {
    // 02:30 UTC is 21:30 the previous evening in Louisville. A server that
    // reads its own clock sees 2am and gets the answer right by luck; one that
    // reads 14:00 UTC sees 2pm and gets it wrong.
    assert.equal(hourInBusinessTimezone(new Date("2026-01-16T02:30:00Z")), 21);
    assert.equal(hourInBusinessTimezone(new Date("2026-01-15T14:30:00Z")), 9);
  });

  test("midnight reads as zero, not twenty-four", () => {
    // hour12:false yields "24" in some engines, which would fall outside every
    // comparison below and quietly un-silence the quietest hour of the night.
    assert.equal(hourInBusinessTimezone(new Date("2026-01-15T05:30:00Z")), 0);
  });

  test("follows daylight saving without being told", () => {
    // Same UTC instant, six months apart: EST is UTC-5, EDT is UTC-4.
    assert.equal(hourInBusinessTimezone(new Date("2026-01-15T17:00:00Z")), 12);
    assert.equal(hourInBusinessTimezone(new Date("2026-07-15T17:00:00Z")), 13);
  });

  test("the timezone is named rather than inherited", () => {
    assert.equal(BUSINESS_TIMEZONE, "America/New_York");
  });
});

describe("the window", () => {
  test("late evening is quiet", () => {
    assert.equal(isQuietHour(easternWinter(21)), true);
    assert.equal(isQuietHour(easternWinter(23)), true);
  });

  test("the small hours are quiet", () => {
    // The case a non-wrapping comparison gets wrong.
    assert.equal(isQuietHour(easternWinter(0)), true);
    assert.equal(isQuietHour(easternWinter(3)), true);
    assert.equal(isQuietHour(easternWinter(6)), true);
  });

  test("the working day is not", () => {
    for (const hour of [7, 9, 12, 17, 20]) {
      assert.equal(isQuietHour(easternWinter(hour)), false, `${hour}:00 should be loud`);
    }
  });

  test("the boundaries land on the right side", () => {
    assert.equal(isQuietHour(easternWinter(QUIET_UNTIL_HOUR)), false, "7am is awake");
    assert.equal(isQuietHour(easternWinter(QUIET_FROM_HOUR)), true, "9pm is quiet");
    assert.equal(isQuietHour(easternWinter(QUIET_FROM_HOUR - 1)), false, "8pm is awake");
  });

  test("some hour of the day is quiet and some is not", () => {
    // Catches the whole feature being inverted or disabled, which the specific
    // cases above would each still pass if the window were defined backwards.
    const hours = Array.from({ length: 24 }, (_, h) => isQuietHour(easternWinter(h)));
    assert.ok(hours.some(Boolean), "nothing is ever quiet");
    assert.ok(hours.some((q) => !q), "everything is always quiet");
    assert.equal(hours.filter(Boolean).length, 10, "9pm to 7am is ten hours");
  });
});

describe("whether to interrupt somebody", () => {
  test("opting out means any hour is fair game", () => {
    assert.equal(shouldPushNow(false, easternWinter(3)), true);
  });

  test("opting in holds the small hours", () => {
    assert.equal(shouldPushNow(true, easternWinter(3)), false);
    assert.equal(shouldPushNow(true, easternWinter(10)), true);
  });

  test("a profile that predates the setting is treated as opted in", () => {
    // Somebody who has never been asked would rather not be woken.
    assert.equal(shouldPushNow(undefined, easternWinter(3)), false);
    assert.equal(shouldPushNow(null, easternWinter(3)), false);
    assert.equal(shouldPushNow(undefined, easternWinter(10)), true);
  });
});

describe("what the switch says", () => {
  test("reads as a clock, not as numbers", () => {
    assert.equal(quietHoursLabel(), "9pm to 7am");
  });
});
