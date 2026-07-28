import { format, formatDistanceToNowStrict } from "date-fns";
import type { Timestamp } from "firebase/firestore";

import type { Customer } from "./types";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatMoney(amount: number): string {
  return currency.format(amount);
}

export function customerName(customer: Customer): string {
  const name = `${customer.firstName} ${customer.lastName}`.trim();
  if (name) return name;
  // A pin dropped at a door before anyone answers has an address but no name.
  return customer.address || "Unnamed pin";
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function formatTimestamp(value: Timestamp | null): string {
  if (!value) return "—";
  return format(value.toDate(), "MMM d, yyyy 'at' h:mm a");
}

export function formatDateOnly(value: Timestamp | null): string {
  if (!value) return "—";
  return format(value.toDate(), "MMM d, yyyy");
}

export function formatRelative(value: Timestamp | null): string {
  if (!value) return "never";
  return `${formatDistanceToNowStrict(value.toDate())} ago`;
}

/** 5025550147 -> (502) 555-0147. Anything unexpected is passed through as-is. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

/** E.164 for Twilio. Assumes US numbers, which is the whole service area. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return raw.trim();
  return null;
}
