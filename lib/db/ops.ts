/**
 * Reading the agent system's own state, and recording decisions about it.
 *
 * Every read here is a live subscription, because the point of the command
 * centre is watching work land as it happens. Every field is coerced on the
 * way out — these documents are written by `grimebusters-ops`, a separate
 * codebase on a different machine, so a shape it gets wrong must degrade to a
 * readable row rather than throw inside a screen.
 *
 * There is exactly one write in this file, `decideApproval`, and it records a
 * decision. Nothing here sends, spends or posts — see DECISION_IS_NOT_AN_ACTION.
 */

import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { getDb } from "@/lib/firebase";
import {
  isAgentId,
  isAgentStatus,
  isApprovalKind,
  isApprovalStatus,
  type AgentId,
  type ApprovalPosition,
  type ApprovalStatus,
  type OpsAgent,
  type OpsApproval,
  type OpsFeedEntry,
} from "@/lib/ops/types";
import type { Author } from "@/lib/types";

export const OPS_COLLECTIONS = {
  agents: "opsAgents",
  feed: "opsFeed",
  approvals: "opsApprovals",
} as const;

/** How much comm log to hold on screen. Older entries stay in Firestore. */
const FEED_LIMIT = 60;

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stamp(value: unknown): Timestamp {
  return value instanceof Timestamp ? value : Timestamp.now();
}

function position(value: unknown): ApprovalPosition | null {
  if (value === null || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const who = strOrNull(data.who);
  const pos = strOrNull(data.position);
  return who && pos ? { who, position: pos } : null;
}

function toAgent(snap: QueryDocumentSnapshot<DocumentData>): OpsAgent | null {
  // The document id *is* the agent id. One the app has never heard of is
  // dropped rather than rendered: a roster tile with no profile behind it
  // would be a nameless box on the screen.
  if (!isAgentId(snap.id)) return null;
  const data = snap.data();
  return {
    id: snap.id,
    status: isAgentStatus(data.status) ? data.status : "idle",
    task: str(data.task),
    // A missing heartbeat reads as the epoch, so it lands as stale rather than
    // as "just checked in" — the failure has to fall that way round.
    heartbeatAt:
      data.heartbeatAt instanceof Timestamp
        ? data.heartbeatAt
        : Timestamp.fromMillis(0),
    updatedAt: stamp(data.updatedAt),
    updatedBy: str(data.updatedBy),
    updatedByName: str(data.updatedByName, "Unknown"),
  };
}

function toFeedEntry(
  snap: QueryDocumentSnapshot<DocumentData>,
): OpsFeedEntry | null {
  const data = snap.data();
  if (!isAgentId(data.who)) return null;
  return {
    id: snap.id,
    who: data.who,
    text: str(data.text),
    createdAt: stamp(data.createdAt),
    createdBy: str(data.createdBy),
    createdByName: str(data.createdByName, "Unknown"),
  };
}

function toApproval(snap: QueryDocumentSnapshot<DocumentData>): OpsApproval {
  const data = snap.data();
  return {
    id: snap.id,
    kind: isApprovalKind(data.kind) ? data.kind : "content",
    who: isAgentId(data.who) ? data.who : "marcus",
    title: str(data.title, "(untitled)"),
    detail: str(data.detail),
    cost: strOrNull(data.cost),
    positionA: position(data.positionA),
    positionB: position(data.positionB),
    marcusRead: strOrNull(data.marcusRead),
    approveLabel: str(data.approveLabel, "Approve"),
    altLabel: strOrNull(data.altLabel),
    // An unrecognised status is treated as still pending. The safe direction:
    // an item stays in front of Nicolas rather than silently counting as done.
    status: isApprovalStatus(data.status) ? data.status : "pending",
    decidedAt: data.decidedAt instanceof Timestamp ? data.decidedAt : null,
    decidedBy: strOrNull(data.decidedBy),
    decidedByName: strOrNull(data.decidedByName),
    createdAt: stamp(data.createdAt),
    createdBy: str(data.createdBy),
    createdByName: str(data.createdByName, "Unknown"),
  };
}

export function subscribeAgents(
  onChange: (agents: OpsAgent[]) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    collection(getDb(), OPS_COLLECTIONS.agents),
    (snap) => {
      const agents = snap.docs
        .map(toAgent)
        .filter((agent): agent is OpsAgent => agent !== null);
      onChange(agents);
    },
    onError,
  );
}

export function subscribeFeed(
  onChange: (entries: OpsFeedEntry[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const q = query(
    collection(getDb(), OPS_COLLECTIONS.feed),
    orderBy("createdAt", "desc"),
    limit(FEED_LIMIT),
  );
  return onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs
        .map(toFeedEntry)
        .filter((entry): entry is OpsFeedEntry => entry !== null);
      onChange(entries);
    },
    onError,
  );
}

/** One agent's own log, for the roster's detail pane. */
export function subscribeAgentLog(
  agentId: AgentId,
  onChange: (entries: OpsFeedEntry[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const q = query(
    collection(getDb(), OPS_COLLECTIONS.feed),
    where("who", "==", agentId),
    orderBy("createdAt", "desc"),
    limit(20),
  );
  return onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs
        .map(toFeedEntry)
        .filter((entry): entry is OpsFeedEntry => entry !== null);
      onChange(entries);
    },
    onError,
  );
}

export function subscribeApprovals(
  onChange: (approvals: OpsApproval[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const q = query(
    collection(getDb(), OPS_COLLECTIONS.approvals),
    orderBy("createdAt", "desc"),
    limit(50),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map(toApproval)),
    onError,
  );
}

/**
 * Record what Nicolas decided.
 *
 * This writes four fields and nothing else — the rules pin the rest, so an
 * approval cannot have its price or its wording edited after the fact by the
 * agent that raised it. A decision is also final: the rules only accept this
 * write while the row is still `pending`, so nobody can quietly flip an
 * approval that has already been carried out. Changing course means the agent
 * raising a fresh item, which leaves both in the record.
 *
 * It does not send, spend or post. The agent polls for decided rows and acts.
 */
export async function decideApproval(
  approvalId: string,
  status: Exclude<ApprovalStatus, "pending">,
  author: Author,
): Promise<void> {
  await updateDoc(doc(getDb(), OPS_COLLECTIONS.approvals, approvalId), {
    status,
    decidedAt: serverTimestamp(),
    decidedBy: author.uid,
    decidedByName: author.displayName,
  });
}
