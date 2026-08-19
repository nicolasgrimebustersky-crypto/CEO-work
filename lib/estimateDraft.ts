/**
 * Turning "washed the driveway and the back patio, four fifty" into estimate
 * line items.
 *
 * The model writes the words. It does not touch the money — that rule is the
 * whole design of this file, and it is not a stylistic preference. An estimate
 * is a number a customer agrees to and later pays against; a model that
 * silently returns $437 when the operator said $450 produces a document that is
 * wrong in the one way nobody proofreads for, because the wording looks right.
 *
 * So the model returns a *split* — what the work was, and roughly what share of
 * the job each part was — and this file turns shares into dollars that add up
 * to the total that was typed in, exactly, to the cent.
 *
 * Free of imports so the arithmetic is tested by running it.
 */

/** Anthropic accepts these; anything else is refused before it is uploaded. */
export const ALLOWED_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

/**
 * Four photos is a driveway, a patio, a problem area and a wide shot. More than
 * that costs seconds the operator is standing on a doorstep waiting for, and
 * adds little — the price came from their eyes, not from the pictures.
 */
export const MAX_PHOTOS = 4;

/** After downscaling. A phone original is many times this. */
export const MAX_PHOTO_BYTES = 1_500_000;

/** Longest edge, in pixels, that a photo is shrunk to before being sent. */
export const PHOTO_MAX_EDGE = 1024;

export const MAX_DESCRIPTION = 1500;

export function isAllowedImageType(type: string | null | undefined): boolean {
  return typeof type === "string" && ALLOWED_IMAGE_TYPES.includes(type);
}

/**
 * The size to shrink a photo to, preserving aspect ratio.
 *
 * Never enlarges: a small photo stays small rather than being blown up into a
 * bigger upload that carries no more detail.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/* --------------------------------------------------------------- the ask */

export interface DraftRequest {
  description: string;
  /** What the operator has decided the job is worth. Authoritative. */
  total: number;
  serviceType: string;
  photoCount?: number;
}

/**
 * Why this cannot be drafted, in words the operator reads on the button.
 *
 * The total is required and must be positive: without it there is nothing to
 * divide, and a $0 estimate sent to a customer is worse than no estimate.
 */
export function draftProblem(request: DraftRequest): string | null {
  if (!request.description.trim()) {
    return "Say what the job is first.";
  }
  if (request.description.length > MAX_DESCRIPTION) {
    return `That's longer than ${MAX_DESCRIPTION} characters — trim it down.`;
  }
  if (!Number.isFinite(request.total) || request.total <= 0) {
    return "Put in what you're charging.";
  }
  if (request.total > 1_000_000) {
    return "That price looks like a typo.";
  }
  if ((request.photoCount ?? 0) > MAX_PHOTOS) {
    return `${MAX_PHOTOS} photos at a time.`;
  }
  return null;
}

/* ------------------------------------------------------- shares to money */

/** What the model is asked for: the words, and roughly how the job divides. */
export interface DraftedItem {
  name: string;
  description: string;
  /** This part's rough share of the job, 0–1. Normalised here, not trusted. */
  share: number;
}

export interface PricedItem {
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Discards anything the model returned that is not usable.
 *
 * A model is not a validator. An item with no name and no description is not a
 * line on an invoice, and a share that arrived as a string, a NaN or a negative
 * number cannot be divided by. Rather than failing the whole draft — which
 * would throw away three good lines because of a fourth — the bad ones are
 * dropped and the rest re-normalised.
 */
export function usableItems(raw: unknown): DraftedItem[] {
  if (!Array.isArray(raw)) return [];
  const items: DraftedItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    if (!name && !description) continue;
    const share = typeof record.share === "number" && Number.isFinite(record.share)
      ? Math.max(0, record.share)
      : 0;
    items.push({ name: name || description, description: name ? description : "", share });
  }
  return items;
}

/**
 * Turns shares into money that adds up to the total, exactly.
 *
 * Two things are guaranteed regardless of what the model returned:
 *
 *   The sum of the lines equals the total that was typed in, to the cent.
 *   No line is negative.
 *
 * Rounding residue — the cent that appears when 100 divides into three — is
 * pushed onto the largest line, where it is proportionally least visible, and
 * never onto a line small enough for it to look like a mistake.
 *
 * Shares that are all zero, or absent, split the job evenly. That is the honest
 * reading of "the model had no opinion about the split".
 */
export function priceItems(items: DraftedItem[], total: number): PricedItem[] {
  if (items.length === 0) return [];
  if (!Number.isFinite(total) || total <= 0) return [];

  const weights = items.map((item) => (item.share > 0 ? item.share : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const normalised =
    sum > 0 ? weights.map((w) => w / sum) : items.map(() => 1 / items.length);

  const priced = items.map((item, index) => ({
    name: item.name,
    description: item.description,
    quantity: 1,
    unitPrice: round2(total * normalised[index]),
  }));

  // Put the rounding residue on the biggest line.
  const assigned = round2(priced.reduce((acc, item) => acc + item.unitPrice, 0));
  const residue = round2(total - assigned);
  if (residue !== 0) {
    let biggest = 0;
    for (let i = 1; i < priced.length; i += 1) {
      if (priced[i].unitPrice > priced[biggest].unitPrice) biggest = i;
    }
    priced[biggest].unitPrice = round2(priced[biggest].unitPrice + residue);
  }

  // A residue larger than the smallest line could in principle push it below
  // zero. It cannot happen with normalised shares, but a negative price on an
  // estimate is bad enough to be worth refusing structurally rather than
  // reasoning about.
  return priced.map((item) => ({ ...item, unitPrice: Math.max(0, item.unitPrice) }));
}

/**
 * What the lines must add up to for the *document* to come to `total`.
 *
 * The number an operator says out loud in a driveway — "it's four fifty" — is
 * what the customer pays, not a subtotal they will later have six percent added
 * to. Kentucky sales tax is real and the builder applies it, so drafting lines
 * that sum to the spoken number produces a document that totals more than the
 * number, which is the same failure as getting the price wrong.
 *
 * So the tax is backed out. With every line taxable and a discount D, the
 * builder computes `total = (subtotal - D) x (1 + r)`, which inverts to
 * `subtotal = total / (1 + r) + D`.
 *
 * The residual cent is handed back too: rounding the subtotal can leave the
 * recomputed total a cent off, and the caller adds that to the lines so the
 * document lands exactly on the spoken number.
 */
export function subtotalForTotal(
  total: number,
  taxRatePct: number,
  discount = 0,
): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const rate = Number.isFinite(taxRatePct) ? Math.max(0, taxRatePct) / 100 : 0;
  const off = Number.isFinite(discount) ? Math.max(0, discount) : 0;

  const base = round2(total / (1 + rate) + off);

  // Re-derive what the builder will compute from that subtotal, and correct any
  // rounding drift rather than leaving the estimate a cent out.
  const taxableBase = round2(base - off);
  const recomputed = round2(taxableBase + round2(taxableBase * rate));
  const drift = round2(total - recomputed);

  return Math.max(0, round2(base + drift));
}

/** What the lines actually add up to. Used by the tests and by the screen. */
export function itemsTotal(items: readonly PricedItem[]): number {
  return round2(items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0));
}
