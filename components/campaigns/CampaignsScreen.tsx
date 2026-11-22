"use client";

import { format } from "date-fns";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useCustomers } from "@/components/providers/CustomersProvider";
import { useDocuments } from "@/components/providers/DocumentsProvider";
import { useTeam } from "@/components/providers/TeamProvider";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextAreaField } from "@/components/ui/Field";
import {
  CAMPAIGN_TEMPLATES,
  campaignAudience,
  campaignResults,
  inSeason,
  outcomeFor,
  type CampaignDocument,
  type CampaignJob,
  type CampaignTemplate,
  type Outcome,
  type AudienceScope,
  type ConsentMode,
  RELATIONSHIP_DAYS,
  inBatches,
} from "@/lib/campaigns";
import { recordCampaign, subscribeCampaigns, type SentCampaign } from "@/lib/db/campaigns";
import { fetchJobsBetween } from "@/lib/db/jobs";
import { customerName } from "@/lib/format";
import { automationSmsText } from "@/lib/messages";
import { isQuietHour, quietHoursLabel } from "@/lib/notifications/quietHours";
import { routes } from "@/lib/routes";
import { canSendTo } from "@/lib/smsConsent";
import { sendCampaign } from "@/lib/smsClient";
import { SERVICE_LABEL } from "@/lib/status";
import type { Customer, Job } from "@/lib/types";

const DAY_MS = 86_400_000;

const OUTCOME_LABEL: Record<Outcome, string> = {
  booked: "Booked",
  accepted: "Accepted",
  quoted: "Quoted",
  none: "No reply yet",
};

const WHY_LABEL = {
  no_consent: "No consent on file",
  cannot_text: "Can't be texted",
  has_it: "Already has it",
  do_not_knock: "Do not contact",
  no_phone: "No phone number",
  same_number: "Same number as another record",
} as const;

/**
 * Seasonal upsells (lib/campaigns.ts). The owner picks the season's offer,
 * sees exactly who it goes to and who is left out and why, edits the words,
 * and sends — through the group-text route, which on the server again
 * requires a recorded consent per person and refuses quiet hours. Results
 * follow on their own from estimates and jobs; the crew can open each
 * recipient to quote or book them.
 */
