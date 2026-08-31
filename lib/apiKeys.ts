/**
 * API keys, so something that is not a signed-in person can reach the CRM.
 *
 * Every route until now was gated on a Firebase ID token — minted at sign-in,
 * good for about an hour, impossible to issue ahead of time. That is the right
 * shape for two people with phones and the wrong shape for an agent, which has
 * no browser to sign in with.
 *
 * The thing to keep in mind while reading this file: the MCP route runs on the
 * Admin SDK, which bypasses every Firestore rule. These checks are not one layer
 * of several. They are the whole boundary between the internet and a database of
 * real people's home addresses.
 *
 * Free of imports so all of it is tested by running it. The hashing itself lives
 * in lib/server/apiKeyAuth.ts, where node:crypto is available.
 */

/**
 * What a key is allowed to do, in tiers of what goes wrong if it leaks.
 *
 * Not one scope per tool. A tool list would drift as tools are added, and the
 * question that actually matters when handing somebody a key is "what is the
 * worst this can do" — read the book, add to it, or reach a customer.
 */
export const SCOPES = ["read", "write", "send"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABEL: Record<Scope, string> = {
  read: "Read everything",
  write: "Add leads, notes and draft estimates",
  send: "Text customers and book jobs",
};

export const SCOPE_HINT: Record<Scope, string> = {
  read: "Every customer, job, invoice and lead. A leaked key exposes your book but cannot change it.",
  write: "Can add new records and write on timelines. Cannot alter or delete what is already there.",
  send: "Can text a customer and book time. A text cannot be unsent — issue this one deliberately.",
};

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

/** Drops anything that is not a real scope. A stored list is not trusted. */
export function cleanScopes(value: unknown): Scope[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<Scope>();
  for (const entry of value) if (isScope(entry)) seen.add(entry);
  return SCOPES.filter((scope) => seen.has(scope));
}

/* ------------------------------------------------------------- the key itself */

/**
 * The prefix every key carries.
 *
 * Two jobs: it makes a leaked key greppable in a log file or a repository, and
 * it makes one recognisable when somebody pastes it into the wrong window — the
 * failure that has already cost this project two credentials.
 */
export const KEY_PREFIX = "gbk_";

/** How many random bytes go into a key. 32 is 256 bits. */
export const KEY_BYTES = 32;

/**
 * The first few characters, stored alongside the hash so a key is identifiable
 * in a list without being recoverable from it.
 */
export function keyHint(key: string): string {
  const normalized = normalizeKey(key);
  if (!normalized.startsWith(KEY_PREFIX)) return "";
  return normalized.slice(0, KEY_PREFIX.length + 6);
}

/**
 * The one canonical form of a key.
 *
 * Everything — the shape check, the hash, the lookup — goes through this. A key
 * copied out of a dashboard routinely arrives with a trailing newline or a
 * leading space, and tolerating that is right: the operator pasted the correct
 * thing. But tolerating it in *one* place and not another is worse than
 * rejecting it everywhere, because the key then passes the shape check and
 * silently fails the hash lookup, and the error says "invalid key" about a key
 * that is perfectly valid.
 */
export function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Does this even look like one of ours?
 *
 * Checked before hashing so a malformed header is rejected without spending a
 * database read on it — and so the error can say "that is not a key" rather than
 * the less useful "not authorised".
 */
export function looksLikeKey(value: string | null | undefined): boolean {
  const normalized = normalizeKey(value);
  if (!normalized.startsWith(KEY_PREFIX)) return false;
  const body = normalized.slice(KEY_PREFIX.length);
  // base64url of 32 bytes is 43 characters. Allow a little either side rather
  // than pinning it exactly, so the encoding can change without a lockout.
  return /^[A-Za-z0-9_-]{32,64}$/.test(body);
}

/** Pulls the key out of an Authorization header, or null. */
export function bearerFrom(header: string | null | undefined): string | null {
  const value = normalizeKey(header);
  if (!value.toLowerCase().startsWith("bearer ")) return null;
  const token = normalizeKey(value.slice(7));
  return token ? token : null;
}

/* ------------------------------------------------------ what a key may do */

/** The shape the checks need. The stored document satisfies it. */
export interface StoredKey {
  id: string;
  label: string;
  scopes: readonly string[];
  revokedAt?: unknown;
}

export function isRevoked(key: Pick<StoredKey, "revokedAt">): boolean {
  return key.revokedAt != null;
}

export function hasScope(key: Pick<StoredKey, "scopes">, needed: Scope): boolean {
  return cleanScopes(key.scopes).includes(needed);
}

/**
 * Why this key may not run this tool, in words the agent can act on.
 *
 * Says which scope is missing rather than a bare refusal: an agent told
 * "needs the send scope" can report something its operator can fix, where one
 * told "forbidden" will retry the same call.
 */
export function scopeProblem(
  key: Pick<StoredKey, "scopes" | "revokedAt">,
  needed: Scope,
): string | null {
  if (isRevoked(key)) return "This API key has been revoked.";
  if (!hasScope(key, needed)) {
    return `This key does not have the "${needed}" scope, which ${SCOPE_LABEL[needed].toLowerCase()}. Issue a key with that scope from the Account screen.`;
  }
  return null;
}

/* ---------------------------------------------------------------- labels */

export const MAX_LABEL = 60;

/**
 * A key with no label is a key nobody dares revoke six months later, because
 * nobody remembers what it was for.
 */
export function labelProblem(label: string): string | null {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return "Give the key a name, so you know what it was for.";
  if (trimmed.length > MAX_LABEL) return `Keep the name under ${MAX_LABEL} characters.`;
  return null;
}

/** What a write made through this key is attributed to. See the plan, §5. */
export function agentAuthor(key: Pick<StoredKey, "id" | "label">): {
  uid: string;
  displayName: string;
} {
  return {
    uid: `agent:${key.id}`,
    displayName: key.label.trim() || "Ops Agent",
  };
}

/** Is this author an agent rather than a person? Drives the timeline marker. */
export function isAgentUid(uid: string | null | undefined): boolean {
  return typeof uid === "string" && uid.startsWith("agent:");
}
