"use client";

import { useEffect, useState } from "react";

import {
  BUILD_ID,
  STALE_BODY,
  STALE_TITLE,
  isStaleBuild,
  shortBuild,
} from "@/lib/buildVersion";

/**
 * Says so when the link somebody is on has been replaced.
 *
 * Every Vercel deployment keeps a permanent URL, so a link shared last month
 * still loads and still looks right. This asks the production URL which build
 * is live and compares. It cannot be dismissed: a stale link is not a
 * preference, and the point is that the next person to be handed it is told
 * too.
 *
 * Silent unless it is certain — no site URL configured, no network, no answer,
 * or matching builds all leave the page alone. Crying stale because the wifi
 * dropped would teach everybody to ignore the one that matters.
 */
export function StaleBuildBanner() {
  const [live, setLive] = useState<string | null>(null);

  useEffect(() => {
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
    if (!site || !BUILD_ID) return;

    // Same origin means this *is* production. Asking would compare a build to
    // itself, and would put a request on every page load for nothing.
    if (typeof window !== "undefined" && window.location.origin === site) return;

    let cancelled = false;
    void fetch(`${site}/api/version`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { buildId?: string } | null) => {
        if (!cancelled && typeof data?.buildId === "string") setLive(data.buildId);
      })
      .catch(() => {
        // Offline, blocked, or the endpoint is older than this feature. None of
        // those is evidence the build is stale.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isStaleBuild(BUILD_ID, live)) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 border-b border-warn bg-warn px-3 py-2.5 text-black"
    >
      <p className="text-base font-extrabold">{STALE_TITLE}</p>
      <p className="mt-0.5 text-sm font-semibold">{STALE_BODY}</p>
      <p className="mt-0.5 text-xs font-bold opacity-75">
        This build {shortBuild(BUILD_ID)} · current {shortBuild(live)}
      </p>
    </div>
  );
}
