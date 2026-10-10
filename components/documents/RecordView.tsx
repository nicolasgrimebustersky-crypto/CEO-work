"use client";

import { useEffect, useRef } from "react";

/**
 * How long the page must be open, and visible, before it counts as read.
 *
 * Long enough that a machine fetching the URL to decide whether it is
 * dangerous has usually finished and moved on, short enough that a customer
 * glancing at a price and closing the tab still counts. Corporate mail
 * scanners — Microsoft Defender Safe Links, Proofpoint, Mimecast — do render
 * pages with a real browser and would otherwise look exactly like a reader.
 */
const DWELL_MS = 3000;

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
 *   browser prerender and speculative loads (skipped outright below), and
 *   security scanners that detonate a URL headlessly, which the dwell is
 *   aimed at.
 *
 *   NOT stopped — anything that renders the page, waits, and reports itself as
 *   visible. Apple's rich link preview is the one worth naming: it is not
 *   documented as script-free, and iMessage is the channel this business texts
 *   from. If a quote ever reads Opened seconds after it was sent, that is the
 *   first thing to suspect.
 *
 * `?crew=1` suppresses it entirely, which is what the "Open it yourself to
 * check" link in the CRM carries — the crew checking their own link is
 * otherwise the likeliest false stamp in the app.
 */
export function RecordView({ token }: { token: string }) {
  const sent = useRef(false);

  useEffect(() => {
    // The crew's own check of the link they just made. Not a customer.
    if (new URLSearchParams(window.location.search).has("crew")) return;

    // A speculative load the reader has not chosen to make. The browser tells
    // us outright, so there is no need to guess.
    const prerendering = (document as Document & { prerendering?: boolean }).prerendering;
    if (prerendering) return;

    // Guarded by a ref rather than by the effect's dependencies: React runs
    // effects twice in development's strict mode, and a count that reads 2 for
    // one visit is a small lie in the same direction as the big one.
    if (sent.current) return;

    const timer = window.setTimeout(() => {
      // Checked when the timer fires, not when it was set: a tab opened in the
      // background and never looked at is not a read quote.
      if (document.visibilityState !== "visible") return;
      if (sent.current) return;
      sent.current = true;

      // keepalive so the record survives a customer who reads the price and
      // immediately swipes back to their messages.
      void fetch(`/api/quote/${encodeURIComponent(token)}/viewed`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {
        // Silent on purpose. The customer came here to read their quote, and a
        // missing stamp is a gap in the crew's bookkeeping, not something to
        // put an error on a stranger's screen about.
      });
    }, DWELL_MS);

    return () => window.clearTimeout(timer);
  }, [token]);

  return null;
}
