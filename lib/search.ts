/**
 * Finding anything in the CRM from one box.
 *
 * The brief was "if I'm trying to find something, anything, it can find it no
 * matter what", and the "no matter what" is the whole specification. Somebody
 * standing on a porch does not remember whether the number was typed
 * `502-555-0199` or `(502) 555 0199`, whether the street was `Rd` or `Road`,
 * or whether they spelled Krzyzewski right. A search that answers "no results"
 * to any of those is a search they stop using, and then the data might as well
 * not be there.
 *
 * So four things are deliberately forgiven:
 *
 *   Shape — case, punctuation, accents and spacing are stripped from both the
 *   query and the record before anything is compared.
 *
 *   Formatting — a run of digits is compared against the digits of a field,
 *   so a phone number matches however either side was typed, and `450` finds
 *   the $450 estimate.
 *
 *   Partial words — `grim` finds `Grimes`, because people type until they
 *   recognise what they are after rather than until the word ends.
 *
 *   Spelling — one typo in a short word, two in a long one, by edit distance.
 *   This is the expensive one and the one that earns the feature.
 *
 * What is NOT forgiven is a term that matches nothing. Every term has to find
 * something, or the record is not a result: `dana gutter` must mean both, or a
 * two-word search returns everything that matched either and ranks the thing
 * you wanted ninth.
 *
 * Pure and import-free. The scoring is the product, so it is testable by
 * calling it rather than by driving a screen.
 */

/** What kind of thing a result is. Drives the icon and the grouping. */
export const SEARCH_KINDS = ["customer", "document", "job", "service", "route"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const KIND_LABEL: Record<SearchKind, string> = {
  customer: "Clients",
  document: "Estimates & invoices",
  job: "Jobs",
  service: "Services",
  route: "Routes",
};

/**
 * One searchable piece of text, and how much it counts.
 *
 * Weights are not decoration. A name matching is a different event from the
 * same letters turning up in the middle of a note, and without weights the
 * note wins whenever it is longer.
 */
export interface SearchField {
  text: string;
  weight: number;
}

/** The standard weights, named so callers do not scatter magic numbers. */
export const WEIGHT = {
  /** The thing's own name or number. */
  title: 1,
  /** Phone and email: short, unique, and usually what somebody is pasting. */
  identifier: 0.95,
  address: 0.75,
  /** Line items, service names — what the job actually was. */
  detail: 0.6,
  /** Status, stage, tags. Useful, but a weak reason to rank something first. */
  label: 0.5,
  /** Free text somebody typed months ago. */
  note: 0.4,
} as const;

export interface SearchRecord {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  fields: SearchField[];
  /** For the tiebreak: millis of whatever date makes this record "recent". */
  at: number | null;
}

export interface SearchHit {
  record: SearchRecord;
  score: number;
}

/**
 * Case, accents and punctuation removed; runs of space collapsed.
 *
 * NFD then stripping combining marks is what turns `Peña` into `pena`, so a
 * name typed without the tilde still finds the customer who spelled it
 * properly. Punctuation becomes a space rather than nothing, so `555-0199`
 * splits into two findable tokens instead of becoming one long one.
 */
export function normalize(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Just the digits, for comparing numbers typed in any shape. */
export function digits(raw: unknown): string {
  return String(raw ?? "").replace(/\D+/g, "");
}

/** The query, split into the terms that must all match. */
export function terms(query: unknown): string[] {
  const normalised = normalize(query);
  if (normalised === "") return [];
  return normalised.split(" ").filter(Boolean);
}

/**
 * Edit distance, capped.
 *
 * Bounded on purpose: the caller only ever asks "is this within 1 or 2", and
 * an unbounded distance over every note in the database is the difference
 * between a search that feels instant and one somebody waits for. Rows are
 * abandoned as soon as the whole row exceeds the cap.
 *
 * Transpositions count as one, not two — `teh` for `the` is the commonest
 * real typo there is, and plain Levenshtein charges double for it.
 */
export function editDistance(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let beforePrevious: number[] = [];

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i, ...new Array<number>(b.length).fill(0)];
    let best = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      let value = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, beforePrevious[j - 2] + 1);
      }
      current[j] = value;
      if (value < best) best = value;
    }

    // Nothing in this row is within the cap, and rows only grow.
    if (best > cap) return cap + 1;
    beforePrevious = previous;
    previous = current;
  }

  return previous[b.length];
}

/**
 * How much of a typo a word of this length is allowed.
 *
 * Nothing for very short words: at three letters, one edit reaches most of the
 * dictionary, and `tom` matching `ton`, `top` and `tim` is not help.
 */
