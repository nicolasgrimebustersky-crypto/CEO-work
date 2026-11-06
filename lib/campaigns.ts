/**
 * Seasonal upsell campaigns: the right extra service, to customers who
 * already buy from you, at the time of year it's done.
 *
 *   Who        existing customers: at least one finished job in one of the
 *              campaign's "from" services, and nothing of the offered
 *              service done, booked or quoted recently.
 *   Consent    a marketing text goes only to someone with a recorded
 *              consent to be texted, not merely to someone who hasn't said
 *              STOP. That is stricter than the job texts (a reminder about
 *              a booked visit is not marketing), on purpose: unsolicited
 *              marketing texts are what the TCPA's statutory damages are
 *              for. /api/sms/blast enforces the same rule on the server.
 *   Results    nobody has to tick anything. A recipient who then gets an
 *              estimate, accepts one, or has a job booked for the offered
 *              service within RESULT_WINDOW_DAYS of the send counts, worked
 *              out from the documents and jobs the app already has.
 *
 * Free of imports, so who gets a marketing text is a tested rule.
 */

export interface CampaignTemplate {
  id: string;
  name: string;
  /** Months it makes sense to send, 1–12. */
  months: number[];
  /** The service being offered. */
  service: string;
  /** Customers who've had any of these finished are the audience. */
  from: string[];
  /** The message. {business} is filled in; the opt-out line is added. */
  message: string;
}

/**
 * Starting points; the owner edits the wording before sending. Lawn care
 * first (Kentucky cool-season grass: aerate and overseed in fall), then
 * exterior cleaning.
 */
export const CAMPAIGN_TEMPLATES: readonly CampaignTemplate[] = [
  {
    id: "fall_aeration",
    name: "Fall aeration & overseeding",
    months: [8, 9, 10],
    service: "aeration",
    from: ["mowing", "landscaping"],
    message:
      "{business}: fall is the best time to aerate and overseed for a thicker lawn next spring. Want us to add it to your next visit? Reply YES for a price.",
  },
  {
    id: "fall_cleanup",
    name: "Fall leaf cleanup",
    months: [10, 11],
    service: "landscaping",
    from: ["mowing"],
    message:
      "{business}: leaves are coming down. We're booking fall cleanups now — beds cleared and leaves hauled off. Reply YES and we'll send a price.",
  },
  {
    id: "snow_contract",
    name: "Snow removal for the winter",
    months: [10, 11, 12],
    service: "snow_removal",
    from: ["mowing", "landscaping", "pressure_washing"],
    message:
      "{business}: we're lining up our snow removal list for the winter so your drive and walks are clear before you leave. Reply YES to get on it.",
  },
  {
    id: "spring_cleanup",
    name: "Spring cleanup & mulch",
    months: [2, 3, 4],
    service: "landscaping",
    from: ["mowing", "aeration"],
    message:
      "{business}: spring cleanup season — beds edged, fresh mulch, debris hauled off before mowing starts. Reply YES and we'll send a price.",
  },
  {
    id: "spring_mowing",
    name: "Sign up for the mowing season",
    months: [2, 3, 4],
    service: "mowing",
    from: ["landscaping", "aeration", "snow_removal"],
    message:
      "{business}: mowing season is around the corner. Want a spot on our weekly route this year? Reply YES and we'll send a price.",
  },
  {
    id: "spring_wash",
    name: "Spring house & driveway wash",
    months: [3, 4, 5],
    service: "pressure_washing",
    from: ["window_cleaning", "landscaping", "mowing"],
    message:
      "{business}: get the winter grime off the house, driveway and walks before summer. Reply YES for a price.",
  },
  {
    id: "window_cleaning",
    name: "Window cleaning",
    months: [4, 5, 9, 10],
    service: "window_cleaning",
    from: ["pressure_washing"],
    message:
      "{business}: clear windows before the season changes — inside and out. Reply YES and we'll send a price.",
  },
];

/** How long after a send an estimate or booking counts as the campaign's. */
export const RESULT_WINDOW_DAYS = 60;
/** Someone who had the offered service this recently isn't offered it again. */
export const RECENT_DAYS = 300;

const DAY_MS = 86_400_000;

export interface CampaignCustomer {
  id: string;
  phone?: string | null;
  status?: string | null;
  smsConsent?: { granted?: boolean | null } | null;
  smsOptOut?: unknown;
}

export interface CampaignJob {
  customerId: string;
  /** Every service on the job. */
  services: readonly string[];
  status: string;
  /** Milliseconds: when it is (or was) scheduled. */
  at: number;
  /** Milliseconds: when it was created. */
  createdAt: number;
}

