import { Timestamp } from "firebase/firestore";

import type { AppNotification } from "@/lib/db/notifications";
import type { SavedService } from "@/lib/db/services";
import {
  computeTotals,
  DEFAULT_TAX_RATE_PCT,
  sumPayments,
  type BusinessDocument,
  type DocumentKind,
  type DocumentStatus,
  type LineItem,
  type Payment,
} from "@/lib/documents";
import type { PipelineStage } from "@/lib/pipeline";
import type {
  AppUser,
  Customer,
  Job,
  KnockRoute,
  Note,
  Quote,
  Territory,
} from "@/lib/types";

/**
 * Demo data.
 *
 * Real Oldham County street names and a plausible spread of work, because a
 * demo full of "Test Customer 1" tells you nothing about whether the app is
 * usable. Coordinates are genuine La Grange / Crestwood / Pewee Valley
 * positions so the map looks like an actual route.
 */

export const DEMO_NICK = "demo-nick";
export const DEMO_DANA = "demo-dana";

const now = Date.now();
const ago = (days: number) => Timestamp.fromMillis(now - days * 86_400_000);
const hoursAgo = (hours: number) => Timestamp.fromMillis(now - hours * 3_600_000);

/** Today at a given hour, so the schedule always has something on it. */
function todayAt(hour: number, minute = 0): Timestamp {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return Timestamp.fromDate(d);
}

/**
 * A moment inside the current week, expressed as a fraction of the week so far.
 * Used for the pins logged "this week" so the dashboard's door count is never
 * zero whichever day someone opens the demo.
 */
function thisWeek(fractionOfWeekSoFar: number): Timestamp {
  const nowDate = new Date();
  const start = new Date(nowDate);
  start.setDate(nowDate.getDate() - nowDate.getDay()); // Sunday, as the dashboard counts it
  start.setHours(8, 0, 0, 0);
  const span = Math.max(nowDate.getTime() - start.getTime(), 3_600_000);
  return Timestamp.fromMillis(start.getTime() + span * fractionOfWeekSoFar);
}

function inDays(days: number, hour: number): Timestamp {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return Timestamp.fromDate(d);
}

export const demoUsers: AppUser[] = [
  {
    uid: DEMO_NICK,
    displayName: "Nick",
    role: "crew",
    phone: "5025550147",
    currentLat: 38.4076,
    currentLng: -85.3791,
    lastLocationUpdate: hoursAgo(0.05),
    isActive: true,
    color: null,
    mutedNotifications: [],
    quietHours: true,
  },
  {
    uid: DEMO_DANA,
    displayName: "Dana",
    role: "crew",
    phone: "5025550188",
    currentLat: 38.4102,
    currentLng: -85.3744,
    lastLocationUpdate: hoursAgo(0.1),
    isActive: true,
    color: null,
    mutedNotifications: [],
    quietHours: true,
  },
];

function note(
  text: string,
  kind: Note["kind"],
  uid: string,
  name: string,
  days: number,
): Note {
  return {
    id: `n-${Math.random().toString(16).slice(2)}`,
    text,
    kind,
    authorUid: uid,
    authorName: name,
    createdAt: ago(days),
  };
}

interface Seed {
  id: string;
  first: string;
  last: string;
  address: string;
  lat: number;
  lng: number;
  status: Customer["status"];
  stage: PipelineStage;
  value: number;
  services: Customer["serviceTypes"];
  by: string;
  byName: string;
  contactedDays: number | null;
  lifetime: number;
  source?: Customer["source"];
  /** Overrides the derived creation time, for pins logged this week. */
  createdAt?: Timestamp;
  notes: Note[];
}

