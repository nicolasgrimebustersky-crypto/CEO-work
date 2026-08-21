/**
 * Adding somebody to the book without standing outside their house.
 *
 * The map's pin sheet was the only way in, which is right for the work it was
 * built for — knocking a street — and wrong for everything else. A referral
 * over the phone, a number written on a napkin, a neighbour who asked while you
 * were loading the truck: none of those have a pin, and making somebody drop
 * one on a rough guess puts a wrong dot on the map forever.
 *
 * So a typed-in record starts with no coordinates. If an address was given, the
 * map geocodes it on its own next time it loads — see GeocodeBackfill — and the
 * pin appears where it belongs rather than where a thumb landed.
 *
 * Free of imports so the rules are tested by running them.
 */

export interface CustomerEntry {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
}

const digitsOf = (value: string) => value.replace(/\D/g, "");

/** A US number, with or without the country code. */
export function isUsablePhone(phone: string): boolean {
  const digits = digitsOf(phone);
  if (digits.length === 10) return true;
  return digits.length === 11 && digits.startsWith("1");
}

/**
 * Deliberately loose. This is a field somebody types on a phone while holding a
 * ladder — it catches "bobsmith.com" and "bob@" and otherwise gets out of the
 * way. Anything stricter rejects real addresses and teaches people to leave the
 * field blank, which is worse than a typo.
 */
export function isUsableEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Why this cannot be saved yet.
 *
 * The rule is that the record has to be findable later. A row with no name, no
 * number and no address is not a lead — it is a blank line that will be
 * scrolled past forever, and the person who created it will never know which
 * one it was meant to be.
 */
export function customerEntryProblem(entry: CustomerEntry): string | null {
  const name = `${entry.firstName} ${entry.lastName}`.trim();
  const phone = entry.phone.trim();
  const address = entry.address.trim();

  if (!name && !phone && !address) {
    return "Add at least a name, a phone number or an address.";
  }
  if (phone && !isUsablePhone(phone)) {
    return "That phone number doesn't look like 10 digits.";
  }
  if (!isUsableEmail(entry.email)) {
    return "That email address looks wrong.";
  }
  return null;
}

/** What the record is called in a list before anybody has named it. */
export function entryLabel(entry: CustomerEntry): string {
  const name = `${entry.firstName.trim()} ${entry.lastName.trim()}`.trim();
  return name || entry.address.trim() || entry.phone.trim() || "New lead";
}

/**
 * Whether the map will be able to place this record on its own.
 *
 * Drives the line under the address field: somebody typing a lead in from a
 * phone call should be told the pin will appear later rather than wondering why
 * their new lead is missing from the map.
 */
export function willGeocode(entry: CustomerEntry): boolean {
  return entry.address.trim().length > 0;
}
