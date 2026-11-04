import { formatMoneyExact } from "@/lib/format";
import { venmoPayUrl } from "@/lib/venmoLink";

/**
 * "Pay with Venmo" on an invoice the customer can pay.
 *
 * A link, not a payment: it opens Venmo with the business's account, the
 * balance and a note naming the invoice already filled in, and the customer
 * confirms in Venmo. The prefilled note is the point. It comes back on
 * Venmo's "paid you" email, which is how the invoice gets marked paid without
 * anyone matching it by hand.
 *
 * Venmo blue, white type, the mark on the left: recognisably Venmo at a
 * glance, which is what makes a customer trust a payment button.
 */
export function VenmoPayButton({
  handle,
  balanceDue,
  invoiceNumber,
  businessName,
}: {
  handle: string | null;
  balanceDue: number;
  invoiceNumber: string;
  businessName: string;
}) {
  const href = venmoPayUrl(handle, balanceDue, `Invoice ${invoiceNumber} · ${businessName}`);
  if (!href) return null;

  return (
    <div className="mx-auto mt-4 max-w-3xl px-1">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="tap-target group flex w-full items-center justify-center gap-3 rounded-2xl bg-[#008CFF] px-5 py-4 text-white shadow-[0_14px_34px_-14px_rgba(0,140,255,0.8)] transition hover:bg-[#0074d6] active:scale-[0.99]"
      >
        <VenmoMark />
        <span className="text-lg font-bold tracking-tight">Pay with Venmo</span>
        <span className="ml-1 rounded-full bg-white/20 px-2.5 py-0.5 text-base font-extrabold tabular-nums">
          {formatMoneyExact(balanceDue)}
        </span>
      </a>
      <p className="mt-2 text-center text-sm font-semibold text-muted">
        Opens Venmo with the amount and invoice {invoiceNumber} filled in. Keep the note as it is so we
        know it&apos;s paid.
      </p>
    </div>
  );
}

/** A white rounded tile with Venmo's "V", in Venmo blue. Decorative. */
function VenmoMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#ffffff" />
      <path
        fill="#008CFF"
        d="M23.6 7.2c.8 1.3 1.1 2.6 1.1 4.2 0 5.3-4.5 12.1-8.1 16.9H8.3L5 8.6l7.2-.7 1.7 14c1.6-2.7 3.6-6.9 3.6-9.8 0-1.6-.3-2.6-.7-3.5l6.8-1.4z"
      />
    </svg>
  );
}
