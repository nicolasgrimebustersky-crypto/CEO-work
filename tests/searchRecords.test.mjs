/**
 * What is actually searchable.
 *
 * `lib/search.ts` scores text; this decides which text it ever sees. A field
 * missing from a builder is invisible in exactly the way the mapper bugs in
 * this repo were invisible — nothing fails, no type complains, and the only
 * symptom is somebody saying "it can't find her" about a record that is
 * plainly there.
 *
 * So these search for each field through the real engine rather than
 * inspecting the record's shape. Asserting `fields.length === 9` would pass
 * with nine copies of the wrong field.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { search } from "../lib/search.ts";
import {
  buildSearchIndex,
  customerRecord,
  documentRecord,
  jobRecord,
  routeRecord,
  serviceRecord,
} from "../lib/searchRecords.ts";

const stamp = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const AT = Date.parse("2026-10-01T12:00:00Z");

const customer = {
  id: "c1",
  firstName: "Dana",
  lastName: "Reyes",
  phone: "(502) 555-0199",
  email: "dana@example.com",
  address: "12 Oak Road, Crestwood KY",
  addresses: [{ address: "9 Elm Street, Pewee Valley KY" }],
  tags: ["repeat", "referral"],
  pipelineStage: "estimate_sent",
  serviceTypes: ["pressure_washing"],
  notes: [{ text: "Wants the gutters done before winter" }, { text: "Dog in the back garden" }],
  lastContactedAt: stamp(AT),
  createdAt: stamp(AT),
};

const document = {
  id: "d1",
  kind: "estimate",
  number: "EST-1042",
  customerName: "Dana Reyes",
  status: "sent",
  serviceType: "pressure_washing",
  total: 450.4,
  lineItems: [{ name: "Two-storey house wash", description: "Soft wash, includes soffits" }],
  notes: "Access via the side gate",
  issuedAt: stamp(AT),
  createdAt: stamp(AT),
};

const job = {
  id: "j1",
  customerId: "c1",
  serviceType: "snow_removal",
  status: "scheduled",
  price: 180,
  jobNotes: "Salt the top of the drive",
  scheduledStart: stamp(AT),
  createdAt: stamp(AT),
};

const service = {
  id: "s1",
  name: "Gutter clearing",
  description: "Hand clear and flush downspouts",
  unitPrice: 225,
  serviceType: "pressure_washing",
  lastUsedAt: stamp(AT),
};

const route = { id: "r1", name: "Ridgemoor sweep", status: "planned", stopIds: ["c1", "c2"], createdAt: stamp(AT) };

const INDEX = buildSearchIndex({
  customers: [customer],
  documents: [document],
  jobs: [job],
  services: [service],
  knockRoutes: [route],
});

const finds = (query, id) => search(INDEX, query).some((hit) => hit.record.id === id);

describe("a customer is findable by everything on their record", () => {
  for (const [what, query] of [
    ["first name", "dana"],
    ["last name", "reyes"],
    ["both names", "dana reyes"],
    ["phone, as typed", "(502) 555-0199"],
    ["phone, plain digits", "5025550199"],
    ["last four of the phone", "0199"],
    ["email", "dana@example.com"],
    ["street", "oak road"],
    ["town", "crestwood"],
    ["a second address", "pewee"],
    ["a tag", "referral"],
    ["their pipeline stage", "estimate sent"],
    ["a note from months ago", "gutters"],
    ["a different note", "dog"],
    ["a misspelling", "reyez"],
  ]) {
    test(what, () => {
      assert.ok(finds(query, "c1"), `could not find the customer by ${what}: "${query}"`);
    });
  }

  test("and the result links to their record", () => {
    assert.match(customerRecord(customer).href, /customers\/detail\?id=c1/);
  });

  test("a customer with no name at all still has a title", () => {
    const blank = customerRecord({ ...customer, firstName: "", lastName: "" });
    assert.ok(blank.title.length > 0, "an empty title renders as an unreadable blank row");
  });
});

describe("an estimate is findable by everything on the paperwork", () => {
  for (const [what, query] of [
    ["its number", "EST-1042"],
    ["part of its number", "1042"],
    ["the customer it is for", "dana reyes"],
    ["its amount", "450"],
    ["a line item", "house wash"],
    ["a line item's description", "soffits"],
    ["its status", "sent"],
    ["a note on it", "side gate"],
  ]) {
    test(what, () => {
      assert.ok(finds(query, "d1"), `could not find the estimate by ${what}: "${query}"`);
    });
  }

  test("the total is matched rounded, because nobody searches the cents", () => {
    assert.ok(finds("450", "d1"));
  });

  test("and it links to the document", () => {
    assert.match(documentRecord(document).href, /invoices\/detail\?id=d1/);
  });
});

describe("jobs, services and routes", () => {
  test("a job is findable by the customer it is for", () => {
    assert.ok(finds("dana", "j1"), "the Crestwood job is how somebody refers to one");
  });

  test("a job is findable by its service and its notes", () => {
    assert.ok(finds("snow", "j1"));
    assert.ok(finds("salt", "j1"));
  });

  test("a job whose customer is gone still appears, under a name that says so", () => {
    const orphan = buildSearchIndex({
      customers: [],
      documents: [],
      jobs: [job],
      services: [],
      knockRoutes: [],
    });
    assert.equal(orphan.length, 1);
    assert.match(orphan[0].title, /former customer/i);
  });

  test("a price-book service is findable by name and by price", () => {
    assert.ok(finds("gutter clearing", "s1"));
    assert.ok(finds("225", "s1"));
    assert.ok(finds("downspouts", "s1"), "and by its description");
  });

  test("a route is findable by name", () => {
    assert.ok(finds("ridgemoor", "r1"));
    assert.match(routeRecord(route).href, /routes\/detail\?id=r1/);
  });

  test("a job links to the schedule and a service to the price book", () => {
    assert.ok(jobRecord(job, "Dana Reyes").href.length > 0);
    assert.ok(serviceRecord(service).href.length > 0);
  });
});

describe("the index as a whole", () => {
  test("carries all five kinds", () => {
    assert.deepEqual(
      [...new Set(INDEX.map((r) => r.kind))].sort(),
      ["customer", "document", "job", "route", "service"],
    );
  });

  test("every record has a title, a link and at least one searchable field", () => {
    // The structural floor. A record with no fields can never be found, and
    // one with no href is a result that does nothing when tapped.
    for (const record of INDEX) {
      assert.ok(record.title.trim().length > 0, `${record.kind} ${record.id} has no title`);
      assert.ok(record.href.length > 0, `${record.kind} ${record.id} has no link`);
      assert.ok(record.fields.length > 0, `${record.kind} ${record.id} has nothing to match on`);
      for (const field of record.fields) {
        assert.notEqual(field.text, "", `${record.kind} ${record.id} carries an empty field`);
        assert.ok(field.weight > 0, `${record.kind} ${record.id} has a weightless field`);
      }
    }
  });

  test("a bare door-knock lead carries no empty fields", () => {
    // The commonest real record: a name, a number, and nothing else yet. Every
    // other field normalises to "" and must be dropped rather than kept — an
    // empty field can never match anything, so carrying it is work done on
    // every keystroke for every record for no possible result. A mutation
    // removing the filter survived until this existed, because every other
    // fixture here is fully filled in.
    const sparse = customerRecord({
      ...customer,
      email: "",
      address: "",
      addresses: [],
      tags: [],
      serviceTypes: [],
      notes: [],
    });
    assert.ok(sparse.fields.length > 0, "a name and a number are still searchable");
    for (const field of sparse.fields) {
      assert.notEqual(field.text, "", `empty field kept: ${JSON.stringify(field)}`);
    }
    assert.ok(
      search([sparse], "dana").length === 1,
      "and the lead is still findable by the little it has",
    );
  });

  test("an empty app produces an empty index rather than throwing", () => {
    assert.deepEqual(
      buildSearchIndex({ customers: [], documents: [], jobs: [], services: [], knockRoutes: [] }),
      [],
    );
  });

  test("searching a person finds both them and their paperwork", () => {
    // The thing that makes one box worth having rather than five screens.
    const kinds = search(INDEX, "dana").map((hit) => hit.record.kind);
    assert.ok(kinds.includes("customer"));
    assert.ok(kinds.includes("document"));
    assert.ok(kinds.includes("job"));
  });
});