export function allowedTypos(term: string): number {
  if (term.length <= 3) return 0;
  if (term.length <= 6) return 1;
  return 2;
}

/**
 * How well one term matches one piece of text. 0 means not at all.
 *
 * The ladder is ordered by how confident each kind of match is, and the gaps
 * between the rungs are what make the ranking readable: an exact word beats a
 * prefix beats a substring beats a guess at a misspelling, and no amount of
 * weak matches adds up to a strong one.
 */
export function scoreTerm(term: string, text: string): number {
  if (term === "" || text === "") return 0;

  if (text === term) return 1;

  const words = text.split(" ");
  if (words.includes(term)) return 0.95;
  if (text.startsWith(term)) return 0.9;
  if (words.some((word) => word.startsWith(term))) return 0.85;
  if (text.includes(term)) return 0.7;

  // Numbers are compared digit-to-digit, so a phone number matches however
  // either side was punctuated, and a part of one still matches.
  //
  // The whole number equalling the whole field is an exact match and scores
  // as one, above the word rungs higher up. That ordering is load-bearing and
  // a test caught it missing: `0199` is a genuine exact *word* of
  // `502 555 0199`, so a pasted full number tied with a four-digit guess. The
  // person who pasted ten digits meant them.
  if (/^\d+$/.test(term)) {
    const textDigits = digits(text);
    if (textDigits !== "") {
      if (textDigits === term) return 1;
      if (textDigits.includes(term)) return term.length >= 7 ? 0.95 : 0.6;
    }
  }

  // Digits are never typo-corrected, on either side.
  //
  // Found by running the app rather than by reading it: every demo customer
  // shares one phone number, and searching a DIFFERENT number two digits away
  // returned all fifteen of them as near misses. `5025550188` and
  // `5025550100` are two people; there is no such thing as nearly the right
  // phone number, nearly the right invoice number, or nearly the right price.
  //
  // Letters are the opposite — a name misremembered by one letter is the case
  // this whole branch exists for. So the forgiveness is scoped to words that
  // are actually words.
  // One guard, on the term, rather than one on each side. A second check
  // skipping numeric WORDS looked like belt and braces and was neither: a
  // mutation removing either one survived, because each alone blocked every
  // case the other did, and the length and distance checks below already
  // refuse a word against a number. Untestable redundancy is not safety.
  const cap = /^\d+$/.test(term) ? 0 : allowedTypos(term);
  if (cap > 0) {
    for (const word of words) {
      // Only against words of a comparable length; `dan` against `gutters` is
      // not a typo, it is a different word.
      if (Math.abs(word.length - term.length) > cap) continue;
      const distance = editDistance(term, word, cap);
      if (distance <= cap) return distance === 1 ? 0.5 : 0.4;
    }
  }

  return 0;
}

/**
 * A record's score for a whole query, or 0 if it is not a result at all.
 *
 * Every term has to match something — see the header. Each term takes its best
 * field, weighted, and the record's score is the mean, so adding a second term
 * that matches weakly pulls a record down rather than pushing it up.
 */
export function scoreRecord(record: SearchRecord, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;

  let total = 0;
  for (const term of queryTerms) {
    let best = 0;
    for (const field of record.fields) {
      if (field.text === "") continue;
      const score = scoreTerm(term, field.text) * field.weight;
      if (score > best) best = score;
    }
    // One term with nowhere to land disqualifies the record outright.
    if (best === 0) return 0;
    total += best;
  }

  return total / queryTerms.length;
}

/**
 * The results, best first.
 *
 * Ties break on recency, then on title, so the order is stable between
 * keystrokes. A list that reshuffles under the thumb is worse than a list in
 * the wrong order.
 */
export function search(records: SearchRecord[], query: unknown, limit = 40): SearchHit[] {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const record of records) {
    const score = scoreRecord(record, queryTerms);
    if (score > 0) hits.push({ record, score });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = (b.record.at ?? 0) - (a.record.at ?? 0);
    if (at !== 0) return at;
    return a.record.title.localeCompare(b.record.title);
  });

  return hits.slice(0, limit);
}

/** Results grouped for the screen, in a fixed section order. */
export function groupHits(hits: SearchHit[]): { kind: SearchKind; hits: SearchHit[] }[] {
  return SEARCH_KINDS.map((kind) => ({
    kind,
    hits: hits.filter((hit) => hit.record.kind === kind),
  })).filter((group) => group.hits.length > 0);
}
