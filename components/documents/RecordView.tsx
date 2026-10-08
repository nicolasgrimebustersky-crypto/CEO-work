"use client";

import { useEffect, useRef } from "react";

/**
 * Tells the server this link was actually opened by a person.
 *
 * Renders nothing. It exists to run one fetch after the page has hydrated,
 * which is the only part of this that carries any information: every messaging
 * app that shows a preview card — iMessage, WhatsApp, Messenger, Slack,
 * Outlook — fetches the URL the moment it is sent. A stamp written while the
 * page rendered on the server would therefore say "opened" about a text the
 * customer has not looked at yet, on essentially every estimate, and the crew
 * would chase decisions nobody had been asked to make. Preview fetchers do not
 * execute JavaScript; this does.
 *
 * Once per mount, guarded by a ref rather than by the effect's dependencies:
 * React runs effects twice in development's strict mode, and a count that
 * reads 2 for one visit is a small lie in the same direction as the big one.
 *
 * Failure is silent on purpose. The customer came here to read their quote,
 * and a missing stamp is a gap in the crew's bookkeeping, not something to put
 * an error on a stranger's screen about.
 */
export function RecordView({ token }: { token: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    // keepalive so the record survives a customer who opens the link and
    // immediately swipes back to their messages.
    void fetch(`/api/quote/${encodeURIComponent(token)}/viewed`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  }, [token]);

  return null;
}
