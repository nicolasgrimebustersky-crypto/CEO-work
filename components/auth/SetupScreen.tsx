import { missingFirebaseKeys } from "@/lib/firebase";

/**
 * Shown instead of a stack trace when the app is running without credentials —
 * which is the state of a fresh clone, since .env.local ships blank.
 */
export function SetupScreen() {
  const missing = missingFirebaseKeys();

  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-3 h-1.5 w-12 rounded-full bg-accent" />
        <h1 className="text-2xl font-black tracking-tight text-ink">Finish setup</h1>
        <p className="mt-2 text-base font-semibold text-muted">
          The app needs its Firebase keys before it can sign anyone in. Copy{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">.env.example</code>{" "}
          to <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">.env.local</code>,
          fill it in, and restart the dev server. Full walkthrough is in the README.
        </p>

        {missing.length > 0 ? (
          <div className="mt-6 rounded-xl border border-line bg-surface p-4">
            <h2 className="text-base font-bold text-ink">Still blank</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {missing.map((key) => (
                <li key={key} className="font-mono text-sm font-semibold text-warn">
                  {key}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </main>
  );
}