const seeds: Seed[] = [
  {
    id: "d-oakley",
    first: "Marta",
    last: "Oakley",
    address: "1420 Oak Ridge Dr, La Grange, KY 40031",
    lat: 38.4081,
    lng: -85.3812,
    status: "customer",
    stage: "paid",
    value: 450,
    services: ["pressure_washing"],
    by: DEMO_NICK,
    byName: "Nick",
    contactedDays: 2,
    lifetime: 850,
    notes: [
      note("Driveway and back patio done. Paid by card on the spot.", "note", DEMO_NICK, "Nick", 2),
      note("Payment received — $450", "stage_change", DEMO_NICK, "Nick", 2),
    ],
  },
  {
    id: "d-whitfield",
    first: "Ray",
    last: "Whitfield",
    address: "77 Elm Hollow Ct, Crestwood, KY 40014",
    lat: 38.3372,
    lng: -85.4719,
    status: "quoted",
    stage: "estimate_sent",
    value: 620,
    services: ["landscaping", "snow_removal"],
    by: DEMO_DANA,
    byName: "Dana",
    contactedDays: 5,
    lifetime: 0,
    notes: [
      note("Wants the whole side yard cleared before the first frost.", "note", DEMO_DANA, "Dana", 6),
      note("Estimate for $620 sent", "stage_change", DEMO_DANA, "Dana", 5),
      note("Any chance you could do it before the frost?", "sms_in", "customer", "Ray Whitfield", 4),
      note(
        "We can. Penciling you in for the week of the 14th — I'll confirm Monday.",
        "sms_out",
        DEMO_DANA,
        "Dana",
        3.8,
      ),
    ],
  },
  {
    id: "d-brennan",
    first: "Alice",
    last: "Brennan",
    address: "312 Sycamore Ln, Pewee Valley, KY 40056",
    lat: 38.3103,
    lng: -85.4783,
    status: "customer",
    stage: "awaiting_payment",
    value: 380,
    services: ["pressure_washing"],
    by: DEMO_NICK,
    byName: "Nick",
    contactedDays: 1,
    lifetime: 380,
    notes: [
      note("Siding and walkway finished. Invoice left in the door.", "note", DEMO_NICK, "Nick", 1),
      note(
        "Hi Alice, your estimate for the siding and walkway is $380. Reply STOP to opt out.",
        "sms_out",
        DEMO_DANA,
        "Dana",
        2,
      ),
      note(
        "That looks great, when can you start?",
        "sms_in",
        "customer",
        "Alice Brennan",
        0.2,
      ),
    ],
  },
  {
    id: "d-castellano",
    first: "Dev",
    last: "Castellano",
    address: "88 Ridgemoor Way, La Grange, KY 40031",
    lat: 38.4148,
    lng: -85.3702,
    status: "customer",
    stage: "job_scheduled",
    value: 540,
    services: ["pressure_washing", "landscaping"],
    by: DEMO_DANA,
    byName: "Dana",
    contactedDays: 3,
    lifetime: 0,
    notes: [note("Booked in for Thursday morning. Gate code 4417.", "note", DEMO_DANA, "Dana", 3)],
  },
  {
    id: "d-nolan",
    first: "Priya",
    last: "Nolan",
    address: "9 Pine Bluff Rd, Pewee Valley, KY 40056",
    lat: 38.3129,
    lng: -85.4841,
    status: "quoted",
    stage: "estimate_accepted",
    value: 295,
    services: ["snow_removal"],
    by: DEMO_NICK,
    byName: "Nick",
    contactedDays: 1,
    lifetime: 0,
    notes: [
      note("Said yes to the season rate. Needs scheduling.", "note", DEMO_NICK, "Nick", 1),
      note("Do you salt the walkway too or just the drive?", "sms_in", "customer", "Priya Nolan", 0.6),
    ],
  },
  {
    id: "d-fb-hargrove",
    first: "Tom",
    last: "Hargrove",
    address: "",
    lat: 0,
    lng: 0,
    status: "lead",
    stage: "new_lead",
    value: 0,
    services: [],
    by: "meta",
    byName: "Facebook lead",
    contactedDays: 0,
    lifetime: 0,
    source: "meta_lead_ad",
    createdAt: hoursAgo(2),
    notes: [
      note(
        "Enquiry from a Facebook/Instagram lead form.\nEmail: tom.hargrove@example.com\nwhich service do you need: Driveway and sidewalk wash",
        "lead_import",
        "meta",
        "Facebook lead",
        0,
      ),
    ],
  },
  {
    id: "d-fb-oyelaran",
    first: "Ada",
    last: "Oyelaran",
    address: "",
    lat: 0,
    lng: 0,
    status: "lead",
    stage: "new_lead",
    value: 0,
    services: [],
    by: "meta",
    byName: "Facebook lead",
    contactedDays: 0,
    lifetime: 0,
    source: "meta_lead_ad",
    createdAt: hoursAgo(9),
    notes: [
      note(
        "Enquiry from a Facebook/Instagram lead form.\nEmail: a.oyelaran@example.com",
        "lead_import",
        "meta",
        "Facebook lead",
        0,
      ),
    ],
  },
  {
    id: "d-mcabee",
    first: "Glen",
    last: "McAbee",
    address: "204 Covered Bridge Rd, La Grange, KY 40031",
    lat: 38.4021,
    lng: -85.3654,
    status: "lead",
    stage: "new_lead",
    value: 0,
    services: [],
    by: DEMO_NICK,
    byName: "Nick",
    contactedDays: 9,
    lifetime: 0,
    notes: [note("Not home. Truck in the drive, try an evening.", "note", DEMO_NICK, "Nick", 9)],
  },
  {
    id: "d-vasquez",
    first: "Renata",
    last: "Vasquez",
    address: "1180 Buckner Station Rd, Buckner, KY 40010",
    lat: 38.3843,
    lng: -85.4419,
    status: "lead",
    stage: "new_lead",
    value: 0,
    services: ["pressure_washing"],
    by: DEMO_NICK,
    byName: "Nick",
    contactedDays: 0,
    lifetime: 0,
    createdAt: thisWeek(0.25),
    notes: [note("Interested in the driveway. Wants a price by the weekend.", "note", DEMO_NICK, "Nick", 0)],
  },
  {
    id: "d-ferris",
    first: "Hal",
    last: "Ferris",
    address: "43 Deer Run Trl, La Grange, KY 40031",
    lat: 38.3968,
    lng: -85.3873,
    status: "not_interested",
    stage: "lost",
    value: 0,
    services: [],
    by: DEMO_NICK,
    byName: "Nick",
    contactedDays: 0,
    lifetime: 0,
    createdAt: thisWeek(0.4),
    notes: [note("Just had it done last month.", "note", DEMO_NICK, "Nick", 0)],
  },
  {
    id: "d-okonkwo",
    first: "Ifeoma",
    last: "Okonkwo",
    address: "902 Sleepy Hollow Rd, Pewee Valley, KY 40056",
    lat: 38.3168,
    lng: -85.4712,
    status: "lead",
    stage: "new_lead",
    value: 0,
    services: ["landscaping"],
    by: DEMO_DANA,
    byName: "Dana",
    contactedDays: 0,
    lifetime: 0,
    createdAt: thisWeek(0.6),
    notes: [note("Beds need clearing before autumn. Call back Thursday.", "note", DEMO_DANA, "Dana", 0)],
  },
  {
    id: "d-tackett",
    first: "Brian",
    last: "Tackett",
    address: "26 Willow Bend Dr, Crestwood, KY 40014",
    lat: 38.3298,
    lng: -85.4801,
    status: "lead",
    stage: "new_lead",
    value: 0,
    services: ["pressure_washing", "snow_removal"],
    by: DEMO_DANA,
    byName: "Dana",
    contactedDays: 0,
    lifetime: 0,
    createdAt: thisWeek(0.85),
    notes: [note("Not home — card in the door.", "note", DEMO_DANA, "Dana", 0)],
  },
  {
    id: "d-sutter",
    first: "",
    last: "",
    address: "51 Harmony Landing Rd, Goshen, KY 40026",
    lat: 38.4009,
    lng: -85.5624,
    status: "do_not_knock",
    stage: "lost",
    value: 0,
    services: [],
    by: DEMO_DANA,
    byName: "Dana",
    contactedDays: 20,
    lifetime: 0,
    notes: [note("Asked us not to call again. Marked do not knock.", "status_change", DEMO_DANA, "Dana", 20)],
  },
  {
    id: "d-perrone",
    first: "Lou",
    last: "Perrone",
    address: "615 Maple Grove Ct, Crestwood, KY 40014",
    lat: 38.3341,
    lng: -85.4658,
    status: "not_interested",
    stage: "lost",
    value: 0,
    services: [],
    by: DEMO_NICK,
    byName: "Nick",
    contactedDays: 14,
    lifetime: 0,
    notes: [note("Has a nephew who does it. Politely declined.", "note", DEMO_NICK, "Nick", 14)],
  },
];