export function CampaignsScreen() {
  const { author, isAdmin } = useTeam();
  const { customers } = useCustomers();
  const { documents } = useDocuments();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [sent, setSent] = useState<SentCampaign[]>([]);
  const [open, setOpen] = useState<CampaignTemplate | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const now = Date.now();
  const month = new Date().getMonth() + 1;

  useEffect(() => {
    // Back past the 18-month relationship window (who is a recent customer,
    // who already had it) and a few months ahead (who already has it booked).
    fetchJobsBetween(new Date(now - (RELATIONSHIP_DAYS + 14) * DAY_MS), new Date(now + 150 * DAY_MS))
      .then(setJobs)
      .catch(() => setJobs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => subscribeCampaigns(setSent, () => setSent([])), []);

  const campaignJobs: CampaignJob[] = useMemo(
    () =>
      (jobs ?? []).map((j) => ({
        customerId: j.customerId,
        services: j.serviceTypes?.length ? j.serviceTypes : [j.serviceType],
        status: j.status,
        at: j.scheduledStart.toMillis(),
        createdAt: j.createdAt?.toMillis?.() ?? j.scheduledStart.toMillis(),
      })),
    [jobs],
  );
  const campaignDocs: CampaignDocument[] = useMemo(
    () =>
      documents.map((d) => ({
        customerId: d.customerId,
        kind: d.kind,
        status: d.status,
        services: d.serviceTypes?.length ? d.serviceTypes : [d.serviceType],
        createdAt: d.createdAt?.toMillis?.() ?? 0,
      })),
    [documents],
  );

  const seasonal = CAMPAIGN_TEMPLATES.filter((t) => inSeason(t, month));
  const others = CAMPAIGN_TEMPLATES.filter((t) => !inSeason(t, month));
  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Campaigns" subtitle="Seasonal offers to your own customers" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {note ? <p className="mb-3 text-sm font-semibold text-money">{note}</p> : null}

        {open ? (
          <CampaignComposer
            template={open}
            customers={customers}
            jobs={campaignJobs}
            documents={campaignDocs}
            loading={jobs === null}
            canSend={isAdmin}
            now={now}
            onCancel={() => setOpen(null)}
            onSent={async (recipients, excluded, message) => {
              if (author) {
                await recordCampaign(
                  { templateId: open.id, name: open.name, service: open.service, message, recipients, excluded },
                  author,
                );
              }
              setOpen(null);
              setNote(`Sent to ${recipients.length} customer${recipients.length === 1 ? "" : "s"}.`);
            }}
          />
        ) : (
          <>
            <TemplateList title="In season now" templates={seasonal} onPick={setOpen} />
            <TemplateList title="Other times of year" templates={others} onPick={setOpen} muted />
          </>
        )}

        <section className="mt-6">
          <h2 className="mb-2 text-lg font-bold text-ink">Sent</h2>
          {sent.length === 0 ? <p className="text-sm font-semibold text-muted">Nothing sent yet.</p> : null}
          <ul className="flex flex-col gap-3">
            {sent.map((c) => {
              const r = campaignResults(c.recipients, c.service, c.sentAt, campaignJobs, campaignDocs);
              return (
                <li key={c.id} className="rounded-2xl border border-line bg-surface-2 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-base font-bold text-ink">{c.name}</p>
                    <p className="text-sm font-semibold text-muted">{format(c.sentAt, "MMM d, yyyy")}</p>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {r.sent} sent · {r.quoted} quoted · {r.accepted} accepted · {r.booked} booked ·{" "}
                    <span className="text-money">{Math.round(r.rate * 100)}% won</span>
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-bold text-muted">Recipients</summary>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {c.recipients.map((id) => {
                        const customer = byId.get(id);
                        const outcome = outcomeFor(id, c.service, c.sentAt, campaignJobs, campaignDocs);
                        return (
                          <li key={id} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="min-w-0 flex-1 font-semibold text-ink">{customer ? customerName(customer) : "Removed customer"}</span>
                            <span className={`font-bold ${outcome === "none" ? "text-muted" : "text-money"}`}>{OUTCOME_LABEL[outcome]}</span>
                            {customer && outcome === "none" ? (
                              <>
                                <Link href={routes.newDocument("estimate", id)} className="font-bold text-accent">
                                  Estimate
                                </Link>
                                <Link href={routes.customer(id)} className="font-bold text-accent">
                                  Book
                                </Link>
                              </>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="mt-6 text-xs font-semibold text-muted">
          Campaigns go to your clients with a number on file — everyone who hasn&apos;t replied STOP, unless you
          choose a stricter setting. Never to a number that replied STOP, never to anyone marked do not contact, and
          never during quiet hours. Every text ends with &ldquo;Reply STOP to opt out.&rdquo; A reply comes to Messages like any other text. Results count
          estimates and jobs for the offered service within 60 days of sending.
        </p>
      </div>
    </div>
  );
}

function TemplateList({
  title,
  templates,
  onPick,
  muted = false,
}: {
  title: string;
  templates: readonly CampaignTemplate[];
  onPick: (t: CampaignTemplate) => void;
  muted?: boolean;
}) {
  if (templates.length === 0) return null;
  return (
    <section className="mb-5">
      <h2 className={`mb-2 text-lg font-bold ${muted ? "text-muted" : "text-ink"}`}>{title}</h2>
      <ul className="flex flex-col gap-2">
        {templates.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onPick(t)}
              className="w-full rounded-2xl border border-line bg-surface-2 p-3 text-left"
            >
              <p className="text-base font-bold text-ink">{t.name}</p>
              <p className="text-sm font-semibold text-muted">
                Offer: {SERVICE_LABEL[t.service as keyof typeof SERVICE_LABEL] ?? t.service} · to all your clients, or
                only those who&apos;ve had {t.from.map((s) => SERVICE_LABEL[s as keyof typeof SERVICE_LABEL] ?? s).join(" or ")}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CampaignComposer({
  template,
  customers,
  jobs,
  documents,
  loading,
  canSend,
  now,
  onCancel,
  onSent,
}: {
  template: CampaignTemplate;
  customers: readonly Customer[];
  jobs: readonly CampaignJob[];
  documents: readonly CampaignDocument[];
  loading: boolean;
  canSend: boolean;
  now: number;
  onCancel: () => void;
  onSent: (recipients: string[], excluded: number, message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState(template.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ name: string; error: string }[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  // Every client by default; narrowing to past buyers of the "from"
  // services is the owner's choice, not a silent filter.
  const [scope, setScope] = useState<AudienceScope>("all_clients");
  // Every client who hasn't said STOP, by default — the owner's decision.
  // The two stricter settings are a tap away.
  const [mode, setMode] = useState<ConsentMode>("everyone");
  const quiet = isQuietHour(new Date());

  const audience = useMemo(
    () => campaignAudience(template, customers, jobs, documents, now, canSendTo, scope, mode),
    [template, customers, jobs, documents, now, scope, mode],
  );
  const fromLabel = template.from.map((s) => SERVICE_LABEL[s as keyof typeof SERVICE_LABEL] ?? s).join(", ");
  const text = automationSmsText(message, { business: "Solid Acre" } as Parameters<typeof automationSmsText>[1]);
  const grouped = useMemo(() => {
    const g = new Map<string, Customer[]>();
    for (const e of audience.excluded) g.set(e.why, [...(g.get(e.why) ?? []), e.customer]);
    return g;
  }, [audience]);

  async function send() {
    setBusy(true);
    setError(null);
    setProgress(null);
    const ids = audience.eligible.map((c) => c.id);
    const texted: string[] = [];
    const problems: { name: string; error: string }[] = [];
    let stoppedEarly: string | null = null;
    // In batches, one after another: each request must finish inside the
    // server's 60 s, and a batch that fails stops the rest rather than
    // leaving the owner unsure who got what.
    for (const batch of inBatches(ids)) {
      setProgress(`Sending… ${texted.length + problems.length} of ${ids.length}`);
      try {
        const result = await sendCampaign(batch, text, mode);
        const failedIds = new Set(result.failed.map((f) => f.customerId));
        problems.push(...result.failed.map((f) => ({ name: f.name, error: f.error })));
        texted.push(...batch.filter((id) => !failedIds.has(id)));
      } catch (err) {
        stoppedEarly = err instanceof Error ? err.message : "The campaign stopped.";
        break;
      }
    }
    setFailed(problems);
    setProgress(null);
    try {
      // Recorded even when it stopped part-way, so the Sent list shows who
      // did get it and nobody is texted twice by sending again blind.
      if (texted.length > 0) await onSent(texted, audience.excluded.length + problems.length, text);
    } catch {
      // The texts went; only the record of them didn't.
    }
    if (stoppedEarly) {
      setError(
        `${stoppedEarly} ${texted.length} of ${ids.length} were texted before it stopped — they're in Sent below.`,
      );
    } else if (texted.length === 0) {
      setError("Nobody was texted.");
    }
    setBusy(false);
  }

  return (
    <section className="mb-6 flex flex-col gap-3 rounded-2xl border border-accent/60 bg-accent/5 p-3">
      <h2 className="text-lg font-bold text-ink">{template.name}</h2>
      <TextAreaField label="Message" rows={4} maxLength={480} value={message} onChange={(e) => setMessage(e.target.value)} />
      <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
        <p className="text-xs font-bold text-muted">What they&apos;ll get</p>
        <p className="mt-1 font-semibold text-ink">{text}</p>
      </div>

      {loading ? (
        <p className="text-sm font-semibold text-muted">Working out who it goes to…</p>
      ) : (
        <div className="text-sm">
          <div className="mb-2 flex flex-wrap gap-2">
            <Chip active={scope === "all_clients"} onClick={() => setScope("all_clients")}>
              All clients
            </Chip>
            <Chip active={scope === "past_service"} onClick={() => setScope("past_service")}>
              Past {fromLabel} clients
            </Chip>
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Chip active={mode === "everyone"} onClick={() => setMode("everyone")}>
              Everyone who hasn&apos;t said STOP
            </Chip>
            <Chip active={mode === "relationship"} onClick={() => setMode("relationship")}>
              Said yes, or a job in the last 18 months
            </Chip>
            <Chip active={mode === "recorded"} onClick={() => setMode("recorded")}>
              Only clients who said yes
            </Chip>
          </div>
          <p className="font-bold text-ink">
            Goes to {audience.eligible.length} customer{audience.eligible.length === 1 ? "" : "s"}
          </p>
          {scope === "past_service" && audience.outOfScope > 0 ? (
            <p className="mt-1 font-semibold text-muted">
              {audience.outOfScope} other client{audience.outOfScope === 1 ? " hasn't" : "s haven't"} had {fromLabel}.
              Choose &ldquo;All clients&rdquo; to include them.
            </p>
          ) : null}
          {audience.eligible.length > 0 ? (
            <p className="text-muted">{audience.eligible.slice(0, 12).map(customerName).join(", ")}{audience.eligible.length > 12 ? "…" : ""}</p>
          ) : null}
          {[...grouped.entries()].map(([why, list]) => (
            <details key={why} className="mt-2">
              <summary className="cursor-pointer font-bold text-muted">
                Left out — {WHY_LABEL[why as keyof typeof WHY_LABEL]} ({list.length})
              </summary>
              {why === "no_consent" ? (
                <>
                  <p className="mt-1 text-xs font-semibold text-warn">
                    {mode === "relationship"
                      ? "No yes on file and no job finished in the last 18 months. Ask them, then record their yes (spoken or written) on their record — tap a name."
                      : "Ask each one if they'd like texts from you, then record their yes (spoken or written) on their record — tap a name. They're included from then on."}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {list.map((c) => (
                      <li key={c.id}>
                        <Link href={routes.customer(c.id)} className="font-semibold text-accent underline underline-offset-2">
                          {customerName(c)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-1 text-muted">{list.map(customerName).join(", ")}</p>
              )}
            </details>
          ))}
        </div>
      )}

      {failed.length > 0 ? (
        <ul className="text-xs font-semibold text-danger">
          {failed.map((f, i) => (
            <li key={i}>
              {f.name}: {f.error}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm font-semibold text-danger">{error}</p> : null}
      {!canSend ? <p className="text-sm font-semibold text-muted">Only the owner can send a campaign.</p> : null}
      {quiet ? <p className="text-sm font-semibold text-warn">It&apos;s quiet hours ({quietHoursLabel()}). Send in the morning.</p> : null}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Back
        </Button>
        <Button
          full
          onClick={() => void send()}
          disabled={busy || loading || !canSend || quiet || audience.eligible.length === 0 || !message.trim()}
        >
          {busy ? (progress ?? "Sending…") : `Send to ${audience.eligible.length}`}
        </Button>
      </div>
    </section>
  );
}
