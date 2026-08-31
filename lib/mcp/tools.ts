/**
 * What the Ops Agent can do, in one table.
 *
 * Names, descriptions, input schemas, the scope each one needs and the MCP
 * annotations, all in a single place so the whole set can be checked at once:
 * every tool has a scope, no two share a name, and anything that reaches a
 * customer is marked as such. A tool added later without a scope fails a test
 * rather than quietly defaulting to permitted.
 *
 * Descriptions are written for the agent, not for us. It decides which tool to
 * reach for from these sentences alone, so each says what the tool is *for* and
 * what it will not do — "does not send it" on `draft_estimate` is doing real
 * work there.
 *
 * Free of imports: the catalogue is data, and the tests run it directly.
 */

import type { Scope } from "@/lib/apiKeys";

/** MCP's hints to the client about what a tool does. Hints, not enforcement. */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
}

const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const ADDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** Reaches a real person and cannot be undone. */
const IRREVERSIBLE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

export const TOOLS: readonly ToolSpec[] = [
  /* ------------------------------------------------------------------ read */
  {
    name: "find_customer",
    title: "Find a customer",
    description:
      "Search the customer book by name, phone number or address. Returns matching customers with their status, contact details and pipeline stage. Use this first whenever a request names a person — every other tool takes a customer id.",
    scope: "read",
    inputSchema: object(
      { query: str("A name, phone number, or part of an address."), limit: num("Maximum results. Defaults to 10.") },
      ["query"],
    ),
    annotations: READ,
  },
  {
    name: "list_jobs",
    title: "List jobs",
    description:
      "Jobs in a date range, with the customer, who it is assigned to, the price and whether it is done and paid. Use for scheduling questions — what is on today, what is unassigned, what is still outstanding.",
    scope: "read",
    inputSchema: object({
      from: str("Start date, YYYY-MM-DD. Defaults to today."),
      to: str("End date, YYYY-MM-DD. Defaults to seven days after `from`."),
      status: str("Optional filter: scheduled, in_progress, complete or cancelled."),
    }),
    annotations: READ,
  },
  {
    name: "money_summary",
    title: "Money in and money owed",
    description:
      "What was actually received in a calendar year, split between payments taken against jobs and payments against invoices, plus what is still outstanding. Counts money when it arrived, not when the work was done, and never counts a job twice when it was also invoiced. This is the number for 'what did we gross' — it is not the same as the Reports screen, which totals completed work whether or not it was paid for.",
    scope: "read",
    inputSchema: object({ year: num("Calendar year. Defaults to the current one.") }),
    annotations: READ,
  },
  {
    name: "list_leads",
    title: "List leads",
    description:
      "Open leads by pipeline stage, newest first, with how long each has been sitting. Use to find what has gone cold or what needs chasing.",
    scope: "read",
    inputSchema: object({
      stage: str("Optional pipeline stage to filter by."),
      limit: num("Maximum results. Defaults to 25."),
    }),
    annotations: READ,
  },

  /* ----------------------------------------------------------------- write */
  {
    name: "create_lead",
    title: "Log a new lead",
    description:
      "Add somebody to the book — a phone enquiry, a referral, a name off a note. Only ever adds; it cannot change an existing customer. No map pin is needed: give an address and the map places them automatically.",
    scope: "write",
    inputSchema: object(
      {
        firstName: str("First name, if known."),
        lastName: str("Last name, if known."),
        phone: str("Phone number. Ten digits."),
        email: str("Email address, if known."),
        address: str("Street address, if known."),
        note: str("What they asked for, in their own words where possible."),
      },
      [],
    ),
    annotations: ADDS,
  },
  {
    name: "add_note",
    title: "Write on a customer's timeline",
    description:
      "Append a note to a customer's history. Use to record what was said on a call. Notes are permanent and are marked as written by the agent.",
    scope: "write",
    inputSchema: object(
      { customerId: str("From find_customer."), text: str("The note.") },
      ["customerId", "text"],
    ),
    annotations: ADDS,
  },
  {
    name: "draft_estimate",
    title: "Draft an estimate",
    description:
      "Create a draft estimate for a customer from a list of line items. It is saved as a draft and NOT sent — a person reviews and sends it. Prices are taken exactly as given; nothing here decides what to charge.",
    scope: "write",
    inputSchema: object(
      {
        customerId: str("From find_customer."),
        serviceType: str("pressure_washing, landscaping or snow_removal."),
        lines: {
          type: "array",
          description: "The work, one entry per line.",
          items: object(
            {
              name: str("Short name, e.g. 'Driveway pressure wash'."),
              description: str("What it covers, specifically."),
              unitPrice: num("Price for this line, before tax."),
              discountPct: num("Optional discount on this line alone, 0-100."),
            },
            ["name", "unitPrice"],
          ),
        },
      },
      ["customerId", "lines"],
    ),
    annotations: ADDS,
  },

  /* ------------------------------------------------------------------ send */
  {
    name: "schedule_job",
    title: "Book a job",
    description:
      "Put a job on the calendar and text the customer a confirmation. The text goes out immediately and cannot be recalled, which is why this needs the send scope rather than write. Check list_jobs for a clash first.",
    scope: "send",
    inputSchema: object(
      {
        customerId: str("From find_customer."),
        serviceType: str("pressure_washing, landscaping or snow_removal."),
        start: str("Start time, ISO 8601, e.g. 2026-08-24T09:00:00-04:00."),
        end: str("End time, ISO 8601."),
        price: num("Agreed price."),
        assignedTo: { type: "array", items: { type: "string" }, description: "Crew uids." },
      },
      ["customerId", "start", "end", "price"],
    ),
    annotations: IRREVERSIBLE,
  },
  {
    name: "send_sms",
    title: "Text a customer",
    description:
      "Send a text message to a customer from the business number. It arrives on a real person's phone immediately and cannot be unsent. It is logged on their timeline and marked as sent by the agent. Do not use for anything a person should say themselves.",
    scope: "send",
    inputSchema: object(
      { customerId: str("From find_customer."), body: str("The message. Keep it under 300 characters.") },
      ["customerId", "body"],
    ),
    annotations: IRREVERSIBLE,
  },
] as const;

export const TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name);

export function findTool(name: string): ToolSpec | null {
  return TOOLS.find((tool) => tool.name === name) ?? null;
}

/** The tools a key with these scopes may see and call. */
export function toolsFor(scopes: readonly string[]): ToolSpec[] {
  return TOOLS.filter((tool) => scopes.includes(tool.scope));
}

/**
 * The catalogue in MCP's `tools/list` shape.
 *
 * Only the tools the caller's key can actually run: showing an agent a tool it
 * will be refused for teaches it to keep trying, and the refusal costs a round
 * trip every time.
 */
export function listToolsPayload(scopes: readonly string[]): Record<string, unknown>[] {
  return toolsFor(scopes).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: tool.annotations.readOnlyHint,
      destructiveHint: tool.annotations.destructiveHint,
      idempotentHint: tool.annotations.idempotentHint,
      openWorldHint: tool.annotations.openWorldHint,
    },
  }));
}
