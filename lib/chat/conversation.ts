/**
 * Team chat: the parts that are decisions rather than plumbing.
 *
 * This is the crew talking to each other, not the customer SMS thread. Keeping
 * them separate matters — a message here costs nothing and never leaves the
 * app, and confusing the two would eventually put an internal remark in front
 * of a customer.
 *
 * Free of imports so it can be tested by running it.
 */

export interface Member {
  uid: string;
  displayName: string;
}

/** Nobody needs a hundred people in a group in a two-to-five person crew. */
export const MAX_MEMBERS = 20;

/** Long enough for a paragraph, short enough not to be a document. */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * The people in a conversation, cleaned up.
 *
 * Deduplicated and always including the creator. A conversation you started
 * and are not in would be invisible to you the moment it was created — the
 * rules only let members read it — so the message would vanish on send.
 */
export function membersFor(
  creatorUid: string,
  chosen: readonly string[],
): string[] {
  const seen = new Set<string>([creatorUid]);
  for (const uid of chosen) {
    if (typeof uid === "string" && uid) seen.add(uid);
  }
  return [...seen];
}

/**
 * Is this a one-to-one chat?
 *
 * Two members, and that is the whole definition. Deliberately derived rather
 * than stored: a stored `isGroup` flag and a two-person member list can
 * disagree, and then the same conversation titles itself differently in the
 * list and in the header.
 */
export function isDirect(memberUids: readonly string[]): boolean {
  return memberUids.length === 2;
}

/**
 * What to call a conversation in the list.
 *
 * A direct chat is named after the other person, from the point of view of
 * whoever is looking — the same document reads "Noah" on my phone and
 * "Nicolas" on his. A group uses its title, falling back to the members so a
 * group nobody named is still identifiable.
 */
export function titleFor(
  memberUids: readonly string[],
  storedTitle: string | null | undefined,
  viewerUid: string,
  nameOf: (uid: string) => string,
): string {
  const others = memberUids.filter((uid) => uid !== viewerUid);

  if (isDirect(memberUids)) {
    // A conversation with yourself — a note to self — is legitimate and must
    // not render as an empty string.
    return others.length === 0 ? "You" : nameOf(others[0]);
  }

  const title = (storedTitle ?? "").trim();
  if (title) return title;

  if (others.length === 0) return "You";
  const names = others.map(nameOf);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

/**
 * Has this conversation got something new in it for me?
 *
 * Compared as milliseconds, and strictly greater than. Equal means the last
 * message *is* the one you read; treating that as unread leaves a badge that
 * never clears no matter how many times you open the thread.
 *
 * My own message never counts as unread — the read receipt is written when the
 * thread opens, but a message I send from the composer arrives back through
 * the same subscription a moment later, and without this the thread I am
 * looking at marks itself unread.
 */
export function hasUnread(
  lastMessageAtMs: number | null | undefined,
  lastReadAtMs: number | null | undefined,
  lastMessageByUid: string | null | undefined,
  viewerUid: string,
): boolean {
  if (lastMessageAtMs == null) return false;
  if (lastMessageByUid === viewerUid) return false;
  return lastMessageAtMs > (lastReadAtMs ?? 0);
}

/** What is wrong with this message, in words, or null. */
export function messageProblem(text: string): string | null {
  if (!text.trim()) return "Type something first.";
  if (text.length > MAX_MESSAGE_LENGTH) {
    return `That's longer than ${MAX_MESSAGE_LENGTH} characters.`;
  }
  return null;
}

/** What is wrong with this new conversation, in words, or null. */
export function conversationProblem(memberUids: readonly string[]): string | null {
  if (memberUids.length < 2) return "Pick at least one person to talk to.";
  if (memberUids.length > MAX_MEMBERS) {
    return `That's more than ${MAX_MEMBERS} people.`;
  }
  return null;
}

/**
 * One line of the message under a conversation in the list.
 *
 * Collapsed to a single line and trimmed, because a message with newlines in
 * it would otherwise push every row below it down the screen.
 */
export function previewOf(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/**
 * Newest conversation first, by its last message.
 *
 * A conversation with no messages yet sorts on when it was created, so one you
 * have just started does not sink below everything else before you have had a
 * chance to type in it.
 */
export function byMostRecent<
  T extends { lastMessageAtMs?: number | null; createdAtMs?: number | null },
>(conversations: readonly T[]): T[] {
  return [...conversations].sort(
    (a, b) =>
      (b.lastMessageAtMs ?? b.createdAtMs ?? 0) -
      (a.lastMessageAtMs ?? a.createdAtMs ?? 0),
  );
}
