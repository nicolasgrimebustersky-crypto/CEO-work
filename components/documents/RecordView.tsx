"use client";

import { useEffect, useRef } from "react";

import {
  DWELL_MS,
  isCrewLink,
  shouldArm,
  shouldFire,
} from "@/lib/documentViewBeacon";

/**
 * Tells the server this link was opened by a person.
 *
 * Renders nothing. It exists to run one fetch after the page has hydrated and
 * stayed in front of somebody, because the alternative — stamping as the page
 * renders on the server — would be wrong on nearly every record. Every
 * messaging app that shows a preview card fetches the URL the moment it is
 * sent, so the stamp would say "opened" about a text the customer has not
 * looked at yet, and the crew would chase decisions nobody had been asked to
 * make.
 *
 * What this actually defends against, stated honestly because the value of the
 * whole feature rests on it:
 *
 *   Reliably stopped — the fetchers that only parse HTML for a preview card
 *   and never run scripts: facebookexternalhit (Facebook, Messenger,
 *   WhatsApp), Slackbot, Twitterbot, Skype, ordinary crawlers.
 *
 *   Usually stopped — renderers that do execute JavaScript but do not stay:
 *   browser prerender and speculative loads (skipped outright), and security
 *   scanners that detonate a URL headlessly, which the dwell is aimed at.
 *
 *   NOT stopped — anything that renders the page, waits, and reports itself as
 *   visible. Apple's rich link preview is the one worth naming: it is not
 *   documented as script-free, and iMessage is the channel this business texts
 *   from. If a quote ever reads Opened seconds after it was sent, that is the
 *   first thing to suspect.
 *
 * When each of those applies is decided in lib/documentViewBeacon.ts, which is
 * pure and has the combinations enumerated in a test. What is left here is the
 * wiring: a timer, two listeners and one fetch.
 */
export function RecordView({ token }: { token: string }) {
  const sent = useRef(false);

  useEffect(() => {
    // The crew's own check of the link they just made. Not a customer.
    if (isCrewLink(window.location.search)) return;
    // Guarded by a ref rather than by the effect's dependencies: React runs
    // effects twice in development's strict mode, and a count that reads 2 for
    // one visit is a small lie in the same direction as the big one.
    if (sent.current) return;

    const page = document as Document & { prerendering?: boolean };
    let timer = 0;

    const clear = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
    };

    const state = () => ({
      prerendering: Boolean(page.prerendering),
      visible: document.visibilityState === "visible",
      sent: sent.current,
      armed: timer !== 0,
    });

    const arm = () => {
      if (!shouldArm(state())) return;

      timer = window.setTimeout(() => {
        timer = 0;
        if (!shouldFire(state())) return;
        sent.current = true;

        // keepalive so the record survives a customer who reads the price and
        // immediately swipes back to their messages.
        void fetch(`/api/quote/${encodeURIComponent(token)}/viewed`, {
          method: "POST",
          keepalive: true,
        }).catch(() => {
          // Silent on purpose. The customer came here to read their quote, and
          // a missing stamp is a gap in the crew's bookkeeping, not something
          // to put an error on a stranger's screen about.
        });
      }, DWELL_MS);
    };

    // Hidden again before the dwell is up: the clock starts over next time
    // they look, so the three seconds are three seconds of someone actually
    // looking rather than three seconds of elapsed time.
    const onVisibility = () => (document.visibilityState === "visible" ? arm() : clear());

    arm();
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("prerenderingchange", arm);

    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("prerenderingchange", arm);
    };
  }, [token]);

  return null;
}
