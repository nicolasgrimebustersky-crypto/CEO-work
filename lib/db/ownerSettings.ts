"use client";

import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { asProfitSettings, PROFIT_DEFAULTS, type ProfitSettings } from "@/lib/jobProfit";
import { DEFAULT_ORG_ID } from "@/lib/org";
import type { Author } from "@/lib/types";

/**
 * ownerSettings/profit: labour rates and costing for profit per job. Only
 * the owner can read or write it (firestore.rules); mount the hook in owner
 * screens only, or a crew member's phone will just see the defaults.
 */
const PROFIT_DOC = "profit";

export function useProfitSettings(): ProfitSettings {
  const [settings, setSettings] = useState<ProfitSettings>(PROFIT_DEFAULTS);
  useEffect(() => {
    if (isDemoMode) {
      return demo.subscribe<Record<string, unknown>>(COLLECTIONS.ownerSettings, (rows) =>
        setSettings(asProfitSettings(rows.find((r) => r.id === PROFIT_DOC))),
      );
    }
    return onSnapshot(
      doc(getDb(), COLLECTIONS.ownerSettings, PROFIT_DOC),
      (snap) => setSettings(asProfitSettings(snap.data())),
      () => setSettings(PROFIT_DEFAULTS),
    );
  }, []);
  return settings;
}

export async function saveProfitSettings(settings: ProfitSettings, author: Author): Promise<void> {
  const payload = {
    orgId: DEFAULT_ORG_ID,
    laborRatePerHour: settings.laborRatePerHour,
    ratesByUid: settings.ratesByUid,
    costPerMile: settings.costPerMile,
    targetMarginPct: settings.targetMarginPct,
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    demo.put(COLLECTIONS.ownerSettings, PROFIT_DOC, payload);
    return;
  }
  await setDoc(doc(getDb(), COLLECTIONS.ownerSettings, PROFIT_DOC), payload);
}
