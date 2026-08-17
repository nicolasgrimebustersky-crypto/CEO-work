"use client";

import { format } from "date-fns";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useKnockRoutes } from "@/components/providers/KnockRoutesProvider";
import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Chip, UserChip } from "@/components/ui/Chips";
import { TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import {
  createKnockRoute,
  deleteKnockRoute,
  reorderFromHere,
  setKnocked,
  stopsOnOtherRoutes,
  updateKnockRoute,
} from "@/lib/db/knockRoutes";
import { customerName, formatPhone } from "@/lib/format";
import {
  estimateRouteMinutes,
  formatMinutes,
  nextStop,
  routeProgress,
} from "@/lib/knock/plan";
import { routes } from "@/lib/routes";
import { STATUS_LABEL } from "@/lib/status";
import { ROUTE_STATUS_LABEL, type Customer } from "@/lib/types";
import { StopPickerSheet } from "./StopPickerSheet";

/** yyyy-mm-dd for a date input, in local time rather than UTC. */
function isoDay(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function parseDay(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 9, 0, 0, 0);
}

/**
 * One route: what to walk, in what order, and how far through you are.
 *
 * Built for a phone held in one hand on a pavement. The next door is a large
 * card at the top with the address and a Navigate button, because that is the
 * only thing you need between one house and the next; the full list is
 * underneath for when you want to see what is left.
 */
export function RouteScreen() {
  const params = useSearchParams();
  const routeId = params.get("id") ?? "";
  const isNew = params.get("new") === "1";
  const router = useRouter();

  const { byId, routes: allRoutes, loading } = useKnockRoutes();
  const { byId: customersById } = useCustomers();
  const { author, users, colorFor, nameFor } = useTeam();
  const notify = useNotify();

  const route = routeId ? (byId.get(routeId) ?? null) : null;

  const [name, setName] = useState("");
  const [day, setDay] = useState("");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [stopIds, setStopIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A new route starts as local state and is not written until Save, so backing
  // out of one leaves nothing behind.
  useEffect(() => {
    if (!isNew) return;
    setName("");
    setDay(isoDay(new Date()));
    setAssigned(author ? [author.uid] : []);
    setStopIds([]);
  }, [isNew, author]);

  const stops = useMemo(
    () =>
      (route?.stopIds ?? stopIds)
        .map((id) => customersById.get(id))
        .filter((customer): customer is Customer => customer !== undefined),
    [route, stopIds, customersById],
  );

  const progress = routeProgress(
    route?.stopIds ?? stopIds,
    route?.knockedIds ?? [],
  );
  const minutes = estimateRouteMinutes(
    stops.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng })),
  );
  const upNext = route ? nextStop(stops, route.knockedIds) : null;
  const taken = useMemo(
    () => stopsOnOtherRoutes(allRoutes, routeId),
    [allRoutes, routeId],
  );

  /* ------------------------------------------------------------- writing */

  async function onCreate() {
    if (!author) return;
    if (stopIds.length === 0) {
      setError("Pick at least one door — an empty route is nothing to walk.");
      return;
    }
    setBusy(true);
    setError(null);
    const walkOn = parseDay(day);
    try {
      const id = await createKnockRoute(
        { name, walkDate: walkOn, assignedTo: assigned, stopIds },
        author,
      );
      // Whoever it lands on should hear about it without being told in person —
      // that is the whole point of assigning rather than shouting across a van.
      if (assigned.some((uid) => uid !== author.uid)) {
        await notify({
          type: "route_assigned",
          body: `${name.trim() || "Untitled route"} · ${stopIds.length} door${
            stopIds.length === 1 ? "" : "s"
          }${walkOn ? ` · ${format(walkOn, "EEE MMM d")}` : ""}`,
        });
      }
      router.replace(routes.knockRoute(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that route.");
      setBusy(false);
    }
  }

  async function patch(next: Parameters<typeof updateKnockRoute>[1]) {
    if (!route || !author) return;
    setBusy(true);
    setError(null);
    try {
      await updateKnockRoute(route, next, author);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleKnocked(customerId: string, knocked: boolean) {
    if (!route || !author) return;
    try {
      await setKnocked(route, customerId, knocked, author);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that knock.");
    }
  }

  async function onReplan() {
    if (!route || !author) return;
    setBusy(true);
    try {
      // From where you are standing, when the browser will say — that is what
      // makes the first stop the one you can see from the van.
      const from = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
          timeout: 5000,
          maximumAge: 60_000,
        });
      });
      await reorderFromHere(
        route,
        customersById,
        from ? { lat: from.coords.latitude, lng: from.coords.longitude } : null,
        author,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-plan the order.");
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------ rendering */

  if (!isNew && loading && !route) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!isNew && !route) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-base font-bold text-ink">
          That route no longer exists.
        </p>
        <Link
          href={routes.knockRoutes}
          className="tap-target inline-flex items-center justify-center rounded-xl bg-accent px-4 py-3 text-base font-semibold text-accent-ink"
        >
          Back to routes
        </Link>
      </div>
    );
  }

  const assignedNow = route?.assignedTo ?? assigned;

  const toggleAssignee = (uid: string) => {
    const next = assignedNow.includes(uid)
      ? assignedNow.filter((entry) => entry !== uid)
      : [...assignedNow, uid];
    if (route) void patch({ assignedTo: next });
    else setAssigned(next);
  };

  return (
    <div className="h-full overflow-y-auto pb-24">
      <ScreenHeader
        title={isNew ? "New route" : (route?.name ?? "Route")}
        subtitle={
          route
            ? `${ROUTE_STATUS_LABEL[route.status]} · ${progress.knocked} of ${progress.total} knocked`
            : "Name it, pick a territory, hand it to somebody"
        }
      />

      <div className="flex flex-col gap-5 px-4 py-4">
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        {/* ------------------------------------------------------ up next */}

        {upNext ? (
          <section className="rounded-2xl border border-accent/50 bg-accent/10 p-4">
            <p className="text-sm font-bold tracking-wide text-muted uppercase">
              Next door
            </p>
            <p className="mt-1 text-xl font-extrabold break-words text-ink">
              {customerName(upNext)}
            </p>
            <p className="mt-0.5 text-base font-semibold break-words text-muted">
              {upNext.address || "No address"}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a
                href={
                  upNext.lat || upNext.lng
                    ? `https://www.google.com/maps/dir/?api=1&destination=${upNext.lat},${upNext.lng}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(upNext.address)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="tap-target inline-flex items-center justify-center rounded-full bg-accent px-4 text-base font-semibold text-accent-ink"
              >
                Navigate
              </a>
              <Button
                variant="money"
                onClick={() => void onToggleKnocked(upNext.id, true)}
              >
                Knocked
              </Button>
            </div>
          </section>
        ) : null}

        {/* -------------------------------------------------------- basics */}

        <section className="flex flex-col gap-3">
          {route ? (
            <TextField
              label="Name"
              value={route.name}
              onChange={(e) => void patch({ name: e.target.value })}
              hint="What you'd call it out loud — “Ridgemoor sweep”."
            />
          ) : (
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ridgemoor sweep"
              hint="What you'd call it out loud."
            />
          )}

          <label className="block">
            <span className="mb-1 block text-base font-semibold text-ink">
              Day to walk it
            </span>
            <input
              type="date"
              value={route ? (route.walkDate ? isoDay(route.walkDate.toDate()) : "") : day}
              onChange={(e) =>
                route ? void patch({ walkDate: parseDay(e.target.value) }) : setDay(e.target.value)
              }
              className="tap-target w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink focus:border-accent focus:outline-none"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-base font-semibold text-ink">
              Who&apos;s walking it
            </span>
            <div className="flex flex-wrap gap-2">
              {users.map((user) => (
                <Chip
                  key={user.uid}
                  active={assignedNow.includes(user.uid)}
                  onClick={() => toggleAssignee(user.uid)}
                >
                  {user.displayName}
                </Chip>
              ))}
            </div>
            {assignedNow.length === 0 ? (
              <p className="mt-1.5 text-sm font-bold text-warn">
                Nobody assigned — it shows up for everyone until somebody takes it.
              </p>
            ) : null}
          </div>
        </section>

        {/* --------------------------------------------------------- doors */}

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">
              {progress.total} door{progress.total === 1 ? "" : "s"}
              {progress.total > 0 ? (
                <span className="ml-2 text-base font-semibold text-muted">
                  about {formatMinutes(minutes)}
                </span>
              ) : null}
            </h2>
            <Button variant="secondary" onClick={() => setPicking(true)}>
              {progress.total === 0 ? "Territories" : "Edit"}
            </Button>
          </div>

          {route && progress.total > 1 ? (
            <Button
              variant="secondary"
              full
              className="mb-2"
              disabled={busy}
              onClick={() => void onReplan()}
            >
              {busy ? "Working…" : "Re-order from where I am"}
            </Button>
          ) : null}

          {stops.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 px-3 py-4 text-base font-semibold text-muted">
              No doors yet. Pick a territory — that is how you decide where to
              knock — and the order sorts itself out.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {stops.map((customer, index) => {
                const knocked = route?.knockedIds.includes(customer.id) ?? false;
                return (
                  <li
                    key={customer.id}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${
                      knocked
                        ? "border-line bg-surface-2 opacity-60"
                        : "border-line bg-surface-2"
                    }`}
                  >
                    {route ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={knocked}
                        aria-label={`Knocked ${customerName(customer)}`}
                        onClick={() => void onToggleKnocked(customer.id, !knocked)}
                        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border-2 text-base font-black ${
                          knocked
                            ? "border-money bg-money text-money-ink"
                            : "border-line text-transparent"
                        }`}
                      >
                        ✓
                      </button>
                    ) : (
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-base font-bold text-muted">
                        {index + 1}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <Link
                        href={routes.customer(customer.id)}
                        className={`block text-base font-bold break-words ${
                          knocked ? "text-muted line-through" : "text-ink"
                        }`}
                      >
                        {index + 1}. {customerName(customer)}
                      </Link>
                      <p className="text-sm font-semibold break-words text-muted">
                        {customer.address || "No address"} · {STATUS_LABEL[customer.status]}
                      </p>
                      {customer.phone ? (
                        <a
                          href={`tel:${customer.phone}`}
                          className="text-sm font-semibold text-accent"
                        >
                          {formatPhone(customer.phone)}
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* -------------------------------------------------------- saving */}

        {isNew ? (
          <Button full disabled={busy} onClick={() => void onCreate()}>
            {busy ? "Saving…" : "Save route"}
          </Button>
        ) : (
          <section className="border-t border-line pt-5">
            {route && route.status !== "done" && progress.total > 0 ? (
              <Button
                variant="secondary"
                full
                className="mb-3"
                onClick={() => void patch({ status: "done" })}
              >
                Mark the whole route finished
              </Button>
            ) : null}
            <Button variant="secondary" full onClick={() => setConfirmDelete(true)}>
              Delete this route
            </Button>
            <p className="mt-2 text-sm font-semibold text-muted">
              Deleting a route leaves every customer on it exactly as they are —
              it only throws away the list and the order.
            </p>
            {route?.updatedByName ? (
              <p className="mt-3 text-sm font-semibold text-muted">
                Last changed by {route.updatedByName}
              </p>
            ) : null}
          </section>
        )}

        {route && route.assignedTo.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {route.assignedTo.map((uid) => (
              <UserChip key={uid} name={nameFor(uid)} color={colorFor(uid)} />
            ))}
          </div>
        ) : null}
      </div>

      <StopPickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        selectedIds={route?.stopIds ?? stopIds}
        takenIds={taken}
        onDone={(ids) => {
          if (route) void patch({ stopIds: ids });
          else setStopIds(ids);
          setPicking(false);
        }}
      />

      <Sheet
        open={confirmDelete}
        title="Delete this route?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" full onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              full
              onClick={() => {
                if (!route) return;
                void deleteKnockRoute(route.id).then(() =>
                  router.replace(routes.knockRoutes),
                );
              }}
            >
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-base font-semibold text-muted">
          The customers stay. Only the list and the walking order go.
        </p>
      </Sheet>
    </div>
  );
}
