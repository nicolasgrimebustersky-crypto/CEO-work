import { formatMoneyExact } from "@/lib/format";
import { venmoPayUrl, venmoUsername } from "@/lib/venmoLink";

/**
 * "Pay $45.00 on Venmo" on an invoice the customer can pay.
 *
 * A link, not a payment: it opens Venmo with the business's account, the
 * balance and a note naming the invoice already filled in, and the customer
 * confirms in Venmo. The prefilled note is the point. It comes back on
 * Venmo's "paid you" email, which is how the invoice gets marked paid without
 * anyone matching it by hand.
 *
 * Deliberately the business's own button, not a Venmo one: Venmo's merchant
 * guidelines say not to make your own Venmo button or redraw its logo, and its
 * official buttons are for checkout integrations, which this is not. So no
 * Venmo mark and no Venmo blue; the name Venmo only says where the money goes.
 * The handle is printed under it so the customer can see who they are paying
 * before Venmo opens.
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
  const user = venmoUsername(handle);
  if (!href || !user) return null;

  return (
    <div className="mx-auto mt-4 max-w-3xl px-1">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="tap-target flex w-full items-center justify-center gap-2 rounded-2xl bg-money px-5 py-4 text-money-ink shadow-glow-money transition hover:brightness-110 active:scale-[0.99] active:brightness-95"
      >
        <span className="text-lg font-bold tracking-tight">
          Pay <span className="tabular-nums">{formatMoneyExact(balanceDue)}</span> on Venmo
        </span>
        <OpenIcon />
      </a>
      <p className="mt-2 text-center text-sm font-semibold text-muted">
        Goes to @{user} with invoice {invoiceNumber} in the note. Keep the note as it is so we
        know it&apos;s paid.
      </p>
    </div>
  );
}

/** "Opens somewhere else": an arrow out of a box. Generic, decorative. */
function OpenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}
