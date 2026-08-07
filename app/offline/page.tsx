/**
 * Served by the service worker when a navigation request cannot be fulfilled
 * from network or cache. Deliberately plain — it must not depend on Firebase,
 * the Maps script, or anything else that needs a connection.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-3 h-1.5 w-12 rounded-full bg-accent" />
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">You&apos;re offline</h1>
        <p className="mt-2 text-base font-semibold text-muted">
          This screen hasn&apos;t been cached yet. Customer records and notes you already
          loaded still work, and anything you write now is queued and syncs the moment
          you get signal back.
        </p>
        <p className="mt-4 text-base font-semibold text-muted">
          The map needs a connection — Google&apos;s terms don&apos;t allow storing tiles
          for offline use.
        </p>
      </div>
    </main>
  );
}