export const demoCustomers: Customer[] = seeds.map((s) => ({
  id: s.id,
  firstName: s.first,
  lastName: s.last,
  phone: "5025550100",
  email: "",
  address: s.address,
  lat: s.lat,
  lng: s.lng,
  status: s.status,
  notes: [...s.notes].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()),
  tags: s.source === "meta_lead_ad" ? ["facebook"] : [],
  serviceTypes: s.services,
  createdAt: s.createdAt ?? ago(s.contactedDays === null ? 30 : s.contactedDays + 4),
  createdBy: s.by,
  createdByName: s.byName,
  lastContactedAt: s.contactedDays === null ? null : ago(s.contactedDays),
  lastContactedBy: s.by,
  lastContactedByName: s.byName,
  lifetimeValue: s.lifetime,
  pipelineStage: s.stage,
  // Falls back to creation time so a pin logged this morning does not read as
  // "in this stage for 3 seconds".
  pipelineChangedAt: s.createdAt ?? ago(s.contactedDays ?? 3),
  pipelineValue: s.value,
  source: s.source ?? "door_knock",
  sourceLeadId: s.source === "meta_lead_ad" ? `demo-${s.id}` : null,
  updatedAt: s.createdAt ?? ago(s.contactedDays ?? 3),
  updatedBy: s.by,
  updatedByName: s.byName,
}));

