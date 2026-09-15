"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDocuments } from "@/components/providers/DocumentsProvider";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { useOpenMenu } from "@/components/shell/menu";
import { MenuIcon } from "@/components/shell/navIcons";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import {
  balanceDueIn,
  compactMoney,
  documentsIn,
  formatChange,
  pendingIn,
  periodCards,
  type PeriodCard,
} from "@/lib/documentPeriods";
import { isOutstanding, type BusinessDocument, type DocumentKind } from "@/lib/documents";
import { formatMoneyExact } from "@/lib/format";
import { routes } from "@/lib/routes";
import { CustomerPickerSheet } from "./CustomerPickerSheet";
import { StatusPill } from "./StatusPill";

/**
 * Estimates and invoices, one kind at a time, one period at a time.
 *
 * The layout is the one the owner used for years before this app existed: a
 * row of month cards across the top, each with its total and an arrow against
 * the month before; the selected month's figure written out large under them;
 * then that month's documents, and one big button to raise the next one. The
 * same screen serves invoices and estimates, switched at the top, because
 * they are the same document at two points in its life and share a number
 * sequence — two tabs would be two lists of the same things.
 *
 * Every figure comes from lib/documentPeriods.ts, which is tested; this file
 * only decides what to draw.
 */

type Filter = "all" | "open" | "settled" | "draft" | "closed";

const FILTERS: Record<DocumentKind, Array<{ value: Filter; label: string }>> = {
  invoice: [
    { value: "all", label: "Everything" },
    { value: "open", label: "Still owed" },
    { value: "settled", label: "Paid" },
    { value: "draft", label: "Drafts" },
    { value: "closed", label: "Void" },
  ],
  estimate: [
    { value: "all", label: "Everything" },
    { value: "open", label: "Waiting on the customer" },
    { value: "settled", label: "Accepted" },
    { value: "draft", label: "Drafts" },
    { value: "closed", label: "Declined or void" },
  ],
};

function passesFilter(document: BusinessDocument, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return document.status !== "void";
    case "open":
      return document.kind === "invoice"
        ? isOutstanding(document)
        : document.status === "sent";
    case "settled":
      return document.status === (document.kind === "invoice" ? "paid" : "accepted");
    case "draft":
      return document.status === "draft";
    case "closed":
      return document.status === "void" || document.status === "declined";
  }
}

