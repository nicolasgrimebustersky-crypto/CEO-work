"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useJobs } from "@/components/providers/JobsProvider";
import { useKnockRoutes } from "@/components/providers/KnockRoutesProvider";
import { useServices } from "@/components/providers/ServicesProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { KIND_LABEL, groupHits, search } from "@/lib/search";
import { buildSearchIndex } from "@/lib/searchRecords";

const INPUT =
  "tap-target w-full rounded-2xl border border-line bg-surface-2 px-3 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

/**
 * One box for the whole CRM.
 *
 * Everything it searches is already in memory: the five providers above are
 * mounted app-wide and hold the customers, documents, jobs, price book and
 * routes the rest of the app renders from. So this adds no reads, no indexes
 * and no cost per keystroke beyond the comparison itself — and it keeps
 * working on a van with no signal, which is where somebody is most likely to
 * be hunting for a phone number.
 *
 * The index is built once per data change rather than per keystroke, with the
 * text already lowercased and unpunctuated. Searching then compares
 * prepared strings, which is what makes it keep up with a thumb.
 *
 * Deliberately not debounced. A debounce buys nothing when the work is a few
 * thousand string comparisons, and it costs the thing that makes a search feel
 * like a search — the list moving while you type.
 */
export function SearchScreen() {
  const { customers } = useCustomers();
  const { documents } = useDocuments();
  const { jobs } = useJobs();
  const { services } = useServices();
  const { routes: knockRoutes } = useKnockRoutes();

  const [query, setQuery] = useState("");
  const box = useRef<HTMLInputElement | null>(null);

  // Focused on arrival: nobody opens this screen to look at it.
  useEffect(() => {
    box.current?.focus();
  }, []);

  const index = useMemo(
    () =>
      buildSearchIndex({ customers, documents, jobs, services, knockRoutes }),
    [customers, documents, jobs, services, knockRoutes],
  );

  const groups = useMemo(() => groupHits(search(index, query)), [index, query]);
  const found = groups.reduce((total, group) => total + group.hits.length, 0);
  const asked = query.trim() !== "";

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Search" subtitle="Everything in one box">
        <input
          ref={box}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Name, number, address, estimate, price…"
          aria-label="Search everything"
          className={`${INPUT} mt-3`}
        />
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          {!asked ? (
            <div className="text-base font-semibold text-muted">
              <p>Search {index.length} records across the whole app.</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                <li>
                  A phone number, typed however you like — 5025550199 or (502)
                  555-0199.
                </li>
                <li>Part of a name. &ldquo;Rey&rdquo; finds Reyes.</li>
                <li>
                  A street, a city, an estimate number, or an amount like 450.
                </li>
                <li>Something you wrote in a note months ago.</li>
                <li>Spelling it wrong is fine.</li>
              </ul>
            </div>
          ) : found === 0 ? (
            <p className="text-base font-semibold text-muted">
              Nothing matches &ldquo;{query.trim()}&rdquo;. Every word has to
              match something — try dropping one.
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold text-muted">
                {found} {found === 1 ? "result" : "results"}
              </p>

              {groups.map((group) => (
                <section key={group.kind} className="mt-4">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
                    {KIND_LABEL[group.kind]}
                  </h2>
                  <ul className="mt-2 space-y-2">
                    {group.hits.map((hit) => (
                      <li key={`${hit.record.kind}:${hit.record.id}`}>
                        <Link
                          href={hit.record.href}
                          className="tap-target block rounded-2xl border border-line bg-surface-2 px-3.5 py-3 transition active:brightness-110"
                        >
                          <p className="text-base font-bold text-ink">
                            {hit.record.title}
                          </p>
                          {hit.record.subtitle ? (
                            <p className="mt-0.5 text-sm font-semibold text-muted">
                              {hit.record.subtitle}
                            </p>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