function job(
  id: string,
  customerId: string,
  serviceType: Job["serviceType"],
  start: Timestamp,
  hours: number,
  price: number,
  assigned: string[],
  status: Job["status"],
  paid: boolean,
): Job {
  const uid = assigned[0] ?? DEMO_NICK;
  const name = uid === DEMO_NICK ? "Nick" : "Dana";
  return {
    id,
    customerId,
    serviceType,
    scheduledStart: start,
    scheduledEnd: Timestamp.fromMillis(start.toMillis() + hours * 3_600_000),
    status,
    price,
    assignedTo: assigned,
    beforePhotos: [],
    afterPhotos: [],
    jobNotes: "",
    completedAt: status === "complete" ? start : null,
    completedBy: status === "complete" ? uid : null,
    paidAt: paid ? start : null,
    paidBy: paid ? uid : null,
    createdAt: Timestamp.fromMillis(start.toMillis() - 5 * 86_400_000),
    createdBy: uid,
    createdByName: name,
    updatedAt: start,
    updatedBy: uid,
    updatedByName: name,
  };
}

export const demoJobs: Job[] = [
  // Today, so the dashboard and day view always have something in them.
  job("dj-1", "d-castellano", "pressure_washing", todayAt(9), 2, 540, [DEMO_NICK], "scheduled", false),
  job("dj-2", "d-brennan", "pressure_washing", todayAt(12, 30), 1.5, 380, [DEMO_NICK, DEMO_DANA], "complete", false),
  job("dj-3", "d-oakley", "landscaping", todayAt(15), 2, 300, [DEMO_DANA], "scheduled", false),

  job("dj-4", "d-nolan", "snow_removal", inDays(2, 8), 1.5, 295, [DEMO_DANA], "scheduled", false),
  job("dj-5", "d-castellano", "landscaping", inDays(3, 10), 3, 420, [DEMO_NICK], "scheduled", false),

  // History, so the reports screen has real bars.
  job("dj-6", "d-oakley", "pressure_washing", ago(12), 2, 450, [DEMO_NICK], "complete", true),
  job("dj-7", "d-oakley", "landscaping", ago(45), 2.5, 400, [DEMO_DANA], "complete", true),
  job("dj-8", "d-whitfield", "snow_removal", ago(70), 1, 220, [DEMO_NICK], "complete", true),
  job("dj-9", "d-brennan", "pressure_washing", ago(100), 3, 610, [DEMO_DANA], "complete", true),
];

