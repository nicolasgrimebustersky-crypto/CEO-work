"use client";

import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useLocationSharing } from "@/components/providers/LocationSharingProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { GeocodeBackfill } from "./GeocodeBackfill";
import { MapBoundary, MapUnavailable } from "./MapBoundary";
import { applyFilters, activeFilterCount, EMPTY_FILTERS } from "@/lib/filters";
import type { CustomerFilters } from "@/lib/filters";
import { DEFAULT_ZOOM, OLDHAM_COUNTY_CENTER } from "@/lib/geo";
import { useLiveLocation } from "@/lib/useLiveLocation";
import type { Customer, LatLng } from "@/lib/types";
import { useOpenMenu } from "@/components/shell/menu";
import { MenuIcon } from "@/components/shell/navIcons";
import { CustomerPin, DraftPin } from "./CustomerPin";
import { CustomerPreviewSheet } from "./CustomerPreviewSheet";
import { FilterSheet } from "./FilterSheet";
import { MapTypeToggle, type MapTypeOption } from "./MapTypeToggle";
import { QuickEntrySheet } from "./QuickEntrySheet";
import { TeammateDot } from "./TeammateDot";

/** A teammate's dot goes flat and dim once their fix is this old. */
const STALE_LOCATION_MS = 5 * 60 * 1000;

export function MapScreen() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  // A Map ID is required for Advanced Markers. DEMO_MAP_ID works without any
  // Cloud console setup but watermarks the map, so it's a fallback only.
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

  if (!apiKey) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm">
          <h2 className="text-xl font-extrabold text-ink">Map key missing</h2>
          <p className="mt-2 text-base font-semibold text-muted">
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">
              NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
            </code>{" "}
            is not set in this build. On Vercel, add it under Settings →
            Environment Variables and <strong>redeploy</strong> — it is read at build
            time, so an existing deployment will not pick it up. Running locally, put
            it in{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">.env.local</code>{" "}
            and restart.
          </p>
          <p className="mt-3 text-base font-semibold text-muted">
            The key needs Maps JavaScript API, Geocoding API and Routes API enabled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} libraries={["marker", "geocoding"]}>
      <MapCanvas mapId={mapId} />
    </APIProvider>
  );
}

