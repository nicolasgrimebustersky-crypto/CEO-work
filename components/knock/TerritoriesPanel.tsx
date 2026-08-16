"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useNotify } from "@/components/providers/NotificationsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { useTerritories } from "@/components/providers/TerritoriesProvider";
import { Button } from "@/components/ui/Button";
import { UserChip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { createKnockRoute } from "@/lib/db/knockRoutes";
import { deleteTerritory, pinsIn, updateTerritory } from "@/lib/db/territories";
import { orderByNearest } from "@/lib/knock/plan";
import { acresOf, coverageOf, formatAcres } from "@/lib/knock/territory";
import { routes } from "@/lib/routes";
import type { Territory } from "@/lib/types";

/**
 * The ground you have drawn, and what is standing on it.
 *
 * Coverage is counted from `lastContactedAt` on the pins inside the outline,
 * which the quick-entry sheet stamps the moment you drop one at a door — so
 * "18 of 40 knocked" is a record of houses actually spoken to rather than a
 * checkbox somebody remembered to tick.
 */
export function TerritoriesPanel() {
  const { territories, loading, error } = useTerritories();
  const { customers } = useCustomers();
  const { author, colorFor, nameFor } = useTeam();
  const notify = useNotify();
  const router = useRouter();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRetire, setConfirmRetire] = useState<Territory | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Everything knockable inside the outline becomes a route, already in walking
   * order. This is the join between the two halves of the feature: the
   * territory says *where*, the route says *in what order*, and nobody should
   * have to retype the middle.
   */
  async function makeRoute(territory: Territory) {
    if (!author) return;
    setBusyId(territory.id);
    setProblem(null);
    try {
      const inside = pinsIn(territory, customers).filter(
        (customer) => customer.status !== "do_not_knock",
      );
      if (inside.length === 0) {
        setProblem(
          `No doors inside ${territory.name} yet. Drop pins as you knock and they'll join it automatically.`,
        );
        return;
      }

      const ordered = orderByNearest(
        inside.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng })),
        null,
      ).map((stop) => stop.id);

      const id = await createKnockRoute(
        {
          name: `${territory.name} sweep`,
          walkDate: null,
          assignedTo: territory.assignedTo,
          stopIds: ordered,
          notes: `Built from the ${territory.name} territory.`,
        },
        author,
      );

      if (territory.assignedTo.some((uid) => uid !== author.uid)) {
        await notify({
          type: "route_assigned",
          body: `${territory.name} sweep · ${ordered.length} door${ordered.length === 1 ? "" : "s"}`,
        });
      }
      router.push(routes.knockRoute(id));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not build that route.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return null;

  if (territories.length === 0) {
    return (
      <div className="mx-4 mt-4 rounded-2xl border border-line bg-surface-2 p-4">
        <p className="text-base font-bold text-ink">No territory drawn yet</p>
        <p className="mt-1 text-base font-semibold text-muted">
          A territory is an area of streets somebody owns — the ground you
          haven&apos;t knocked yet, which is the part a list of pins can&apos;t
          describe. Draw one on the map and every pin you drop inside it counts
          towards covering it.
        </p>
        <Link
          href={routes.drawTerritory}
          className="tap-target mt-3 inline-flex items-center justify-center rounded-full bg-accent px-4 text-base font-semibold text-accent-ink"
        >
          Draw one on the map
        </Link>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mx-4 mt-4 rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}
      {problem ? (
        <p
          role="alert"
          className="mx-4 mt-4 rounded-xl border border-warn/70 bg-warn/15 px-3 py-3 text-base font-semibold text-ink"
        >
          {problem}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2 px-4 pt-3">
        {territories.map((territory) => {
          const inside = pinsIn(territory, customers);
          const coverage = coverageOf(inside);
          const owner = territory.assignedTo[0];

          return (
            <li
              key={territory.id}
              className={`rounded-2xl border bg-surface-2 p-3 ${
                territory.active ? "border-line" : "border-line opacity-60"
              }`}
              style={
                territory.active
                  ? { borderLeft: `4px solid ${colorFor(owner)}` }
                  : undefined
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-bold break-words text-ink">
                    {territory.name}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-muted">
                    {formatAcres(acresOf(territory.boundary))} ·{" "}
                    {coverage.total} pin{coverage.total === 1 ? "" : "s"} inside
                    {coverage.won > 0 ? ` · ${coverage.won} won` : ""}
                  </p>
                </div>
                {!territory.active ? (
                  <span className="shrink-0 rounded-full bg-surface-3 px-2.5 py-1 text-sm font-bold text-muted">
                    Retired
                  </span>
                ) : null}
              </div>

              {coverage.total > 0 ? (
                <div className="mt-2.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-money"
                      style={{ width: `${Math.round(coverage.fraction * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-sm font-semibold text-muted">
                    {coverage.total - coverage.unknocked} knocked ·{" "}
                    {coverage.unknocked} never contacted
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm font-semibold text-muted">
                  Nothing pinned inside it yet.
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {territory.assignedTo.length > 0 ? (
                  territory.assignedTo.map((uid) => (
                    <UserChip key={uid} name={nameFor(uid)} color={colorFor(uid)} />
                  ))
                ) : (
                  <span className="text-sm font-bold text-muted">Unclaimed ground</span>
                )}
              </div>

              {territory.active ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    disabled={busyId === territory.id}
                    onClick={() => void makeRoute(territory)}
                  >
                    {busyId === territory.id ? "Building…" : "Make a route"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setConfirmRetire(territory)}
                  >
                    Retire
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  full
                  className="mt-3"
                  onClick={() => {
                    if (author) void updateTerritory(territory, { active: true }, author);
                  }}
                >
                  Put it back
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="px-4 pt-3">
        <Link
          href={routes.drawTerritory}
          className="tap-target flex items-center justify-center rounded-full border border-accent/50 bg-accent/10 px-4 text-base font-semibold text-ink"
        >
          Draw another territory
        </Link>
      </div>

      <Sheet
        open={confirmRetire !== null}
        title={`Retire ${confirmRetire?.name ?? ""}?`}
        onClose={() => setConfirmRetire(null)}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" full onClick={() => setConfirmRetire(null)}>
              Keep it
            </Button>
            <Button
              full
              onClick={() => {
                if (confirmRetire && author) {
                  void updateTerritory(confirmRetire, { active: false }, author);
                }
                setConfirmRetire(null);
              }}
            >
              Retire it
            </Button>
          </div>
        }
      >
        <p className="text-base font-semibold text-muted">
          It comes off the map and stops counting, but stays here so you can put
          it back. Nothing pinned inside it is touched.
        </p>
        <Button
          variant="danger"
          full
          className="mt-4"
          onClick={() => {
            if (confirmRetire) void deleteTerritory(confirmRetire.id);
            setConfirmRetire(null);
          }}
        >
          Delete it for good
        </Button>
      </Sheet>
    </>
  );
}