export const demoQuotes: Quote[] = [
  {
    id: "dq-1",
    customerId: "d-whitfield",
    serviceType: "landscaping",
    amount: 620,
    sentAt: ago(5),
    sentBy: DEMO_DANA,
    sentByName: "Dana",
    status: "no_response",
    followUpCount: 1,
    lastFollowUpAt: ago(1),
  },
  {
    id: "dq-2",
    customerId: "d-nolan",
    serviceType: "snow_removal",
    amount: 295,
    sentAt: ago(4),
    sentBy: DEMO_NICK,
    sentByName: "Nick",
    status: "accepted",
    followUpCount: 0,
    lastFollowUpAt: null,
  },
  {
    id: "dq-3",
    customerId: "d-oakley",
    serviceType: "pressure_washing",
    amount: 450,
    sentAt: ago(18),
    sentBy: DEMO_NICK,
    sentByName: "Nick",
    status: "accepted",
    followUpCount: 0,
    lastFollowUpAt: null,
  },
  {
    id: "dq-4",
    customerId: "d-perrone",
    serviceType: "pressure_washing",
    amount: 210,
    sentAt: ago(16),
    sentBy: DEMO_NICK,
    sentByName: "Nick",
    status: "declined",
    followUpCount: 2,
    lastFollowUpAt: ago(9),
  },
];

/**
 * Estimates and invoices for the demo.
 *
 * Numbers continue from where Invoice Fly left off, same as the real books, so
 * the sequence in the preview looks like the sequence in production. The spread
 * is deliberate: one draft being written, one estimate sitting with a customer,
 * one invoice half paid and one settled — every state the screen can show.
 */
function line(
  id: string,
  name: string,
  description: string,
  quantity: number,
  unitPrice: number,
  taxable = true,
): LineItem {
  return { id, name, description, quantity, unitPrice, taxable };
}

function demoDoc(
  id: string,
  number: string,
  kind: DocumentKind,
  status: DocumentStatus,
  customerId: string,
  customerName: string,
  serviceType: Customer["serviceTypes"][number],
  lineItems: LineItem[],
  options: {
    discount?: number;
    issuedDaysAgo: number;
    dueInDays?: number;
    payments?: Payment[];
    notes?: string;
    convertedFromId?: string;
    convertedToId?: string;
  },
): BusinessDocument {
  const discount = options.discount ?? 0;
  const totals = computeTotals(lineItems, discount, DEFAULT_TAX_RATE_PCT);
  const payments = options.payments ?? [];
  const amountPaid = sumPayments(payments);

  return {
    id,
    number,
    kind,
    status,
    customerId,
    customerName,
    serviceType,
    lineItems,
    discount: totals.discount,
    taxRatePct: DEFAULT_TAX_RATE_PCT,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    total: totals.total,
    payments,
    amountPaid,
    balanceDue: Number((totals.total - amountPaid).toFixed(2)),
    notes: options.notes ?? "",
    issuedAt: ago(options.issuedDaysAgo),
    dueAt:
      options.dueInDays === undefined
        ? null
        : ago(options.issuedDaysAgo - options.dueInDays),
    sentAt: status === "draft" ? null : ago(options.issuedDaysAgo),
    settledAt: status === "paid" || status === "accepted" ? ago(1) : null,
    convertedFromId: options.convertedFromId ?? null,
    convertedToId: options.convertedToId ?? null,
    createdAt: ago(options.issuedDaysAgo),
    createdBy: DEMO_NICK,
    createdByName: "Nick",
    updatedAt: ago(options.issuedDaysAgo),
    updatedBy: DEMO_NICK,
    updatedByName: "Nick",
  };
}