export interface CampaignDocument {
  customerId: string;
  kind: string;
  status: string;
  services: readonly string[];
  /** Milliseconds. */
  createdAt: number;
}

export type Exclusion = "no_consent" | "cannot_text" | "has_it" | "do_not_knock";

export interface Audience<T> {
  eligible: T[];
  excluded: { customer: T; why: Exclusion; detail: string }[];
}

export function inSeason(template: CampaignTemplate, month: number): boolean {
  return template.months.includes(month);
}

/**
 * Who a campaign goes to. `canSend` is lib/smsConsent.ts canSendTo, passed
 * in so there is one answer to "may we text them at all"; on top of it a
 * marketing text needs a consent actually recorded.
 */
export function campaignAudience<T extends CampaignCustomer>(
  template: CampaignTemplate,
  customers: readonly T[],
  jobs: readonly CampaignJob[],
  documents: readonly CampaignDocument[],
  now: number,
  canSend: (c: T) => { allowed: boolean; reason: string },
): Audience<T> {
  const out: Audience<T> = { eligible: [], excluded: [] };
  const recent = now - RECENT_DAYS * DAY_MS;

  const byCustomer = new Map<string, CampaignJob[]>();
  for (const j of jobs) {
    const list = byCustomer.get(j.customerId) ?? [];
    list.push(j);
    byCustomer.set(j.customerId, list);
  }
  const quoted = new Set(
    documents
      .filter(
        (d) =>
          d.kind === "estimate" &&
          d.services.includes(template.service) &&
          d.createdAt >= recent &&
          d.status !== "declined" &&
          d.status !== "void",
      )
      .map((d) => d.customerId),
  );

  for (const c of customers) {
    const theirs = byCustomer.get(c.id) ?? [];
    const isCustomer = theirs.some((j) => j.status === "complete" && j.services.some((s) => template.from.includes(s)));
    if (!isCustomer) continue; // not the audience at all; not worth listing

    const hasIt =
      quoted.has(c.id) ||
      theirs.some(
        (j) => j.status !== "cancelled" && j.services.includes(template.service) && j.at >= recent,
      );
    if (hasIt) {
      out.excluded.push({ customer: c, why: "has_it", detail: "Already had, booked or was quoted for this recently." });
      continue;
    }
    if (c.status === "do_not_knock") {
      out.excluded.push({ customer: c, why: "do_not_knock", detail: "Marked do not contact." });
      continue;
    }
    const verdict = canSend(c);
    if (!verdict.allowed) {
      out.excluded.push({ customer: c, why: "cannot_text", detail: verdict.reason });
      continue;
    }
    if (c.smsConsent?.granted !== true) {
      out.excluded.push({
        customer: c,
        why: "no_consent",
        detail: "No consent to texts on file. Ask them (and record it) before sending marketing.",
      });
      continue;
    }
    out.eligible.push(c);
  }
  return out;
}

export type Outcome = "booked" | "accepted" | "quoted" | "none";

/** What came of the campaign for one recipient. */
export function outcomeFor(
  customerId: string,
  service: string,
  sentAt: number,
  jobs: readonly CampaignJob[],
  documents: readonly CampaignDocument[],
): Outcome {
  const until = sentAt + RESULT_WINDOW_DAYS * DAY_MS;
  const within = (t: number) => t >= sentAt && t <= until;
  if (
    jobs.some(
      (j) => j.customerId === customerId && j.status !== "cancelled" && j.services.includes(service) && within(j.createdAt),
    )
  ) {
    return "booked";
  }
  const quotes = documents.filter(
    (d) => d.customerId === customerId && d.kind === "estimate" && d.services.includes(service) && within(d.createdAt),
  );
  if (quotes.some((d) => d.status === "accepted")) return "accepted";
  if (quotes.some((d) => d.status !== "void" && d.status !== "draft")) return "quoted";
  return "none";
}

export interface CampaignResults {
  sent: number;
  quoted: number;
  accepted: number;
  booked: number;
  /** Accepted or booked, as a share of those sent. */
  rate: number;
}

export function campaignResults(
  recipients: readonly string[],
  service: string,
  sentAt: number,
  jobs: readonly CampaignJob[],
  documents: readonly CampaignDocument[],
): CampaignResults {
  const r = { sent: recipients.length, quoted: 0, accepted: 0, booked: 0, rate: 0 };
  for (const id of recipients) {
    const o = outcomeFor(id, service, sentAt, jobs, documents);
    if (o === "booked") r.booked += 1;
    else if (o === "accepted") r.accepted += 1;
    else if (o === "quoted") r.quoted += 1;
  }
  r.rate = r.sent ? (r.accepted + r.booked) / r.sent : 0;
  return r;
}
