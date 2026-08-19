/**
 * The four glyphs on the on-site buttons.
 *
 * Drawn in one weight on a 24-unit grid to match components/shell/navIcons.tsx,
 * because a job screen holding two different icon languages looks like two
 * different apps. Each is a silhouette rather than a detailed drawing: these
 * are read at arm's length, outdoors, on a phone somebody is holding in a wet
 * glove, so the shape has to survive at 28px in sunlight.
 */

const STROKE = 1.9;

/** A van seen side-on: cab, box, two wheels. */
export function VanIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
      <path
        d="M2 7.5h11v8H2v-8Zm11 2.5h4.2l3 3.2v2.3H13V10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <circle cx={7} cy={17.5} r={1.9} fill="none" stroke="currentColor" strokeWidth={STROKE} />
      <circle cx={17} cy={17.5} r={1.9} fill="none" stroke="currentColor" strokeWidth={STROKE} />
    </svg>
  );
}

/** A play triangle. */
export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
      <path
        d="M8 5.5 18.5 12 8 18.5V5.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A briefcase with a check struck across it — the work itself, done. */
export function BriefcaseCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
      <rect
        x={2.5}
        y={7}
        width={19}
        height={13}
        rx={2}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
      />
      <path
        d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <path
        d="m7.5 13.5 3 3 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A bare check. */
export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
      <path
        d="m4 12.5 5.5 5.5L20 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
