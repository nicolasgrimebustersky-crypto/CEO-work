/**
 * When an open page counts as somebody reading their quote.
 *
 * Pulled out of components/documents/RecordView.tsx so the decision can be
 * run in a test rather than read. The component is wiring — listeners, a
 * timer, one fetch — and wiring is hard to assert about without a browser.
 * The decision underneath is a handful of booleans, and it is the part that
 * would be wrong: every mistake here is a false "Opened", which sends somebody
 * chasing a decision the customer has not been asked to make.
 *
 * Pure and import-free, like lib/smsConsent.ts and lib/blastAudience.ts, and
 * for the same reason — this one is checked by running every combination.
 */

/**
 * How long the page must be open, and visible, before it counts as read.
 *
 * Long enough that a machine fetching the URL to decide whether it is
 * dangerous has usually finished and moved on, short enough that a customer
 * glancing at a price and closing the tab still counts. Corporate mail
 * scanners — Microsoft Defender Safe Links, Proofpoint, Mimecast — do render
 * pages with a real browser and would otherwise look exactly like a reader.
 */
export const DWELL_MS = 3000;

export interface BeaconState {
  /** A browser prerender or speculative load: a page nobody chose to open. */
  prerendering: boolean;
  /** document.visibilityState === "visible". */
  visible: boolean;
  /** This visit has already been reported. */
  sent: boolean;
  /** A dwell timer is already running. */
  armed: boolean;
}

/**
 * Whether this is the crew's own look at a link they just made.
 *
 * `?crew=1` rides the "Open it yourself to check" link in the CRM. Without it
 * the likeliest false stamp in the whole app is somebody on the crew checking
 * their own work, which would read on the board as the customer having looked.
 */
export function isCrewLink(search: string): boolean {
  return new URLSearchParams(search).has("crew");
}

/**
 * Whether to start the dwell clock now.
 *
 * Re-entrant by design: this is asked at mount and again every time the page
 * becomes visible or a prerender is activated, because the first answer very
 * often is not the real one. A link tapped from a message thread can open
 * behind the messages app, and a prerender is a page nobody has chosen to look
 * at yet. An earlier version simply returned in both of those cases and never
 * asked again, so a customer who opened the quote, got distracted and came
 * back to read it properly was recorded as never having seen it — which reads
 * as "the text never arrived" and sends somebody chasing the wrong problem.
 */
export function shouldArm(state: BeaconState): boolean {
  if (state.sent) return false;
  if (state.armed) return false;
  if (state.prerendering) return false;
  return state.visible;
}

/**
 * Whether to report the view, asked when the dwell clock finishes.
 *
 * Visibility is re-checked here and not only at the start: a tab backgrounded
 * a second after opening is not a read quote. `prerendering` is deliberately
 * not re-checked — a page cannot go back to being a prerender, and the
 * activation that ends one is what arms this in the first place.
 */
export function shouldFire(state: BeaconState): boolean {
  if (state.sent) return false;
  return state.visible;
}
