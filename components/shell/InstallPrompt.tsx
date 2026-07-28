"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { isIOS, isStandalone } from "@/lib/device/capabilities";

const DISMISSED_KEY = "gb:install-dismissed";

/**
 * Chrome and Edge fire this so a site can offer its own install button. Safari
 * does not implement it at all, which is why iOS needs the hand-written
 * instructions below.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Nudges the crew to install the app to their home screen.
 *
 * Installing is not cosmetic here. In a browser tab the app loses roughly a
 * fifth of the screen to Safari's chrome, the address bar reappears on every
 * scroll, and — the one that actually matters — the tab gets evicted from
 * memory far more aggressively than an installed app, which means reopening it
 * between houses is a cold start rather than a resume.
 */
export function InstallPrompt() {
  const [open, setOpen] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed, nothing to say
    if (typeof window !== "undefined" && window.localStorage.getItem(DISMISSED_KEY)) {
      return;
    }

    setIos(isIOS());
    setShowBanner(true);

    const onBeforeInstall = (event: Event) => {
      // Suppress the browser's own mini-infobar so ours is the only prompt.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    setShowBanner(false);
    setOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    }
  }

  async function install() {
    if (!deferred) {
      setOpen(true);
      return;
    }
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") dismiss();
    setDeferred(null);
  }

  if (!showBanner) return null;

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <span className="min-w-0 flex-1 text-sm font-bold text-ink">
          Add to your home screen for full screen and faster reopening.
        </span>
        <button
          type="button"
          onClick={() => void install()}
          className="tap-target shrink-0 rounded-xl bg-accent px-3 text-sm font-black text-accent-ink"
        >
          {ios ? "How" : "Install"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="tap-target shrink-0 px-2 text-xl leading-none text-muted"
        >
          ×
        </button>
      </div>

      <Sheet
        open={open}
        title="Add to home screen"
        onClose={() => setOpen(false)}
        footer={
          <Button full onClick={dismiss}>
            Got it
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {ios ? (
            <>
              <p className="text-base font-semibold text-ink">
                Safari doesn&apos;t have an install button, so this is a three-tap
                job:
              </p>
              <ol className="flex flex-col gap-3">
                <Step n={1}>
                  Tap the <strong className="text-ink">Share</strong> button — the
                  square with an arrow pointing up, in the bar at the bottom of
                  Safari.
                </Step>
                <Step n={2}>
                  Scroll down the list and tap{" "}
                  <strong className="text-ink">Add to Home Screen</strong>.
                </Step>
                <Step n={3}>
                  Tap <strong className="text-ink">Add</strong>. The icon lands on
                  your home screen and opens full screen from then on.
                </Step>
              </ol>
              <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm font-semibold text-muted">
                It has to be Safari — Chrome on iPhone can&apos;t add to the home
                screen.
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-ink">
                Your browser should offer an install button. If it didn&apos;t
                appear:
              </p>
              <ol className="flex flex-col gap-3">
                <Step n={1}>Open the browser menu (⋮).</Step>
                <Step n={2}>
                  Tap <strong className="text-ink">Install app</strong> or{" "}
                  <strong className="text-ink">Add to Home screen</strong>.
                </Step>
              </ol>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-black text-accent-ink">
        {n}
      </span>
      <span className="text-base leading-relaxed text-muted">{children}</span>
    </li>
  );
}
