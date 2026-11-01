"use client";

import { apiUrl } from "@/lib/apiBase";
import type { AutomationDraft } from "@/lib/automations";
import { isDemoMode } from "@/lib/demo/enabled";
import { getFirebaseAuth } from "@/lib/firebase";

/**
 * Asking the server who an automation would reach.
 *
 * The answer has to come from the server: deciding it needs the customers
 * collection, the documents collection, the per-number send ledger and the
 * opt-out list, and three of those four are things the browser is not allowed
 * to read in bulk. Computing a second, client-side approximation would be
 * worse than not previewing at all — it would eventually disagree with the
 * run, and the disagreement would surface as a text somebody did not expect.
 */

export interface AutomationPreview {
  considered: number;
  wouldSend: number;
  /** What today's run would actually do, after the per-run cap. */
  todayAtMost: number;
  perRunCap: number;
  localHour: number;
  sending: { customerId: string; name: string; phone: string; message: string }[];
  skipped: { customerId: string; name: string; reason: string }[];
  truncated: boolean;
  /** True when this is demo mode's placeholder rather than a real answer. */
  demo?: boolean;
}

export async function previewAutomation(
  draft: AutomationDraft & { id?: string },
): Promise<AutomationPreview> {
  if (isDemoMode) {
    // Demo mode has no server and no real customers. Saying so is better than
    // inventing names: the whole value of this screen is that the list is real.
    return {
      considered: 0,
      wouldSend: 0,
      todayAtMost: 0,
      perRunCap: draft.guards.maxPerRun,
      localHour: new Date().getHours(),
      sending: [],
      skipped: [],
      truncated: false,
      demo: true,
    };
  }

  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Not signed in.");

  const response = await fetch(apiUrl("/api/automations/preview"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ draft }),
  });

  const data = (await response.json().catch(() => ({}))) as Partial<AutomationPreview> & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? "Could not work out who this would reach.");

  return {
    considered: data.considered ?? 0,
    wouldSend: data.wouldSend ?? 0,
    todayAtMost: data.todayAtMost ?? 0,
    perRunCap: data.perRunCap ?? draft.guards.maxPerRun,
    localHour: data.localHour ?? 0,
    sending: data.sending ?? [],
    skipped: data.skipped ?? [],
    truncated: data.truncated ?? false,
  };
}
