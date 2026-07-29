/**
 * Seeds the emulators with two crew accounts and a handful of customers, jobs
 * and quotes. Used by scripts/test-api.sh, and handy on its own when you want
 * realistic data to click around in:
 *
 *   npm run emulators                       # in one terminal
 *   node scripts/seed-test-data.mjs         # in another
 *
 * Prints the two uids as JSON so a caller can feed them into CREW_UIDS.
 * Safe to re-run: it clears the emulator's accounts and documents first.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = process.env.FIREBASE_PROJECT ?? "demo-grimebusters";
// Ports are overridable so the API test harness can run on its own pair
// without colliding with an emulator session you already have open.
const AUTH_PORT = Number(process.env.AUTH_EMULATOR_PORT ?? 9099);
const FIRESTORE_PORT = Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8080);
const AUTH = `http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1`;

// Re-runnable: wipe the emulator's accounts so signUp doesn't hit EMAIL_EXISTS.
await fetch(`http://127.0.0.1:${AUTH_PORT}/emulator/v1/projects/${PROJECT}/accounts`, {
  method: "DELETE",
});

async function createUser(email, password) {
  const res = await fetch(`${AUTH}/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signUp failed: ${JSON.stringify(body)}`);
  return body.localId;
}

const nick = await createUser("nick@grimebusters.test", "test1234");
const dana = await createUser("dana@grimebusters.test", "test1234");
// A valid account that is deliberately NOT on the crew allowlist.
await createUser("mallory@example.test", "test1234");

const rules = readFileSync(join(repoRoot, "firestore.rules"), "utf8")
  .replace("REPLACE_WITH_FIRST_UID", nick)
  .replace("REPLACE_WITH_SECOND_UID", dana);

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules, host: "127.0.0.1", port: FIRESTORE_PORT },
});
await env.clearFirestore();

const ago = (days) => Timestamp.fromMillis(Date.now() - days * 86_400_000);

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  await setDoc(doc(db, "users", nick), {
    displayName: "Nick",
    phone: "5025550147",
    currentLat: 38.4076,
    currentLng: -85.3791,
    lastLocationUpdate: Timestamp.now(),
    isActive: true,
  });
  await setDoc(doc(db, "users", dana), {
    displayName: "Dana",
    phone: "5025550188",
    currentLat: 38.409,
    currentLng: -85.377,
    lastLocationUpdate: Timestamp.now(),
    isActive: true,
  });

  const customers = [
    {
      id: "cust-oak",
      firstName: "Marta",
      lastName: "Oakley",
      address: "1420 Oak Ridge Dr, La Grange, KY 40031",
      status: "customer",
      serviceTypes: ["pressure_washing"],
      createdBy: nick,
      createdByName: "Nick",
      lastContactedAt: ago(2),
      lifetimeValue: 850,
    },
    {
      id: "cust-elm",
      firstName: "Ray",
      lastName: "Whitfield",
      address: "77 Elm Hollow Ct, Crestwood, KY 40014",
      status: "quoted",
      serviceTypes: ["landscaping", "snow_removal"],
      createdBy: dana,
      createdByName: "Dana",
      lastContactedAt: ago(45),
      lifetimeValue: 0,
    },
    {
      id: "cust-pine",
      firstName: "",
      lastName: "",
      address: "9 Pine Bluff Rd, Pewee Valley, KY 40056",
      status: "do_not_knock",
      serviceTypes: [],
      createdBy: nick,
      createdByName: "Nick",
      lastContactedAt: null,
      lifetimeValue: 0,
    },
  ];

  for (const { id, ...rest } of customers) {
    await setDoc(doc(db, "customers", id), {
      phone: "5025550100",
      email: "",
      lat: 38.4,
      lng: -85.38,
      notes: [
        {
          id: `${id}-n1`,
          text: "Knocked, spoke to homeowner.",
          kind: "note",
          authorUid: rest.createdBy,
          authorName: rest.createdByName,
          createdAt: ago(3),
        },
      ],
      tags: [],
      createdAt: ago(10),
      lastContactedBy: rest.createdBy,
      lastContactedByName: rest.createdByName,
      updatedAt: ago(3),
      updatedBy: rest.createdBy,
      updatedByName: rest.createdByName,
      ...rest,
    });
  }

  // Completed jobs and answered quotes so the reports screen has real numbers.
  const jobs = [
    { id: "job-1", customerId: "cust-oak", serviceType: "pressure_washing", price: 450, days: 12, uid: nick, name: "Nick" },
    { id: "job-2", customerId: "cust-oak", serviceType: "landscaping", price: 400, days: 45, uid: dana, name: "Dana" },
    { id: "job-3", customerId: "cust-elm", serviceType: "snow_removal", price: 220, days: 70, uid: nick, name: "Nick" },
    { id: "job-4", customerId: "cust-elm", serviceType: "pressure_washing", price: 610, days: 100, uid: dana, name: "Dana" },
  ];
  for (const job of jobs) {
    const start = ago(job.days);
    await setDoc(doc(db, "jobs", job.id), {
      customerId: job.customerId,
      serviceType: job.serviceType,
      scheduledStart: start,
      scheduledEnd: Timestamp.fromMillis(start.toMillis() + 5_400_000),
      status: "complete",
      price: job.price,
      assignedTo: [job.uid],
      beforePhotos: [],
      afterPhotos: [],
      jobNotes: "",
      completedAt: start,
      completedBy: job.uid,
      createdAt: start,
      createdBy: job.uid,
      createdByName: job.name,
      updatedAt: start,
      updatedBy: job.uid,
      updatedByName: job.name,
    });
  }

  const quotes = [
    { id: "q-1", customerId: "cust-oak", amount: 450, status: "accepted", uid: nick, name: "Nick" },
    { id: "q-2", customerId: "cust-elm", amount: 300, status: "declined", uid: dana, name: "Dana" },
    { id: "q-3", customerId: "cust-elm", amount: 500, status: "no_response", uid: nick, name: "Nick" },
  ];
  for (const quote of quotes) {
    await setDoc(doc(db, "quotes", quote.id), {
      customerId: quote.customerId,
      serviceType: "pressure_washing",
      amount: quote.amount,
      sentAt: ago(20),
      sentBy: quote.uid,
      sentByName: quote.name,
      status: quote.status,
      followUpCount: 0,
      lastFollowUpAt: null,
    });
  }
});

await env.cleanup();
console.log(JSON.stringify({ nick, dana }));