/**
 * The price book, as it would look after a season of quoting.
 *
 * In the real app nobody types these in — they accumulate from estimates. The
 * demo seeds them so the picker has something in it on the first tap, with
 * usage counts spread the way they really would be: the house wash sells
 * constantly, the roof wash twice a year.
 */
function demoService(
  id: string,
  name: string,
  description: string,
  unitPrice: number,
  serviceType: Customer["serviceTypes"][number],
  timesUsed: number,
  lastUsedDaysAgo: number,
  taxable = true,
): SavedService {
  return {
    id,
    name,
    description,
    unitPrice,
    serviceType,
    taxable,
    timesUsed,
    lastUsedAt: ago(lastUsedDaysAgo),
    createdAt: ago(lastUsedDaysAgo + 60),
    createdBy: DEMO_NICK,
    createdByName: "Nick",
    updatedAt: ago(lastUsedDaysAgo),
    updatedBy: DEMO_NICK,
    updatedByName: "Nick",
  };
}

export const demoServices: SavedService[] = [
  demoService(
    "ds-1",
    "House wash",
    "Soft wash of all siding, soffits and gutter faces. No pressure on the siding.",
    450,
    "pressure_washing",
    24,
    2,
  ),
  demoService(
    "ds-2",
    "Driveway and walk",
    "Surface-cleaned and rinsed, front walk included. Oil stains lightened, not guaranteed removed.",
    165,
    "pressure_washing",
    19,
    2,
  ),
  demoService(
    "ds-3",
    "Gutter brightening",
    "Removes the black tiger stripes on the gutter faces. Exteriors only.",
    120,
    "pressure_washing",
    11,
    9,
  ),
  demoService(
    "ds-4",
    "Hardwood mulch, installed",
    "Double-shredded brown hardwood, 2 inches deep. Price is per cubic yard.",
    42,
    "landscaping",
    8,
    5,
  ),
  demoService(
    "ds-5",
    "Spring cleanup",
    "Beds cleared, shrubs shaped, lawn cut and edged, everything hauled.",
    420,
    "landscaping",
    6,
    14,
  ),
  demoService(
    "ds-6",
    "Snow clearing, per visit",
    "Driveway, front walk and a path to the mailbox. Salted. Billed per visit.",
    95,
    "snow_removal",
    5,
    3,
  ),
  demoService(
    "ds-7",
    "Haul away debris",
    "Everything cut or pulled leaves with us the same day.",
    60,
    "landscaping",
    4,
    5,
    false,
  ),
  demoService(
    "ds-8",
    "Roof soft wash",
    "Low-pressure treatment for moss and black streaking. Shingle-safe.",
    675,
    "pressure_washing",
    2,
    41,
  ),
];

