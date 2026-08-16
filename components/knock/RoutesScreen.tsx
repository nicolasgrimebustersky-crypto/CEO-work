"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useKnockRoutes } from "@/components/providers/KnockRoutesProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Chip, UserChip } from "@/components/ui/Chips";
import { Spinner } from "@/components/ui/Spinner";
import { routesFor } from "@/lib/db/knockRoutes";
import { formatDateOnly } from "@/lib/format";
import { estimateRouteMinutes, formatMinutes, routeProgress } from "@/lib/knock/plan";
import { routes } from "@/lib/routes";
import { ROUTE_STATUS_LABEL, type KnockRoute } from "@/lib/types";
import { TerritoriesPanel } from "./TerritoriesPanel";

type Scope = "mine" | "all";
type Tab = "routes" | "territories";

/**
 * Every door-knocking route, opening on the ones still to be walked.
 *
 * The question this screen answers is "what am I doing this afternoon", so it
 * defaults to your routes rather than everybody's, and a finished route sinks
 * to the bottom however recent it is.
 */
export function RoutesScreen() {
  const { routes: allRoutes, loading, error } = useKnockRoutes();
  const { byId: customersById } = useCustomers();
  const { author, colorFor, nameFor } = useTeam();
  const [scope, setScope] = useState<Scope>("mine");
  const [tab, setTab] = useState<Tab>("routes");

  const visible = useMemo(
    () => (scope === "mine" ? routesFor(allRoutes, author?.uid ?? null) : allRoutes),
    [allRoutes, scope, author],
  );

  const summary = (route: KnockRoute) => {
    const progress = routeProgress(route.stopIds, route.knockedIds);
    const stops = route.stopIds
      .map((id) => customersById.get(id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined)
      .map((c) => ({ id: c.id, lat: c.lat, lng: c.lng }));
    return { progress, minutes: estimateRouteMinutes(stops) };
  };

  return (
    <div className="h-full overflow-y-auto pb-24">
      <ScreenHeader
        title="Routes"
        subtitle={
          tab === "routes"
            ? "Doors to knock, and who is walking them"
            : "Ground you own, and how much of it is covered"
        }
      >
        <div className="mt-3 flex items-center gap-2">
          <Chip active={tab === "routes"} onClick={() => setTab("routes")}>
            Routes
          </Chip>
          <Chip active={tab === "territories"} onClick={() => setTab("territories")}>
            Territories
          </Chip>
          <Link
            href={tab === "routes" ? routes.newKnockRoute : routes.drawTerritory}
            className="tap-target ml-auto inline-flex items-center justify-center rounded-full bg-accent px-4 text-base font-semibold text-accent-ink"
          >
            {tab === "routes" ? "New route" : "Draw one"}
          </Link>
        </div>

        {tab === "routes" ? (
          <div className="mt-2 flex items-center gap-2">
            <Chip active={scope === "mine"} onClick={() => setScope("mine")}>
              Mine
            </Chip>
            <Chip active={scope === "all"} onClick={() => setScope("all")}>
              Everyone
            </Chip>
          </div>
        ) : null}
      </ScreenHeader>

      {tab === "territories" ? <TerritoriesPanel /> : null}

      {tab === "routes" && error ? (
        <p
          role="alert"
          className="mx-4 mt-4 rounded-xl border border-danger/60 bg-danger/15 px-3 py-3 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}

      {tab !== "routes" ? null : loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <div className="mx-4 mt-4 rounded-2xl border border-line bg-surface-2 p-4">
          <p className="text-base font-bold text-ink">
            {scope === "mine" ? "Nothing assigned to you" : "No routes yet"}
          </p>
          <p className="mt-1 text-base font-semibold text-muted">
            A route is a list of doors in the order you&apos;ll walk them. Build one
            from the map or from your leads, put a name and a day on it, and hand
            it to whoever is knocking.
          </p>
          <Link
            href={routes.newKnockRoute}
            className="tap-target mt-3 inline-flex items-center justify-center rounded-full bg-accent px-4 text-base font-semibold text-accent-ink"
          >
            Build the first one
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 px-4 pt-3">
          {visible.map((route) => {
            const { progress, minutes } = summary(route);
            return (
              <li key={route.id}>
                <Link
                  href={routes.knockRoute(route.id)}
                  className="block rounded-2xl border border-line bg-surface-2 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-bold break-words text-ink">
                        {route.name}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-muted">
                        {route.walkDate ? formatDateOnly(route.walkDate) : "No day set"}
                        {" · "}
                        {progress.total} door{progress.total === 1 ? "" : "s"}
                        {progress.total > 0 ? ` · about ${formatMinutes(minutes)}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-bold ${
                        route.status === "done"
                          ? "bg-money/15 text-money"
                          : route.status === "walking"
                            ? "bg-accent/15 text-accent"
                            : "bg-surface-3 text-muted"
                      }`}
                    >
                      {ROUTE_STATUS_LABEL[route.status]}
                    </span>
                  </div>

                  {/* Progress as a bar rather than a fraction: standing on a
                      pavement you want to know "nearly there" at a glance. */}
                  {progress.total > 0 ? (
                    <div className="mt-2.5">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-money transition-[width]"
                          style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-sm font-semibold text-muted">
                        {progress.knocked} knocked · {progress.remaining} to go
                      </p>
                    </div>
                  ) : null}

                  {route.assignedTo.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {route.assignedTo.map((uid) => (
                        <UserChip key={uid} name={nameFor(uid)} color={colorFor(uid)} />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm font-bold text-warn">Nobody assigned</p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
