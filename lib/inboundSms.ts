/**
 * Texts from numbers we don't have on file.
 *
 * Until now the inbound webhook filed every reply onto the matching customer's
 * notes timeline, and the Messages screen read the threads back out of those
 * notes. That works for anybody already on the books and silently loses
 * everybody else: `findCustomerByPhone` returned null, the handler logged a
 * warning and returned 200, and the message existed nowhere a person could
 * look.
 *
 * The cases that hit it are not edge cases. A lead who was sent an estimate
 * link and texts back from a different handset. A spouse answering from their
 * own phone. A number taken down at the door with a digit wrong, so the record
 * we hold and the phone that replies do not match. A brand new customer texting
 * the business number off a yard sign. Every one of those is somebody trying to
 * give us money, and every one of them vanished.
 *
 * So unmatched messages are now stored, and this module is the part that
 * decides how they read. Pure and import-free so both halves can be tested by
 * running them — which matters because the failure being fixed was itself
 * invisible, and a test is the only thing that stays suspicious about that.
 */

/** Just enough of a Timestamp to sort and render. Firestore's satisfies this. */
interface TimeLike {
  toMillis(): number;
}

export interface UnmatchedMessage {
  id: string;
  /** As Twilio gave it, normally E.164. */
  from: string;
  body: string;
  receivedAt: TimeLike;
  /** Set once somebody has turned it into a customer or dismissed it. */
  handled: boolean;
}

/**
 * Generic over the message so a caller holding richer rows — Firestore
 * Timestamps rather than the bare `toMillis` this module needs — gets them back
 * unflattened. The grouping only ever reads `from`, `receivedAt` and `handled`;
 * whatever else the caller carries is its own business and survives the trip.
 */
export interface UnmatchedThread<T extends UnmatchedMessage = UnmatchedMessage> {
  /** The last ten digits — what "the same person" means here. */
  key: string;
  /** The number as it arrived, for dialling and for display. */
  from: string;
  /** Oldest first, the way a conversation reads. */
  messages: T[];
  last: T;
}

/**
 * The last ten digits of a US number, or "" if it isn't one.
 *
 * The same rule `findCustomerByPhone` uses on the server, and deliberately so:
 * if the two ever disagreed, a message could be filed as unmatched while a
 * customer record for that very number sat in the list. Ten digits ignores the
 * country code, which is what makes "+15025550147" and "(502) 555-0147" the
 * same person.
 */
export function phoneKey(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : "";
}

/** "(502) 555-0147", or the raw string back if it isn't a ten-digit number. */
export function formatPhone(raw: string): string {
  const key = phoneKey(raw);
  if (!key) return String(raw ?? "");
  return `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}`;
}

/**
 * One thread per unknown number, most recently active first.
 *
 * Grouped rather than listed flat because somebody who texts three times is one
 * person to call back, not three rows to work through. Handled messages drop
 * out entirely: once a number has become a customer its history lives on that
 * customer's timeline, and leaving a copy here would be a second place for the
 * same conversation to live — the exact thing lib/threads.ts avoids.
 */
export function groupUnmatched<T extends UnmatchedMessage>(
  messages: readonly T[],
): UnmatchedThread<T>[] {
  const byNumber = new Map<string, T[]>();

  for (const message of messages) {
    if (message.handled) continue;
    // A number we cannot key on is still a real message from a real person, so
    // it is kept under its raw form rather than dropped. Losing these quietly
    // is the bug this module exists to fix; doing it again here would be a poor
    // joke.
    const key = phoneKey(message.from) || String(message.from ?? "");
    if (!key) continue;
    const bucket = byNumber.get(key);
    if (bucket) bucket.push(message);
    else byNumber.set(key, [message]);
  }

  const threads: UnmatchedThread<T>[] = [];
  for (const [key, bucket] of byNumber) {
    const sorted = [...bucket].sort((a, b) => a.receivedAt.toMillis() - b.receivedAt.toMillis());
    threads.push({
      key,
      // The most recent spelling of the number, in case an older one was odd.
      from: sorted[sorted.length - 1].from,
      messages: sorted,
      last: sorted[sorted.length - 1],
    });
  }

  return threads.sort((a, b) => b.last.receivedAt.toMillis() - a.last.receivedAt.toMillis());
}

/** How many unknown numbers are waiting. Threads, not messages — people. */
export function unmatchedCount(threads: readonly UnmatchedThread<UnmatchedMessage>[]): number {
  return threads.length;
}

/**
 * A first and last name to prefill the new-customer form with.
 *
 * People introduce themselves in the first text more often than not — "Hi this
 * is Dave Whitfield, saw your truck on Bardstown Rd". Getting that right saves
 * typing; getting it wrong costs nothing, because the form is editable and the
 * crew member is looking straight at the message.
 *
 * Deliberately conservative. It fires only on an explicit introduction, and
 * never guesses from a bare greeting, because a customer called "Hey" in the
 * database is worse than an empty field.
 */
export function suggestName(body: string): { firstName: string; lastName: string } {
  const empty = { firstName: "", lastName: "" };
  const text = String(body ?? "").trim();
  if (!text) return empty;

  // "this is Dave", "I'm Dave Whitfield", "my name is Dave"
  // The introducing phrase is matched either way up — a text beginning "My
  // name is" is the commonest form there is. The name itself still has to be
  // capitalised, so an `i` flag on the whole pattern would give away the one
  // signal separating "I'm Dave" from "i'm interested".
  const match = text.match(
    /\b(?:[Tt]his is|[Ii]'?m|[Mm]y name is|[Nn]ame'?s)\s+([A-Z][a-z'-]{1,20})(?:\s+([A-Z][a-z'-]{1,20}))?/,
  );
  if (!match) return empty;

  // A lone capitalised word after "I'm" is as often a mood as a name — "I'm
  // Free", "I'm Good". A name that is also a common word needs the surname to
  // earn it, which is why the second capture is checked rather than assumed.
  const firstName = match[1];
  const lastName = match[2] ?? "";
  return { firstName, lastName };
}
