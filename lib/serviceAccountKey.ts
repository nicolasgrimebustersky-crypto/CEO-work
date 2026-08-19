/**
 * Reading the service-account credential out of an environment variable.
 *
 * Split out of lib/server/admin.ts and made free of imports so it can be tested
 * by running it against every shape a real paste arrives in. That matters more
 * here than the small amount of logic suggests: when this returns null the app
 * cannot verify anybody's login, and the operator's only clue used to be that
 * something, somewhere, was missing.
 *
 * The tolerance below is not defensive padding. Each case is a way a correct
 * credential has actually been mangled between a JSON file and a hosting
 * dashboard — surrounding quotes copied along with the value, a newline the
 * textarea added, whitespace from a double-click selection. Rejecting those
 * would be technically defensible and practically useless: the operator pasted
 * the right thing.
 */

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** The three fields the Admin SDK cannot start without. */
const REQUIRED = ["project_id", "client_email", "private_key"] as const;

/** Strips what a copy-paste picks up on the way out of a dashboard. */
function clean(raw: string): string {
  let value = raw.trim();
  // A value wrapped in quotes, which is what happens when somebody copies it
  // out of a .env file or a JSON snippet rather than the file itself.
  while (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function decode(value: string): string | null {
  if (value.startsWith("{")) return value;
  try {
    // Whitespace is dropped first: a textarea that soft-wrapped the line, or a
    // `base64` run without -w0, leaves newlines through the middle of it.
    const compact = value.replace(/\s+/g, "");
    if (!compact) return null;
    const decoded = Buffer.from(compact, "base64").toString("utf8");
    return decoded.trimStart().startsWith("{") ? decoded : null;
  } catch {
    return null;
  }
}

export function parseServiceAccountKey(raw: string | undefined): ServiceAccount | null {
  const value = clean(raw ?? "");
  if (!value) return null;

  const json = decode(value);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const projectId = typeof parsed.project_id === "string" ? parsed.project_id : "";
    const clientEmail = typeof parsed.client_email === "string" ? parsed.client_email : "";
    const privateKey = typeof parsed.private_key === "string" ? parsed.private_key : "";
    if (!projectId || !clientEmail || !privateKey) return null;

    return {
      projectId,
      clientEmail,
      // Env vars flatten real newlines into the two-character sequence \n.
      privateKey: privateKey.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

/**
 * Why the credential could not be read, in words an operator can act on —
 * and without ever quoting the value, which is a private key.
 *
 * The length is included deliberately. "Set, but 200 characters" against an
 * expected three thousand is a truncated paste, and that is a diagnosis; "not
 * configured" is not.
 */
export function describeServiceAccountKey(raw: string | undefined): string {
  const value = clean(raw ?? "");
  if (!value) {
    return "FIREBASE_SERVICE_ACCOUNT_KEY is not set on this deployment. Add it, tick every environment it should apply to, and redeploy.";
  }

  const size = `${value.length} characters`;

  const json = decode(value);
  if (!json) {
    return `FIREBASE_SERVICE_ACCOUNT_KEY is set (${size}) but is neither the service-account JSON nor a base64 copy of it. A truncated paste is the usual cause — the whole value should be about 3,000 characters.`;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return `FIREBASE_SERVICE_ACCOUNT_KEY is set (${size}) and decodes, but the result is not valid JSON. It was probably cut short in the middle.`;
  }

  const missing = REQUIRED.filter((field) => typeof parsed[field] !== "string" || !parsed[field]);
  if (missing.length > 0) {
    return `FIREBASE_SERVICE_ACCOUNT_KEY is set (${size}) and parses, but is missing ${missing.join(", ")}. Download a fresh key from Firebase Console → Project settings → Service accounts.`;
  }

  return "";
}
