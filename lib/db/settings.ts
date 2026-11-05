"use client";

import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";

import { isDemoMode } from "@/lib/demo/enabled";
import * as demo from "@/lib/demo/store";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { DEFAULT_ORG_ID } from "@/lib/org";
import { asSalesTaxSettings, type SalesTaxSettings } from "@/lib/salesTax";
import { SALES_TAX_DEFAULTS } from "@/lib/salesTaxDefaults";
import type { Author } from "@/lib/types";

/**
 * The one business-settings document, `settings/business`.
 *
 * Every crew member reads it (a new invoice needs the tax rate and permit
 * number whoever writes it); only the owner writes it — firestore.rules.
 * Nothing secret goes here: pay rates and the like belong elsewhere.
 */
const DOC_ID = "business";

export function subscribeSalesTaxSettings(
  onChange: (settings: SalesTaxSettings) => void,
): () => void {
  if (isDemoMode) {
    return demo.subscribe<Record<string, unknown>>(COLLECTIONS.settings, (rows) => {
      const row = rows.find((r) => r.id === DOC_ID);
      onChange(asSalesTaxSettings(row?.salesTax, SALES_TAX_DEFAULTS));
    });
  }
  return onSnapshot(
    doc(getDb(), COLLECTIONS.settings, DOC_ID),
    (snap) => onChange(asSalesTaxSettings(snap.data()?.salesTax, SALES_TAX_DEFAULTS)),
    // Not readable (signed out, rules not yet published): the defaults stand.
    () => onChange(SALES_TAX_DEFAULTS),
  );
}

export function useSalesTaxSettings(): SalesTaxSettings {
  const [settings, setSettings] = useState<SalesTaxSettings>(SALES_TAX_DEFAULTS);
  useEffect(() => subscribeSalesTaxSettings(setSettings), []);
  return settings;
}

/** Owner only — the rules refuse anyone else. */
export async function saveSalesTaxSettings(settings: SalesTaxSettings, author: Author): Promise<void> {
  const payload = {
    orgId: DEFAULT_ORG_ID,
    salesTax: {
      enabled: settings.enabled,
      permitNumber: settings.permitNumber.trim().slice(0, 40),
      filingFrequency: settings.filingFrequency,
      defaultRatePct: settings.defaultRatePct,
    },
    updatedAt: serverTimestamp(),
    updatedBy: author.uid,
    updatedByName: author.displayName,
  };
  if (isDemoMode) {
    demo.put(COLLECTIONS.settings, DOC_ID, payload);
    return;
  }
  await setDoc(doc(getDb(), COLLECTIONS.settings, DOC_ID), payload);
}
