// Two different STATUS_LABELs exist — one for documents, one for customer pin
// colours — and they cover different unions. Aliased rather than imported bare
// so the wrong one cannot be picked up by autocomplete later.
import { STATUS_LABEL as DOCUMENT_STATUS_LABEL, type BusinessDocument } from "@/lib/documents";
import type { SavedService } from "@/lib/db/services";
import { PIPELINE_LABEL } from "@/lib/pipeline";
import { routes } from "@/lib/routes";
import { normalize, WEIGHT, type SearchField, type SearchRecord } from "@/lib/search";
import { SERVICE_LABEL } from "@/lib/status";
import type { Customer, Job, KnockRoute } from "@/lib/types";

/**
 * Turning what the app holds into something one box can search.
 *
 * Separate from `lib/search.ts` so the matcher never learns what a Customer
 * is: the matcher scores text, this decides which text is worth scoring and
 * how much it counts. Adding a searchable field is a change here and nowhere
 * else.
 *
 * Every field is normalised once, when the record is built, rather than on
 * each keystroke. The whole book is rebuilt only when the underlying data
 * changes, and a search then compares against text that is already lowercase,
 * unaccented and unpunctuated — which is what makes typing feel immediate on
 * a phone rather than lagging a character behind.
 *
 * What is deliberately NOT searchable: anything that is not the business's own
 * record of its work. There is no customer password, no token, no API key in
 * here, and none of those collections is read.
 */

function field(text: unknown, weight: number): SearchField {
  return { text: normalize(text), weight };
}

/** Drops fields that normalised to nothing, so empty strings cost no time. */
function used(fields: SearchField[]): SearchField[] {
  return fields.filter((entry) => entry.text !== "");
}

function fullName(customer: Customer): string {
  const name = `${customer.firstName} ${customer.lastName}`.trim();
  return name === "" ? "Unnamed customer" : name;
}

export function customerRecord(customer: Customer): SearchRecord {
  // Note text is joined rather than added one field at a time: a customer with
  // forty notes would otherwise be forty chances to match weakly, and the
  // scoring takes the best field per term, so one long field is both faster
  // and fairer.
  const noteText = customer.notes.map((note) => note.text).join(" ");

  return {
    kind: "customer",
    id: customer.id,
    title: fullName(customer),
    subtitle: [customer.phone, customer.address].filter(Boolean).join(" · "),
    href: routes.customer(customer.id),
    at: customer.lastContactedAt?.toMillis() ?? customer.createdAt?.toMillis() ?? null,
    fields: used([
      field(fullName(customer), WEIGHT.title),
      field(customer.phone, WEIGHT.identifier),
      field(customer.email, WEIGHT.identifier),
      field(customer.address, WEIGHT.address),
      // Every other address this customer has. The apartment company with four
      // properties is the reason this field exists at all.
      field(customer.addresses.map((location) => location.address).join(" "), WEIGHT.address),
      field(customer.tags.join(" "), WEIGHT.label),
      field(PIPELINE_LABEL[customer.pipelineStage] ?? "", WEIGHT.label),
      field(customer.serviceTypes.map((type) => SERVICE_LABEL[type] ?? type).join(" "), WEIGHT.label),
      field(noteText, WEIGHT.note),
    ]),
  };
}

export function documentRecord(document: BusinessDocument): SearchRecord {
  const kindWord = document.kind === "estimate" ? "Estimate" : "Invoice";
  const lineItems = document.lineItems
    .map((item) => `${item.name} ${item.description}`)
    .join(" ");

  return {
    kind: "document",
    id: document.id,
    title: `${kindWord} ${document.number}`.trim(),
    subtitle: [document.customerName, DOCUMENT_STATUS_LABEL[document.status] ?? document.status]
      .filter(Boolean)
      .join(" · "),
    href: routes.document(document.id),
    at: document.issuedAt?.toMillis() ?? document.createdAt?.toMillis() ?? null,
    fields: used([
      field(`${kindWord} ${document.number}`, WEIGHT.title),
      // The customer's name on the paperwork, so searching a person finds
      // their estimates as well as their record.
      field(document.customerName, WEIGHT.title),
      // The total, as digits, so "450" finds the $450 estimate. Rounded
      // because nobody searches for the cents.
      field(String(Math.round(document.total)), WEIGHT.identifier),
      field(lineItems, WEIGHT.detail),
      field(SERVICE_LABEL[document.serviceType] ?? document.serviceType, WEIGHT.label),
      field(DOCUMENT_STATUS_LABEL[document.status] ?? document.status, WEIGHT.label),
      field(document.notes, WEIGHT.note),
    ]),
  };
}

export function jobRecord(job: Job, customerName: string): SearchRecord {
  const service = SERVICE_LABEL[job.serviceType] ?? job.serviceType;

  return {
    kind: "job",
    id: job.id,
    title: `${service} for ${customerName}`,
    subtitle: job.scheduledStart
      ? job.scheduledStart.toDate().toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "",
    href: routes.schedule,
    at: job.scheduledStart?.toMillis() ?? job.createdAt?.toMillis() ?? null,
    fields: used([
      field(customerName, WEIGHT.title),
      field(service, WEIGHT.detail),
      field(job.status, WEIGHT.label),
      field(String(Math.round(job.price)), WEIGHT.identifier),
      field(job.jobNotes, WEIGHT.note),
    ]),
  };
}

export function serviceRecord(service: SavedService): SearchRecord {
  return {
    kind: "service",
    id: service.id,
    title: service.name,
    subtitle: `$${Math.round(service.unitPrice)}`,
    href: routes.services,
    at: service.lastUsedAt?.toMillis() ?? null,
    fields: used([
      field(service.name, WEIGHT.title),
      field(String(Math.round(service.unitPrice)), WEIGHT.identifier),
      field(service.description, WEIGHT.detail),
      field(SERVICE_LABEL[service.serviceType] ?? service.serviceType, WEIGHT.label),
    ]),
  };
}

export function routeRecord(route: KnockRoute): SearchRecord {
  return {
    kind: "route",
    id: route.id,
    title: route.name,
    subtitle: `${route.stopIds.length} ${route.stopIds.length === 1 ? "door" : "doors"}`,
    href: routes.knockRoute(route.id),
    at: route.createdAt?.toMillis() ?? null,
    fields: used([
      field(route.name, WEIGHT.title),
      field(route.status, WEIGHT.label),
    ]),
  };
}

/**
 * Everything, as one searchable book.
 *
 * Jobs are given their customer's name rather than an id, because "the
 * Crestwood job" is how somebody refers to one and an id is how nobody does.
 * A job whose customer has been deleted still appears, under a name that says
 * so, rather than vanishing from search while remaining on the calendar.
 */
export function buildSearchIndex(input: {
  customers: Customer[];
  documents: BusinessDocument[];
  jobs: Job[];
  services: SavedService[];
  knockRoutes: KnockRoute[];
}): SearchRecord[] {
  const nameFor = new Map(input.customers.map((customer) => [customer.id, fullName(customer)]));

  return [
    ...input.customers.map(customerRecord),
    ...input.documents.map(documentRecord),
    ...input.jobs.map((job) => jobRecord(job, nameFor.get(job.customerId) ?? "a former customer")),
    ...input.services.map(serviceRecord),
    ...input.knockRoutes.map(routeRecord),
  ];
}
