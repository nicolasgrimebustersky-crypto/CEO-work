/**
 * Tests for the link out to the phone's maps app.
 *
 * Two things here are easy to get subtly wrong and annoying to discover in a
 * driveway: sending an iPhone to Google Maps, and sending anybody to 0,0 in
 * the Atlantic because a pin was never geocoded.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { canNavigateTo, directionsUrl, isApplePlatform } = await import(
  "../lib/maps.ts"
);

const PIN = { lat: 38.4076, lng: -85.3791, address: "204 Covered Bridge Rd" };

describe("which maps app", () => {
  test("an iPhone gets Apple Maps", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
    assert.equal(isApplePlatform(ua), true);
  });

  test("an iPad gets Apple Maps, including when it claims to be a Mac", () => {
    // iPadOS 13+ reports "Macintosh" and is otherwise indistinguishable from a
    // desktop Mac. Both want Apple Maps, so this is safe either way.
    assert.equal(isApplePlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), true);
    assert.equal(
      isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
      true,
    );
  });

  test("Android and Windows do not", () => {
    assert.equal(isApplePlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), false);
    assert.equal(isApplePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
  });

  test("a missing user agent is not Apple", () => {
    assert.equal(isApplePlatform(null), false);
    assert.equal(isApplePlatform(undefined), false);
    assert.equal(isApplePlatform(""), false);
  });
});

describe("the link itself", () => {
  test("Apple gets an apple.com link that opens the Maps app", () => {
    const url = directionsUrl(PIN, { apple: true });
    assert.match(url, /^https:\/\/maps\.apple\.com\//);
    assert.match(url, /daddr=38\.4076%2C-85\.3791/);
  });

  test("it asks for driving directions explicitly", () => {
    // Without this, Apple Maps may open in whichever mode was used last, and a
    // walking route across a county is not useful.
    assert.match(directionsUrl(PIN, { apple: true }), /dirflg=d/);
  });

  test("everybody else gets Google Maps", () => {
    const url = directionsUrl(PIN);
    assert.match(url, /^https:\/\/www\.google\.com\/maps\/dir\//);
    assert.match(url, /destination=38\.4076%2C-85\.3791/);
  });

  test("it is https, so it still resolves off-device", () => {
    // The maps:// scheme opens nothing on a desktop. https degrades to a web
    // page instead of failing silently.
    for (const url of [directionsUrl(PIN, { apple: true }), directionsUrl(PIN)]) {
      assert.match(url, /^https:/);
    }
  });
});

describe("where it sends you", () => {
  test("coordinates win over the written address", () => {
    // A pin dropped at the back of a long driveway is exactly where the crew
    // stood; re-geocoding the street can land the driver at the wrong end.
    assert.match(directionsUrl(PIN, { apple: true }), /38\.4076/);
    assert.doesNotMatch(directionsUrl(PIN, { apple: true }), /Covered/);
  });

  test("the address is used when there is no fix", () => {
    const url = directionsUrl({ address: "204 Covered Bridge Rd, La Grange KY" });
    assert.match(url, /Covered%20Bridge/);
  });

  test("an un-geocoded pin at 0,0 falls back to the address", () => {
    // 0,0 is in the Atlantic. Navigating there is worse than useless.
    const url = directionsUrl({ lat: 0, lng: 0, address: "204 Covered Bridge Rd" });
    assert.match(url, /Covered/);
    assert.doesNotMatch(url, /0%2C0/);
  });

  test("nowhere to go returns null rather than an empty map", () => {
    assert.equal(directionsUrl({ lat: 0, lng: 0, address: "" }), null);
    assert.equal(directionsUrl({}), null);
    assert.equal(directionsUrl({ address: "   " }), null);
  });

  test("NaN coordinates are not a location", () => {
    assert.equal(directionsUrl({ lat: NaN, lng: NaN, address: "" }), null);
  });

  test("canNavigateTo agrees with the link", () => {
    // The caller hides the button on this, so the two must never disagree.
    for (const d of [PIN, { address: "somewhere" }, { lat: 0, lng: 0 }, {}]) {
      assert.equal(canNavigateTo(d), directionsUrl(d) !== null);
    }
  });

  test("an address with a comma and spaces survives encoding", () => {
    const url = directionsUrl({ address: "88 Ridgemoor Way, La Grange, KY 40031" });
    assert.ok(!url.includes(" "), "a raw space would break the link");
    assert.match(url, /Ridgemoor/);
  });
});