export function InvoicesScreen() {
  const { documents, loading, error } = useDocuments();
  const router = useRouter();
  const openMenu = useOpenMenu();

  const [kind, setKind] = useState<DocumentKind>("invoice");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [filtering, setFiltering] = useState(false);
  const [picking, setPicking] = useState(false);

  const cards = useMemo(() => periodCards(documents, kind), [documents, kind]);

  // Land on the current month — the second-to-last card, ahead of the year.
  const thisMonthKey = cards.length >= 2 ? cards[cards.length - 2].period.key : null;
  const selected: PeriodCard | undefined =
    cards.find((card) => card.period.key === selectedKey) ??
    cards.find((card) => card.period.key === thisMonthKey);
  const selectedIndex = selected ? cards.indexOf(selected) : -1;

  const visible = useMemo(() => {
    if (!selected) return [];
    const needle = term.trim().toLowerCase();
    return documentsIn(documents, selected.period, kind)
      .concat(
        // "Void" is excluded from every period total, so it has to be let back
        // in for the one filter that asks for it.
        filter === "closed"
          ? documents.filter(
              (d) =>
                d.kind === kind &&
                d.status === "void" &&
                d.issuedAt !== null &&
                d.issuedAt.toMillis() >= selected.period.startMs &&
                d.issuedAt.toMillis() < selected.period.endMs,
            )
          : [],
      )
      .filter((document) => passesFilter(document, filter))
      .filter((document) => {
        if (!needle) return true;
        return `${document.customerName} ${document.number}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => (b.issuedAt?.toMillis() ?? 0) - (a.issuedAt?.toMillis() ?? 0));
  }, [documents, selected, kind, filter, term]);

  const subline = selected
    ? kind === "invoice"
      ? { label: "Balance due", value: balanceDueIn(documents, selected.period) }
      : { label: "Waiting on a yes", value: pendingIn(documents, selected.period) }
    : null;

  const title = kind === "invoice" ? "Invoices" : "Estimates";
  const filterLabel = FILTERS[kind].find((f) => f.value === filter)?.label ?? "Everything";

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-canvas">
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-[46vh] transition-colors duration-500 ${
          kind === "invoice" ? "gb-money-glow-accent" : "gb-money-glow-money"
        }`}
      />

      {/* ------------------------------------------------------------ top */}
      <header className="pt-safe relative z-10 shrink-0 px-4 pb-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[2rem] leading-none font-extrabold tracking-tight text-ink">
            {title}
          </h1>
          <div className="flex items-center gap-2">
            <RoundButton
              label={searching ? "Hide search" : "Search"}
              pressed={searching}
              onClick={() => {
                setSearching((open) => !open);
                setTerm("");
              }}
            >
              <SearchIcon />
            </RoundButton>
            <NotificationBell />
            {openMenu ? (
              <RoundButton label="Open menu" onClick={openMenu}>
                <MenuIcon />
              </RoundButton>
            ) : null}
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Document kind"
          className="mt-2.5 grid grid-cols-2 rounded-full border border-line bg-surface-2 p-1"
        >
          {(["invoice", "estimate"] as const).map((option) => {
            const active = kind === option;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setKind(option);
                  setSelectedKey(null);
                  setFilter("all");
                }}
                className={`tap-target rounded-full px-3 py-2 text-sm font-bold transition ${
                  active ? "bg-ink text-canvas shadow" : "text-muted hover:text-ink"
                }`}
              >
                {option === "invoice" ? "Invoices" : "Estimates"}
              </button>
            );
          })}
        </div>

        {searching ? (
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Name or number"
            aria-label={`Search ${title.toLowerCase()}`}
            className="tap-target mt-3 w-full rounded-full border border-line bg-surface-2 px-4 py-3 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
        ) : null}
      </header>

      {/* --------------------------------------------------------- scroll */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col pb-32">
          {/* Period bar */}
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="mx-auto mt-1 flex items-center gap-3 rounded-full py-1 pr-4 pl-1 text-ink"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink ring-1 ring-line">
              <ChevronIcon up={expanded} />
            </span>
            <span className="text-xl font-bold tracking-tight">
              {selected?.period.heading ?? title}
            </span>
          </button>

          {expanded ? (
            <>
              <PeriodRow
                cards={cards}
                selectedIndex={selectedIndex}
                onSelect={(card) => setSelectedKey(card.period.key)}
              />

              <div className="mt-4 px-4 text-center">
                <p className="text-[2.6rem] leading-none font-extrabold tracking-tight text-ink tabular-nums sm:text-6xl">
                  {formatMoneyExact(selected?.total ?? 0)}
                </p>
                {subline ? (
                  <p className="mt-2 text-base font-semibold text-muted">
                    {subline.label}:{" "}
                    <span
                      className={`font-extrabold tabular-nums ${
                        subline.value > 0 ? "text-warn" : "text-money"
                      }`}
                    >
                      {formatMoneyExact(subline.value)}
                    </span>
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {/* Tool row: dots between two round buttons */}
          <div className="mt-4 flex items-center justify-between px-4">
            <span className="flex size-12 items-center justify-center rounded-full border border-line bg-surface-2/80 text-sm font-extrabold text-ink tabular-nums backdrop-blur">
              {visible.length}
              <span className="sr-only">
                {" "}
                {visible.length === 1 ? title.slice(0, -1) : title} in{" "}
                {selected?.period.heading ?? "this period"}
              </span>
            </span>

            <Dots count={cards.length} active={selectedIndex} />

            <RoundButton
              label={`Filter: ${filterLabel}`}
              pressed={filter !== "all"}
              onClick={() => setFiltering(true)}
            >
              <FilterIcon />
              {filter !== "all" ? (
                <span
                  aria-hidden
                  className="absolute top-2 right-2 size-2 rounded-full bg-accent"
                />
              ) : null}
            </RoundButton>
          </div>

          {/* The list */}
          <div className="mt-3 px-4">
            {error ? (
              <p
                role="alert"
                className="rounded-2xl border border-danger/60 bg-danger/15 px-4 py-3 text-base font-semibold text-ink"
              >
                {error}
              </p>
            ) : loading ? (
              <div className="flex justify-center py-10">
                <Spinner label="Loading…" />
              </div>
            ) : visible.length === 0 ? (
              <p className="rounded-3xl border border-line bg-surface px-4 py-8 text-center text-base font-semibold text-muted">
                {term
                  ? "Nothing matches that."
                  : filter !== "all"
                    ? `No ${title.toLowerCase()} match “${filterLabel}” here.`
                    : kind === "invoice"
                      ? `No invoices in ${selected?.period.heading ?? "this period"}.`
                      : `No estimates in ${selected?.period.heading ?? "this period"}.`}
              </p>
            ) : (
              <ul className="overflow-hidden rounded-3xl border border-line bg-surface">
                {visible.map((document) => (
                  <li key={document.id} className="border-b border-line last:border-b-0">
                    <DocumentRow
                      document={document}
                      onOpen={() => router.push(routes.document(document.id))}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ CTA */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-canvas via-canvas/90 to-transparent px-4 pt-8 pb-3">
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={() => setPicking(true)}
            className={`pointer-events-auto flex h-14 w-full items-center justify-center gap-3 rounded-full text-lg font-extrabold tracking-wide uppercase transition hover:brightness-110 active:brightness-95 ${
              kind === "invoice"
                ? "gb-cta-accent text-accent-ink"
                : "gb-cta-money text-money-ink"
            }`}
          >
            <span className="text-2xl leading-none font-bold">+</span>
            {kind === "invoice" ? "Create invoice" : "Create estimate"}
          </button>
        </div>
      </div>

      <Sheet open={filtering} title={`Show ${title.toLowerCase()}`} onClose={() => setFiltering(false)}>
        <ul className="flex flex-col gap-2">
          {FILTERS[kind].map((option) => {
            const active = filter === option.value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setFilter(option.value);
                    setFiltering(false);
                  }}
                  className={`tap-target flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-base font-bold ${
                    active
                      ? "border-accent bg-accent/15 text-ink"
                      : "border-line bg-surface-2 text-ink active:bg-surface-3"
                  }`}
                >
                  {option.label}
                  {active ? <span aria-hidden className="text-accent">✓</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <CustomerPickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(customerId) => {
          setPicking(false);
          router.push(routes.newDocument(kind, customerId));
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function PeriodRow({
  cards,
  selectedIndex,
  onSelect,
}: {
  cards: PeriodCard[];
  selectedIndex: number;
  onSelect: (card: PeriodCard) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Bring the selected card into view — on arrival, and whenever the
  // selection moves. `inline` only: a vertical `scrollIntoView` here would
  // yank the whole screen when the list below is long.
  useEffect(() => {
    const el = scroller.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  return (
    <div
      ref={scroller}
      className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {cards.map((card, index) => {
        const active = index === selectedIndex;
        const up = card.changePct !== null && card.changePct >= 0;
        return (
          <button
            key={card.period.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(card)}
            className={`flex w-[9.75rem] shrink-0 snap-center flex-col items-start rounded-3xl px-4 py-3.5 text-left transition sm:w-44 ${
              active
                ? "bg-ink text-canvas shadow-[0_12px_32px_-12px_rgba(255,255,255,0.35)]"
                : "border border-line bg-surface-2/80 text-ink backdrop-blur hover:bg-surface-3"
            }`}
          >
            <span className={`text-base font-bold ${active ? "text-canvas/80" : "text-muted"}`}>
              {card.period.label}
            </span>
            <span className="mt-1.5 text-[1.7rem] leading-none font-extrabold tracking-tight tabular-nums">
              {compactMoney(card.total)}
            </span>
            <span
              className={`mt-2 inline-flex items-center gap-1 text-sm font-bold tabular-nums ${
                card.changePct === null
                  ? active
                    ? "text-canvas/60"
                    : "text-muted"
                  : up
                    ? active
                      ? "text-[#0a7a35]"
                      : "text-money"
                    : active
                      ? "text-[#b81e1e]"
                      : "text-danger"
              }`}
            >
              {card.changePct === null ? null : <ArrowIcon up={up} />}
              {formatChange(card.changePct)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Dots({ count, active }: { count: number; active: number }) {
  return (
    <div aria-hidden className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={`rounded-full transition-all ${
            index === active ? "size-2.5 bg-accent" : "size-1.5 bg-muted/40"
          }`}
        />
      ))}
    </div>
  );
}

function DocumentRow({
  document,
  onOpen,
}: {
  document: BusinessDocument;
  onOpen: () => void;
}) {
  const invoice = document.kind === "invoice";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left active:bg-surface-2"
    >
      <span
        className={`flex size-12 shrink-0 items-center justify-center rounded-full ${
          invoice ? "bg-money/15 text-money" : "bg-warn/15 text-warn"
        }`}
      >
        {invoice ? <InvoiceGlyph /> : <EstimateGlyph />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg leading-tight font-bold text-ink">
          {document.customerName || "Unknown customer"}
        </span>
        <span className="mt-0.5 block text-sm font-semibold text-muted">
          {invoice ? "Invoice" : "EST"}
          {invoice ? " " : ""}
          {document.number}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-lg leading-tight font-extrabold text-ink tabular-nums">
          {formatMoneyExact(document.total)}
        </span>
        <StatusPill status={document.status} />
      </span>
    </button>
  );
}

function RoundButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={`tap-target relative flex size-12 items-center justify-center rounded-full border transition ${
        pressed
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-line bg-surface-2/80 text-ink backdrop-blur hover:bg-surface-3"
      }`}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- glyphs */

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth={2.2} />
      <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M4 7h16M7 12h10M10 17h4"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-5 transition-transform ${up ? "" : "rotate-180"}`}
      aria-hidden="true"
    >
      <path
        d="m6 14.5 6-6 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3.5 ${up ? "" : "rotate-180"}`}
      aria-hidden="true"
    >
      <path
        d="M12 19V5m0 0-6 6m6-6 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InvoiceGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <path
        d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21V3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path d="M10 8h4M10 12h4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function EstimateGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
      <rect
        x="5"
        y="3"
        width="14"
        height="18"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      />
      <path
        d="M8.5 8h7M8.5 12h3M8.5 16h3M14 12h2M14 16h2"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
