"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { apiUrl } from "@/lib/apiBase";
import { getFirebaseAuth } from "@/lib/firebase";
import { TRUST_DAYS } from "@/lib/trustedDevice";
import { clearDeviceToken } from "@/lib/trustedDeviceClient";

/**
 * Which phones can skip the sign-in code, and the button that stops them.
 *
 * This screen is the other half of the trade the feature makes. Trusting a
 * device means the password alone opens the app on it for thirty days, and
 * that is only a reasonable thing to agree to if undoing it is one tap and
 * does not involve changing the password. So the list is here, it says how
 * long each device has left, and the button kills all of them at once.
 *
 * All at once rather than one at a time on purpose. The moment somebody wants
 * this button, a phone is in the back of a taxi and they do not know which row
 * is which — picking the wrong one is worse than re-entering a code on the
 * handset still in their hand.
 */

interface DeviceRow {
  id: string;
  label: string;
  daysLeft: number;
  lastUsedAtMs: number | null;
}

async function authed(method: "GET" | "DELETE"): Promise<Response> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("You are signed out.");
  return fetch(apiUrl("/api/otp/device"), {
    method,
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
}

export function TrustedDevices() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await authed("GET");
      const data = (await response.json().catch(() => ({}))) as {
        devices?: DeviceRow[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error ?? "Could not read your devices.");
      setDevices(data.devices ?? []);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Could not read your devices.",
      );
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const forgetAll = async () => {
    if (!window.confirm(`Ask for a code on every device next time?`)) return;
    setWorking(true);
    setError("");
    try {
      const response = await authed("DELETE");
      if (!response.ok) throw new Error("Could not untrust them.");
      // This browser's own copy goes too. Leaving it would mean posting a
      // token on the next sign-in that the server has already revoked —
      // harmless, refused, and pointless.
      clearDeviceToken();
      await load();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not untrust them.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold text-ink">Trusted devices</h2>
      <p className="mt-0.5 text-sm font-semibold text-muted">
        A trusted device skips the emailed code for {TRUST_DAYS} days. It still
        asks for your password.
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-base font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {devices === null ? (
        <p className="mt-2 text-base font-semibold text-muted">Checking…</p>
      ) : devices.length === 0 ? (
        <p className="mt-2 text-base font-semibold text-muted">
          None. Every sign-in asks for a code.
        </p>
      ) : (
        <>
          <ul className="mt-2 space-y-2">
            {devices.map((device) => (
              <li
                key={device.id}
                className="rounded-2xl border border-line bg-surface-2 px-3.5 py-3"
              >
                <p className="text-base font-bold text-ink">{device.label}</p>
                <p className="mt-0.5 text-sm font-semibold text-muted">
                  {device.daysLeft === 0
                    ? "Expires today"
                    : `${device.daysLeft} ${device.daysLeft === 1 ? "day" : "days"} left`}
                  {device.lastUsedAtMs
                    ? ` · last used ${new Date(device.lastUsedAtMs).toLocaleDateString()}`
                    : " · not used yet"}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button
              variant="secondary"
              onClick={() => void forgetAll()}
              disabled={working}
            >
              {working ? "Untrusting…" : "Untrust all devices"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