export const demoDocuments: BusinessDocument[] = [
  demoDoc(
    "dd-1",
    "8904",
    "estimate",
    "sent",
    "d-whitfield",
    "Ray Whitfield",
    "landscaping",
    [
      line(
        "dd-1-a",
        "Bed cleanout and re-edge",
        "All front and side beds: pull weeds, cut a fresh spade edge, blow out.",
        1,
        340,
      ),
      line(
        "dd-1-b",
        "Hardwood mulch, installed",
        "Double-shredded brown hardwood, 2 inches deep. Price is per cubic yard.",
        6,
        42,
      ),
      line(
        "dd-1-c",
        "Haul away debris",
        "Everything cut or pulled leaves with us the same day.",
        1,
        60,
        false,
      ),
    ],
    {
      issuedDaysAgo: 5,
      dueInDays: 30,
      notes: "Price holds for 30 days. We'd need the side gate open on the day.",
    },
  ),
  demoDoc(
    "dd-2",
    "8905",
    "invoice",
    "paid",
    "d-brennan",
    "Alice Brennan",
    "pressure_washing",
    [
      line(
        "dd-2-a",
        "House wash, two storey",
        "Soft wash of all four elevations including soffits and gutter faces. No pressure on the siding.",
        1,
        380,
      ),
      line(
        "dd-2-b",
        "Driveway and walk",
        "Surface-cleaned and rinsed, front walk included. Oil stains lightened, not guaranteed removed.",
        1,
        165,
      ),
    ],
    {
      issuedDaysAgo: 9,
      dueInDays: 14,
      payments: [
        {
          id: "dd-2-p1",
          amount: 577.7,
          receivedAt: ago(7),
          method: "Card",
          recordedBy: DEMO_NICK,
          recordedByName: "Nick",
        },
      ],
    },
  ),
  demoDoc(
    "dd-3",
    "8906",
    "invoice",
    "partial",
    "d-oakley",
    "Marta Oakley",
    "pressure_washing",
    [
      line(
        "dd-3-a",
        "House wash",
        "Soft wash of all siding, soffits and gutter faces.",
        1,
        450,
      ),
      line(
        "dd-3-b",
        "Gutter brightening",
        "Removes the black tiger stripes on the gutter faces. Exteriors only.",
        1,
        120,
      ),
      line(
        "dd-3-c",
        "Back patio and steps",
        "Stamped concrete, surface-cleaned and rinsed.",
        1,
        180,
      ),
    ],
    {
      discount: 50,
      issuedDaysAgo: 12,
      dueInDays: 14,
      payments: [
        {
          id: "dd-3-p1",
          amount: 400,
          receivedAt: ago(6),
          method: "Check 2214",
          recordedBy: DEMO_DANA,
          recordedByName: "Dana",
        },
      ],
      notes: "$50 off for booking the driveway at the same time.",
    },
  ),
  demoDoc(
    "dd-4",
    "8907",
    "invoice",
    "sent",
    "d-nolan",
    "Priya Nolan",
    "snow_removal",
    [
      line(
        "dd-4-a",
        "Snow clearing, per visit",
        "Driveway, front walk and a path to the mailbox. Salted. Billed per visit.",
        3,
        95,
      ),
    ],
    { issuedDaysAgo: 3, dueInDays: 14 },
  ),
  demoDoc(
    "dd-5",
    "8908",
    "estimate",
    "draft",
    "d-castellano",
    "Dev Castellano",
    "landscaping",
    [
      line(
        "dd-5-a",
        "Spring cleanup",
        "Beds cleared, shrubs shaped, lawn cut and edged, everything hauled.",
        1,
        420,
      ),
    ],
    { issuedDaysAgo: 0, notes: "Still measuring the back border." },
  ),
];

/**
 * Two routes: one being walked right now, one planned for tomorrow and handed
 * to the other person. Between them the list screen shows a progress bar, an
 * assignment, and both of the states that are not "planned".
 */
export const demoKnockRoutes: KnockRoute[] = [
  {
    id: "dr-1",
    name: "Ridgemoor sweep",
    walkDate: todayAt(14),
    assignedTo: [DEMO_NICK],
    stopIds: ["d-castellano", "d-oakley", "d-mcabee"],
    knockedIds: ["d-castellano"],
    status: "walking",
    notes: "Start at the top of the hill and work down.",
    createdAt: hoursAgo(26),
    createdBy: DEMO_NICK,
    createdByName: "Nick",
    updatedAt: hoursAgo(1),
    updatedBy: DEMO_NICK,
    updatedByName: "Nick",
  },
  {
    id: "dr-2",
    name: "Pewee Valley follow-ups",
    walkDate: inDays(1, 10),
    assignedTo: [DEMO_DANA],
    stopIds: ["d-brennan", "d-nolan"],
    knockedIds: [],
    status: "planned",
    notes: "",
    createdAt: hoursAgo(4),
    createdBy: DEMO_NICK,
    createdByName: "Nick",
    updatedAt: hoursAgo(4),
    updatedBy: DEMO_NICK,
    updatedByName: "Nick",
  },
];

