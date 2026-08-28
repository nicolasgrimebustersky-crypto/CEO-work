/**
 * The Marcus command centre — shared shapes for the agent system's own data.
 *
 * These three collections are what `grimebusters-ops` publishes about itself:
 * who is working (`opsAgents`), what they have done (`opsFeed`), and what is
 * waiting on Nicolas (`opsApprovals`). The CRM app reads them; the agents
 * write them through `scripts/ops-publish.ts`, signed in as a crew account so
 * `firestore.rules` applies to every write exactly as it does to the app.
 *
 * The one rule that shapes everything here: **a row in these collections is a
 * record of something that actually happened.** Nothing in the dashboard is
 * allowed to imply activity that no agent reported — see `isStale()` below,
 * which is why a status carries a heartbeat rather than a bare string.
 */

import type { Timestamp } from "firebase/firestore";

/** The five specialists and the one who routes for them. Ids are document ids. */
export const AGENT_IDS = [
  "marcus",
  "grant",
  "cole",
  "reese",
  "avery",
  "tyler",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export function isAgentId(value: unknown): value is AgentId {
  return (
    typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value)
  );
}

/**
 * Who each agent is, from grimebusters-ops/CLAUDE.md. Held here rather than in
 * the database because it is the system's design, not its state: an agent that
 * has never once checked in should still appear on the roster, greyed out.
 */
export const AGENT_PROFILE: Record<
  AgentId,
  { name: string; role: string; short: string }
> = {
  marcus: { name: "Marcus", role: "CEO — routes everything", short: "CEO" },
  grant: { name: "Grant", role: "Website · SEO · GBP · forms", short: "WEB" },
  cole: { name: "Cole", role: "Lead triage · outreach · follow-up", short: "LEADS" },
  reese: { name: "Reese", role: "Offers · campaigns · retention", short: "OFFERS" },
  avery: { name: "Avery", role: "Research · trends · performance", short: "INTEL" },
  tyler: { name: "Tyler", role: "Reels · captions · shot lists", short: "MEDIA" },
};

/**
 * `working` is doing something now, `waiting` is blocked on Nicolas, `idle`
 * finished and has nothing queued. There is deliberately no "online" — see
 * `isStale`, which decides that from the heartbeat instead of taking a
 * process's word for it.
 */
export const AGENT_STATUSES = ["working", "waiting", "idle"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export function isAgentStatus(value: unknown): value is AgentStatus {
  return (
    typeof value === "string" &&
    (AGENT_STATUSES as readonly string[]).includes(value)
  );
}

export interface OpsAgent {
  id: AgentId;
  status: AgentStatus;
  /** One line: what this agent is on right now. */
  task: string;
  /** Refreshed by every publish. The dashboard trusts this, not `status`. */
  heartbeatAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy: string;
  updatedByName: string;
}

/**
 * How long an agent's last heartbeat stays believable.
 *
 * The ops box is a laptop that gets shut. Past this, the dashboard says STALE
 * rather than "working" — a screen claiming six agents are working while the
 * machine is off is exactly the lie this system must never tell.
 */
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000;

export function isStale(agent: OpsAgent, now: number = Date.now()): boolean {
  return now - agent.heartbeatAt.toMillis() > HEARTBEAT_STALE_MS;
}

/** An entry in the comm log. Append-only: these are immutable in the rules. */
export interface OpsFeedEntry {
  id: string;
  who: AgentId;
  text: string;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
}

/**
 * What a decision is for. `money` and `legal` are the two that hard rule 1
 * says can never be settled by an agent; `escalation` is two specialists
 * disagreeing, which Marcus is required to bring here rather than average.
 */
export const APPROVAL_KINDS = ["money", "content", "escalation", "legal"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export function isApprovalKind(value: unknown): value is ApprovalKind {
  return (
    typeof value === "string" &&
    (APPROVAL_KINDS as readonly string[]).includes(value)
  );
}

/**
 * `alternate` is the second side of an escalation ("go with Avery"). It is a
 * distinct outcome from `approved` because an escalation has no default side —
 * recording both as "approved" would lose which position actually won.
 */
export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "alternate",
  "rejected",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return (
    typeof value === "string" &&
    (APPROVAL_STATUSES as readonly string[]).includes(value)
  );
}

/** The two sides of an escalation, as argued. Never merged, never averaged. */
export interface ApprovalPosition {
  who: string;
  position: string;
}

export interface OpsApproval {
  id: string;
  kind: ApprovalKind;
  /** The agent asking. */
  who: AgentId;
  title: string;
  detail: string;
  /** Free text, as the agent stated it: "$150 / week", "~$3.40 SMS". */
  cost: string | null;
  /** Present only on an escalation. */
  positionA: ApprovalPosition | null;
  positionB: ApprovalPosition | null;
  /** Marcus's own read. He may lean; he does not decide. */
  marcusRead: string | null;
  /** Button wording the agent asked for, e.g. "Approve & send". */
  approveLabel: string;
  altLabel: string | null;
  status: ApprovalStatus;
  decidedAt: Timestamp | null;
  decidedBy: string | null;
  decidedByName: string | null;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
}

/**
 * Deciding here records the decision. It does not send, spend or post.
 *
 * The ops scripts poll for decided rows and carry them out; the dashboard has
 * no send path of its own, which keeps hard rules 3 and 4 ("you draft, he
 * sends") true of this screen as well as of Telegram.
 */
export const DECISION_IS_NOT_AN_ACTION =
  "Recording a decision here does not send, spend or post anything. " +
  "The agent carries it out and reports back.";