function MapCanvas({ mapId }: { mapId: string }) {
  const map = useMap();
  const { author, users, colorFor } = useTeam();
  const { customers, loading, error } = useCustomers();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");

  const { sharing } = useLocationSharing();
  const live = useLiveLocation(author?.uid ?? null, sharing);

  const openMenu = useOpenMenu();
  const [mapTypeId, setMapTypeId] = useState<MapTypeOption>("satellite");
  const [filters, setFilters] = useState<CustomerFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<LatLng | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(
    () => applyFilters(customers, filters),
    [customers, filters],
  );
  const filterCount = activeFilterCount(filters);
  const selected = selectedId ? (customers.find((c) => c.id === selectedId) ?? null) : null;

  // Centre on the first GPS fix, then leave the camera alone — re-centring on
  // every fix would fight the user panning around a neighbourhood.
  const hasCentered = useRef(false);
  useEffect(() => {
    if (!map || !live.position || hasCentered.current) return;
    hasCentered.current = true;
    map.panTo(live.position);
    map.setZoom(DEFAULT_ZOOM);
  }, [map, live.position]);

  // Arriving from the customer list with ?focus=<id> pans to that pin.
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !focusId || focusedRef.current === focusId) return;
    const target = customers.find((c) => c.id === focusId);
    if (!target) return;
    focusedRef.current = focusId;
    hasCentered.current = true;
    map.panTo({ lat: target.lat, lng: target.lng });
    map.setZoom(DEFAULT_ZOOM);
    setSelectedId(focusId);
  }, [map, focusId, customers]);

  function recenter() {
    if (!map || !live.position) return;
    map.panTo(live.position);
    map.setZoom(DEFAULT_ZOOM);
  }

  const now = Date.now();

  return (
    <div className="flex h-full w-full flex-col">
      <GeocodeBackfill customers={customers} />
      <MapBoundary fallback={(error) => <MapUnavailable error={error} />}>
        <div className="relative min-h-0 flex-1">
      <Map
        mapId={mapId}
        defaultCenter={OLDHAM_COUNTY_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        mapTypeId={mapTypeId}
        // "greedy" so a single finger pans — the two-finger default is
        // unusable one-handed.
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        tiltInteractionEnabled={false}
        rotateControl={false}
        className="h-full w-full"
        onClick={(event) => {
          const latLng = event.detail.latLng;
          if (!latLng) return;
          setSelectedId(null);
          setDraft({ lat: latLng.lat, lng: latLng.lng });
        }}
      >
        {visible.map((customer) => (
          <CustomerPin
            key={customer.id}
            customer={customer}
            selected={customer.id === selectedId}
            onSelect={(next: Customer) => {
              setDraft(null);
              setSelectedId(next.id);
            }}
          />
        ))}

        {users
          .filter((user) => user.uid !== author?.uid)
          // isActive is their sharing switch; a stale dot is worse than none.
          .filter((user) => user.isActive)
          .filter(
            (user): user is typeof user & { currentLat: number; currentLng: number } =>
              typeof user.currentLat === "number" && typeof user.currentLng === "number",
          )
          .map((user) => (
            <TeammateDot
              key={user.uid}
              position={{ lat: user.currentLat, lng: user.currentLng }}
              name={user.displayName}
              color={colorFor(user.uid)}
              isMe={false}
              stale={
                !user.lastLocationUpdate ||
                now - user.lastLocationUpdate.toMillis() > STALE_LOCATION_MS
              }
            />
          ))}

        {live.position && author ? (
          <TeammateDot
            position={live.position}
            name={author.displayName}
            color={colorFor(author.uid)}
            isMe
            stale={false}
          />
        ) : null}

        {draft ? <DraftPin position={draft} /> : null}
      </Map>

      {/* Top overlay: what you're looking at, and how it's rendered. */}
      <div className="pt-safe pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 px-3">
        <div className="pointer-events-auto flex flex-col items-start gap-2">
          {/* The map has no ScreenHeader, so it carries its own way into the
              menu — a floating circle, like the other controls out here. */}
          {openMenu ? (
            <button
              type="button"
              onClick={openMenu}
              aria-label="Open menu"
              className="tap-target flex size-11 items-center justify-center rounded-full border border-line bg-canvas/85 text-ink backdrop-blur-sm"
            >
              <MenuIcon />
            </button>
          ) : null}
          <span className="rounded-xl border border-line bg-canvas/85 px-3 py-2 text-sm font-bold text-ink backdrop-blur-sm">
            {loading
              ? "Loading pins…"
              : `${visible.length} of ${customers.length} ${
                  customers.length === 1 ? "pin" : "pins"
                }`}
          </span>
          {error ? (
            <span
              role="alert"
              className="max-w-[15rem] rounded-xl border border-danger/70 bg-danger/25 px-3 py-2 text-sm font-bold text-ink backdrop-blur-sm"
            >
              {error}
            </span>
          ) : null}
          {live.error ? (
            <span className="max-w-[15rem] rounded-xl border border-warn/70 bg-warn/20 px-3 py-2 text-sm font-bold text-ink backdrop-blur-sm">
              {live.error}
            </span>
          ) : null}
        </div>

        <div className="pointer-events-auto">
          <MapTypeToggle value={mapTypeId} onChange={setMapTypeId} />
        </div>
      </div>

      {/* Bottom-right controls sit inside thumb reach in portrait. */}
      <div className="absolute right-3 bottom-4 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          aria-label={`Filters${filterCount > 0 ? `, ${filterCount} active` : ""}`}
          className="tap-target relative flex size-14 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-lg"
        >
          <FilterIcon />
          {filterCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex size-6 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-accent-ink">
              {filterCount}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={recenter}
          disabled={!live.position}
          aria-label="Centre on my location"
          className="tap-target flex size-14 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-lg disabled:opacity-45"
        >
          <CrosshairIcon />
        </button>
      </div>

      {/* Hint only while the map is empty — it stops being useful after that. */}
      {!loading && customers.length === 0 ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-24 mx-auto w-fit rounded-xl border border-line bg-canvas/90 px-4 py-2.5 text-base font-bold text-ink backdrop-blur-sm">
          Tap a house to drop your first pin
        </p>
      ) : null}

      <QuickEntrySheet
        position={draft}
        onClose={() => setDraft(null)}
        onCreated={(id) => {
          setDraft(null);
          setSelectedId(id);
        }}
      />

      <FilterSheet
        open={filterOpen}
        filters={filters}
        matchCount={visible.length}
        onChange={setFilters}
        onClose={() => setFilterOpen(false)}
      />

          <CustomerPreviewSheet customer={selected} onClose={() => setSelectedId(null)} />
        </div>
      </MapBoundary>
    </div>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
      <path
        d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrosshairIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden="true">
      <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth={2} />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <path
        d="M12 2v3m0 14v3M2 12h3m14 0h3"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