/**
 * One claimed territory around the La Grange pins and one unclaimed patch, so
 * the panel shows coverage, an owner colour and the grey unclaimed state.
 */
export const demoTerritories: Territory[] = [
  {
    id: "dt-1",
    name: "Ridgemoor & Oak Ridge",
    boundary: [
      { lat: 38.4185, lng: -85.3855 },
      { lat: 38.4185, lng: -85.3635 },
      { lat: 38.3985, lng: -85.3635 },
      { lat: 38.3985, lng: -85.3855 },
    ],
    assignedTo: [DEMO_NICK],
    notes: "Big lots, most of them have a driveway worth washing.",
    active: true,
    createdAt: hoursAgo(50),
    createdBy: DEMO_NICK,
    createdByName: "Nick",
    updatedAt: hoursAgo(50),
    updatedBy: DEMO_NICK,
    updatedByName: "Nick",
  },
  {
    id: "dt-2",
    name: "Pewee Valley south",
    boundary: [
      { lat: 38.3175, lng: -85.4895 },
      { lat: 38.3175, lng: -85.4735 },
      { lat: 38.3065, lng: -85.4735 },
      { lat: 38.3065, lng: -85.4895 },
    ],
    assignedTo: [],
    notes: "",
    active: true,
    createdAt: hoursAgo(20),
    createdBy: DEMO_NICK,
    createdByName: "Nick",
    updatedAt: hoursAgo(20),
    updatedBy: DEMO_NICK,
    updatedByName: "Nick",
  },
];

export const demoNotifications: AppNotification[] = [
  {
    id: "dn-1",
    forUid: DEMO_NICK,
    actorUid: "system",
    actorName: "Facebook",
    type: "lead_new",
    title: "New lead",
    body: "Tom Hargrove submitted an enquiry. Call them while it's warm.",
    customerId: "d-fb-hargrove",
    jobId: null,
    documentId: null,
    createdAt: hoursAgo(2),
    readAt: null,
  },
  {
    id: "dn-2",
    forUid: DEMO_NICK,
    actorUid: "system",
    actorName: "Alice Brennan",
    type: "sms_in",
    title: "Customer replied",
    body: "Alice Brennan: That looks great, when can you start?",
    customerId: "d-brennan",
    jobId: null,
    documentId: null,
    createdAt: hoursAgo(3),
    readAt: null,
  },
  {
    id: "dn-3",
    forUid: DEMO_NICK,
    actorUid: DEMO_DANA,
    actorName: "Dana",
    type: "payment_received",
    title: "Payment received",
    body: "Marta Oakley · $1,160.70 · Pressure washing",
    customerId: "d-oakley",
    jobId: null,
    documentId: "dd-1",
    createdAt: hoursAgo(5),
    readAt: null,
  },
  {
    id: "dn-4",
    forUid: DEMO_NICK,
    actorUid: DEMO_DANA,
    actorName: "Dana",
    type: "job_created",
    title: "Job scheduled",
    body: "Priya Nolan · Snow removal · in two days, 8:00 AM",
    customerId: "d-nolan",
    jobId: "dj-4",
    documentId: null,
    createdAt: hoursAgo(6),
    readAt: null,
  },
  {
    id: "dn-5",
    forUid: DEMO_NICK,
    actorUid: DEMO_DANA,
    actorName: "Dana",
    type: "job_completed",
    title: "Job completed",
    body: "Alice Brennan · Pressure washing",
    customerId: "d-brennan",
    jobId: "dj-2",
    documentId: null,
    createdAt: hoursAgo(28),
    readAt: hoursAgo(27),
  },
];
