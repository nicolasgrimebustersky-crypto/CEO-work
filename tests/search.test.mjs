/**
 * The search that has to find things "no matter what".
 *
 * The brief was a promise about failure, not about success: a search that
 * returns nothing for a real record is the one that gets abandoned. So most of
 * these are cases where a naive `includes()` would answer "no results" and a
 * person on a porch would conclude the customer is not in the app.
 *
 * The ranking tests matter as much. Finding the record and putting it ninth is
 * the same as not finding it on a phone screen.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  KIND_LABEL,
  SEARCH_KINDS,
  WEIGHT,
  allowedTypos,
  digits,
  editDistance,
  groupHits,
  normalize,
  scoreRecord,
  scoreTerm,
  search,
  terms,
} from "../lib/search.ts";

const rec = (over = {}) => ({
  kind: "customer",
  id: "c1",
  title: "Dana Reyes",
  subtitle: "",
  href: "/customers/detail?id=c1",
  at: 1,
  fields: [{ text: normalize("Dana Reyes"), weight: WEIGHT.title }],
  ...over,
});

const customer = rec({
  fields: [
    { text: normalize("Dana Reyes"), weight: WEIGHT.title },
    { text: normalize("(502) 555-0199"), weight: WEIGHT.identifier },
    { text: normalize("12 Oak Road, Crestwood KY"), weight: WEIGHT.address },
    { text: normalize("Wants the gutters done before winter"), weight: WEIGHT.note },
  ],
});

describe("shape is forgiven", () => {
  test("case, punctuation and spacing all collapse", () => {
    assert.equal(normalize("  Dana  REYES!! "), "dana reyes");
    assert.equal(normalize("(502) 555-0199"), "502 555 0199");
  });

  test("accents are stripped, so a name typed plainly still finds it", () => {
    assert.equal(normalize("Peña"), "pena");
    assert.equal(normalize("José Ángel"), "jose angel");
    assert.ok(scoreRecord(rec({ fields: [{ text: normalize("Peña"), weight: 1 }] }), ["pena"]) > 0);
  });

  test("nothing at all normalises to nothing, not to a crash", () => {
    for (const bad of [null, undefined, 0, {}, []]) {
      assert.equal(typeof normalize(bad), "string");
    }
    assert.deepEqual(terms(null), []);
    assert.deepEqual(terms("   "), []);
  });
});

describe("phone numbers match however they were typed", () => {
  test("the stored number is punctuated and the typed one is not", () => {
    assert.ok(scoreRecord(customer, terms("5025550199")) > 0, "plain digits");
    assert.ok(scoreRecord(customer, terms("502-555-0199")) > 0, "dashes");
    assert.ok(scoreRecord(customer, terms("(502) 555 0199")) > 0, "brackets");
  });

  test("a fragment of the number is enough", () => {
    assert.ok(scoreRecord(customer, terms("0199")) > 0, "last four");
    assert.ok(scoreRecord(customer, terms("5550199")) > 0, "last seven");
  });

  test("a full number outranks a four-digit fragment", () => {
    // Somebody pasting a whole number means it; four digits is a guess.
    assert.ok(scoreTerm("5025550199", "502 555 0199") > scoreTerm("0199", "502 555 0199"));
  });

  test("digits strips everything else", () => {
    assert.equal(digits("+1 (502) 555-0199"), "15025550199");
    assert.equal(digits(null), "");
  });
});

describe("partial words are enough", () => {
  test("typing until you recognise it works", () => {
    assert.ok(scoreRecord(customer, terms("dan")) > 0);
    assert.ok(scoreRecord(customer, terms("rey")) > 0);
    assert.ok(scoreRecord(customer, terms("crest")) > 0, "part of the address");
  });

  test("a word start beats a match buried mid-word", () => {
    // Asserted on two terms that both FAIL the exact-word rung, or the
    // comparison is really about exactness and says nothing about prefixes. A
    // mutation that scored substrings as highly as prefixes survived the first
    // version of this test for exactly that reason.
    assert.ok(
      scoreTerm("roa", "oak road") > scoreTerm("oad", "oak road"),
      "a prefix of a word must beat letters found inside one",
    );
  });

  test("a whole word beats a word that merely starts the same way", () => {
    // `oak` is the street; `oakland` is a different street. Neither is at the
    // start of its field, so this isolates the exact-word rung itself.
    assert.ok(
      scoreTerm("oak", "12 oak road") > scoreTerm("oak", "12 oakland road"),
      "an exact word must outrank a prefix match",
    );
  });
});

describe("spelling is forgiven, within reason", () => {
  test("one typo in a medium word still finds it", () => {
    assert.ok(scoreRecord(customer, terms("reyez")) > 0, "transposed/!substituted last letter");
    assert.ok(scoreRecord(customer, terms("crestwod")) > 0, "a dropped letter");
  });

  test("a transposition counts as one edit, because it is the commonest typo", () => {
    assert.equal(editDistance("teh", "the", 2), 1);
    assert.equal(editDistance("gutetrs", "gutters", 2), 1);
  });

  test("very short words get no forgiveness", () => {
    // At three letters one edit reaches half the dictionary.
    assert.equal(allowedTypos("tom"), 0);
    assert.equal(allowedTypos("dana"), 1);
    assert.equal(allowedTypos("crestwood"), 2);
  });

  test("a number is never a typo for a different number", () => {
    // Found by running the thing: every demo customer shares one phone, and
    // searching a DIFFERENT number two digits away returned all fifteen of
    // them. `5025550188` and `5025550100` are two people, not one misspelling.
    // Letters tolerate a slip; digits must not, because there is no such thing
    // as nearly the right phone number.
    assert.equal(scoreTerm("5025550188", "5025550100"), 0);
    assert.equal(scoreTerm("0188", "0100"), 0);
    assert.equal(scoreTerm("451", "450"), 0, "and nearly the right money is the wrong money");
  });

  test("but the right number still matches, however it was punctuated", () => {
    // The guard above must not cost the thing the feature is for.
    assert.ok(scoreTerm("5025550100", "5025550100") > 0);
    assert.ok(scoreTerm("5025550100", "502 555 0100") > 0);
    assert.ok(scoreTerm("0100", "502 555 0100") > 0);
  });

  test("a word is not a typo for a number either", () => {
    assert.equal(scoreTerm("oaks", "0188"), 0);
  });

  test("a different word is not a typo", () => {
    assert.equal(scoreTerm("zzzz", "dana reyes"), 0);
    assert.equal(scoreRecord(customer, terms("plumbing")), 0);
  });

  test("the distance cap is respected, and bails early", () => {
    assert.ok(editDistance("abcdefgh", "zzzzzzzz", 2) > 2);
    assert.equal(editDistance("", "", 1), 0);
  });
});

describe("every term has to land", () => {
  test("two terms both matching is a result", () => {
    assert.ok(scoreRecord(customer, terms("dana gutters")) > 0);
  });

  test("one term matching and one not is NOT a result", () => {
    // The thing that stops a two-word search returning everything that matched
    // either word and burying what was wanted.
    assert.equal(scoreRecord(customer, terms("dana plumbing")), 0);
  });

  test("an empty query matches nothing at all", () => {
    assert.equal(scoreRecord(customer, []), 0);
    assert.deepEqual(search([customer], ""), []);
    assert.deepEqual(search([customer], "   "), []);
  });
});

describe("ranking puts the obvious answer first", () => {
  const dana = rec({ id: "a", title: "Dana Reyes", fields: [{ text: "dana reyes", weight: WEIGHT.title }] });
  const mentions = rec({
    id: "b",
    title: "Tom Clark",
    fields: [
      { text: "tom clark", weight: WEIGHT.title },
      { text: "dana recommended him", weight: WEIGHT.note },
    ],
  });

  test("a name beats the same word buried in somebody else's note", () => {
    const [first] = search([mentions, dana], "dana");
    assert.equal(first.record.id, "a", "the person called Dana must come first");
  });

  test("a weak match on a title still beats a perfect match in a note", () => {
    // The case that proves the weights are doing the work rather than the
    // rungs. A mutation deleting `* field.weight` survived until this existed:
    // the note here matches BETTER on the ladder (an exact field) and must
    // still lose, because a note is not what a thing is called.
    const titled = rec({
      id: "t",
      title: "Gutter Services LLC",
      fields: [{ text: "gutter services llc", weight: WEIGHT.title }],
    });
    const noted = rec({
      id: "n",
      title: "Tom Clark",
      fields: [
        { text: "tom clark", weight: WEIGHT.title },
        { text: "gutter", weight: WEIGHT.note },
      ],
    });
    assert.equal(
      search([noted, titled], "gutter")[0].record.id,
      "t",
      "the business called Gutter must come before a note saying gutter",
    );
  });

  test("an exact name beats a prefix of a longer one", () => {
    const exact = rec({ id: "x", title: "Dan", fields: [{ text: "dan", weight: WEIGHT.title }] });
    const longer = rec({ id: "y", title: "Danielle", fields: [{ text: "danielle", weight: WEIGHT.title }] });
    assert.equal(search([longer, exact], "dan")[0].record.id, "x");
  });

  test("a correct spelling beats a near miss", () => {
    const right = rec({ id: "r", title: "Reyes", fields: [{ text: "reyes", weight: WEIGHT.title }] });
    const near = rec({ id: "n", title: "Reyas", fields: [{ text: "reyas", weight: WEIGHT.title }] });
    assert.equal(search([near, right], "reyes")[0].record.id, "r");
  });

  test("ties break on recency, then title — the same order every keystroke", () => {
    const old = rec({ id: "o", title: "Same Name", at: 100, fields: [{ text: "same name", weight: 1 }] });
    const recent = rec({ id: "n", title: "Same Name", at: 900, fields: [{ text: "same name", weight: 1 }] });
    assert.equal(search([old, recent], "same name")[0].record.id, "n");
    assert.deepEqual(
      search([old, recent], "same").map((h) => h.record.id),
      search([recent, old], "same").map((h) => h.record.id),
      "input order must not change output order",
    );
  });

  test("the limit is honoured", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      rec({ id: `m${i}`, title: `Match ${i}`, fields: [{ text: `match ${i}`, weight: 1 }] }),
    );
    assert.equal(search(many, "match", 10).length, 10);
  });
});

describe("grouping, for the screen", () => {
  test("sections come back in a fixed order and empty ones are dropped", () => {
    const hits = search(
      [
        rec({ kind: "service", id: "s", title: "Gutter clean", fields: [{ text: "gutter clean", weight: 1 }] }),
        rec({ kind: "customer", id: "c", title: "Gutter Guy", fields: [{ text: "gutter guy", weight: 1 }] }),
      ],
      "gutter",
    );
    const groups = groupHits(hits);
    assert.deepEqual(groups.map((g) => g.kind), ["customer", "service"], "registry order, not hit order");
    assert.ok(groups.every((g) => g.hits.length > 0));
  });

  test("every kind has a heading", () => {
    for (const kind of SEARCH_KINDS) {
      assert.ok(KIND_LABEL[kind]?.length > 0, kind);
    }
  });
});

describe("weights are ordered the way the ranking assumes", () => {
  test("a title counts for more than a note", () => {
    assert.ok(WEIGHT.title > WEIGHT.identifier);
    assert.ok(WEIGHT.identifier > WEIGHT.address);
    assert.ok(WEIGHT.address > WEIGHT.detail);
    assert.ok(WEIGHT.detail > WEIGHT.label);
    assert.ok(WEIGHT.label > WEIGHT.note);
  });
});
