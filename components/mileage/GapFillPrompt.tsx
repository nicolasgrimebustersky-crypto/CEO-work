"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { useEffect, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useJobs } from "@/components/providers/JobsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { isDemoMode } from "@/lib/demo/enabled";
import { getMileageHome, logTrip } from "@/lib/db/mileage";
import { useRoadMiles } from "@/lib/driveTime";
import { localDate } from "@/lib/expenses";
import { COLLECTIONS, getDb } from "@/lib/firebase";
import { customerName } from "@/lib/format";
import { gapDecision, type Place, type WorkedJob } from "@/lib/mileage";

const ASKED_KEY = "mileage.gapAsked";

/**
 * "X mi since your last job — business?" on opening the app.
 *
 * Reads this person's last saved position (users/{uid}, written while
 * location sharing is on) before this session's GPS overwrites it, gets
 * where the phone is now, and asks only when lib/mileage.ts gapDecision says
 * the last position was at one of their jobs within four hours and the
 * drive did not end at home. Nothing is logged without a Yes. Asked at most
 * once per app open.
 */
export function GapFillPrompt() {
  const { author } = useTeam();
  const { jobs } = useJobs();
  const { byId: customersById } = useCustomers();
  const uid = author?.uid ?? "";
  const [ask, setAsk] = useState<{ from: WorkedJob; last: Place; now: Place } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!uid || checked || isDemoMode || jobs.length === 0) return;
    setChecked(true);
    try {
      if (sessionStorage.getItem(ASKED_KEY)) return;
      sessionStorage.setItem(ASKED_KEY, "1");
    } catch {
      // No session storage: asking once per page load is still fine.
    }
    let cancelled = false;
    void (async () => {
      const snap = await getDoc(doc(getDb(), COLLECTIONS.users, uid)).catch(() => null);
      const data = snap?.data();
      const lastAt = data?.lastLocationUpdate instanceof Timestamp ? data.lastLocationUpdate.toMillis() : null;
      if (typeof data?.currentLat !== "number" || typeof data?.currentLng !== "number" || lastAt === null) return;
      const last = { lat: data.currentLat as number, lng: data.currentLng as number, at: lastAt };
      const now = await new Promise<(Place & { at: number }) | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
        );
      });
      if (!now || cancelled) return;
      const mine: WorkedJob[] = jobs
        .filter((job) => job.assignedTo.includes(uid) && Math.abs(job.scheduledStart.toMillis() - last.at) < 24 * 3600_000)
        .map((job) => {
          const c = customersById.get(job.customerId);
          return {
            id: job.id,
            label: c ? customerName(c) : "a job",
            lat: c?.lat ?? 0,
            lng: c?.lng ?? 0,
            startedAt: job.startedAt?.toMillis() ?? job.scheduledStart.toMillis(),
          };
        });
      const home = await getMileageHome(uid);
      const decision = gapDecision({ last, now, jobs: mine, home });
      if (!cancelled && decision.kind === "ask") setAsk({ from: decision.fromJob, last, now });
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, checked, jobs, customersById]);

  if (!ask) return null;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const sheet = <GapSheet ask={ask} onDone={() => setAsk(null)} />;
  return apiKey ? (
    <APIProvider apiKey={apiKey} libraries={["routes"]}>
      {sheet}
    </APIProvider>
  ) : (
    sheet
  );
}

function GapSheet({
  ask,
  onDone,
}: {
  ask: { from: WorkedJob; last: Place; now: Place };
  onDone: () => void;
}) {
  const { author } = useTeam();
  const measure = useRoadMiles();
  const [result, setResult] = useState<{ miles: number; estimated: boolean } | null>(null);
  const [reason, setReason] = useState(`From job: ${ask.from.label}`);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void measure(ask.last, ask.now).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function yes() {
    if (!author || !result) return;
    setSaving(true);
    try {
      await logTrip(
        {
          date: localDate(),
          miles: result.miles,
          reason: reason.trim() || `From job: ${ask.from.label}`,
          source: "gps_gap",
          estimated: result.estimated,
          from: { ...ask.last, label: ask.from.label },
          to: { ...ask.now, label: "Where the app was opened" },
          jobIds: [ask.from.id],
        },
        author,
      );
    } finally {
      setSaving(false);
      onDone();
    }
  }

  return (
    <Sheet
      open
      title="Business drive?"
      onClose={onDone}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onDone} disabled={saving}>
            No
          </Button>
          <Button full onClick={() => void yes()} disabled={saving || !result}>
            {saving ? "Logging…" : "Yes, log it"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-lg font-bold text-ink">
          {result ? `${result.miles} mi` : "Measuring…"} since your last job ({ask.from.label}).
        </p>
        <p className="text-sm font-semibold text-muted">
          {result?.estimated ? "Estimated from a straight line; Google road distance wasn't available. " : ""}
          Log it only if this drive was for the business. A drive home is commuting and doesn&apos;t count.
        </p>
        <TextField label="Reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Sheet>
  );
}
