/**
 * Whether Venmo really sent an email: its DKIM signature, checked on the raw
 * message. Kept apart from lib/server/venmo.ts, which needs Firebase, so the
 * check that the whole feature's security rests on is tested directly.
 */
import { dkimVerify } from "mailauth";

export interface SignatureCheck {
  verified: boolean;
  problem: string;
  /** The Subject header the signature covers, when it passed. */
  signedSubject: string;
}

/**
 * Whether venmo.com really signed this message, and the subject it signed.
 *
 * Demands a passing signature whose domain is venmo.com, that covers both
 * From and Subject, and that covers the whole body (no l= tag, which would
 * let text be appended after the signed part). The subject is taken from the
 * signed header list itself, so a second Subject header added on the way
 * cannot change what is read.
 */
export async function checkVenmoSignature(
  raw: Buffer,
  resolver?: (name: string, type: string) => Promise<string[][]>,
): Promise<SignatureCheck> {
  let results: Awaited<ReturnType<typeof dkimVerify>>["results"];
  try {
    results = (await dkimVerify(raw, resolver ? { resolver } : {})).results ?? [];
  } catch (error) {
    return { verified: false, problem: `DKIM check failed: ${(error as Error).message}`, signedSubject: "" };
  }

  for (const result of results) {
    const domain = String(result.signingDomain ?? "").toLowerCase();
    if (result.status?.result !== "pass") continue;
    if (domain !== "venmo.com" && !domain.endsWith(".venmo.com")) continue;
    if (result.canonBodyLengthLimited) continue;
    const keys = String(result.signingHeaders?.keys ?? "")
      .split(":")
      .map((k) => k.trim().toLowerCase());
    if (!keys.includes("from") || !keys.includes("subject")) continue;

    const headers: string[] = result.signingHeaders?.headers ?? [];
    const subjectLine = headers.find((h) => /^subject:/i.test(h)) ?? "";
    const fromLine = headers.find((h) => /^from:/i.test(h)) ?? "";
    if (!/@(?:[a-z0-9-]+\.)*venmo\.com\b/i.test(fromLine)) continue;
    return { verified: true, problem: "", signedSubject: decodeHeader(subjectLine.replace(/^subject:\s*/i, "")) };
  }

  const seen = results.map((r) => `${r.signingDomain ?? "?"}=${r.status?.result ?? "?"}`).join(", ");
  return { verified: false, problem: `No passing venmo.com signature (${seen || "no signatures"})`, signedSubject: "" };
}

/** RFC 2047 encoded-words ("=?UTF-8?Q?...?=") back to text. */
export function decodeHeader(value: string): string {
  return value
    .replace(/\r?\n[ \t]+/g, " ")
    .replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
      try {
        const bytes =
          enc.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
                "binary",
              );
        return new TextDecoder(charset.toLowerCase() === "utf-8" ? "utf-8" : "latin1").decode(bytes);
      } catch {
        return text;
      }
    })
    .replace(/\?=\s+=\?/g, "")
    .trim();
}

