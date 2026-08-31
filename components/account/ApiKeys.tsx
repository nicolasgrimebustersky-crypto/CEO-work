"use client";

import { useEffect, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import {
  SCOPES,
  SCOPE_HINT,
  SCOPE_LABEL,
  labelProblem,
  type Scope,
} from "@/lib/apiKeys";
import {
  mintApiKey,
  revokeApiKey,
  saveApiKey,
  subscribeApiKeys,
  type ApiKeyRecord,
} from "@/lib/db/apiKeys";
import { friendlyError } from "@/lib/db/errors";
import { formatRelative } from "@/lib/format";

/**
 * Keys for anything that is not a person signing in.
 *
 * Admin only — hiding it is the courtesy, the Firestore rules are the
 * enforcement. Crew cannot even read this collection, because the list of keys
 * and their scopes is a map of what can reach the database.
 *
 * The key is shown exactly once. There is no way to read it back later, by
 * design: the plaintext is never stored, only its hash. A key that was not
 * written down is replaced, not recovered — the same rule Twilio applies to its
 * own, for the same reason.
 */
export function ApiKeys() {
  const { isAdmin, author } = useTeam();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [minted, setMinted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    return subscribeApiKeys(setKeys, (err) => setError(friendlyError(err, "API keys")));
  }, [isAdmin]);

  if (!isAdmin) return null;

  const problem = labelProblem(label) ?? (scopes.length === 0 ? "Pick at least one scope." : null);

  function toggleScope(scope: Scope) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
  }

  async function create() {
    if (problem || !author) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { key, hash, keyId, hint } = await mintApiKey();
      await saveApiKey({
        hash,
        keyId,
        hint,
        label,
        scopes,
        createdByName: author.displayName,
      });
      setMinted(key);
      setLabel("");
      setScopes(["read"]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that key.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await revokeApiKey(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke that key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-bold text-ink">API keys</h2>
      <p className="mb-3 text-sm font-semibold text-muted">
        For the Ops Agent, or anything else that connects without signing in.
        Point it at <span className="font-mono">/api/mcp</span>.
      </p>

      {/* Shown once, and never again. Everything about this block is arranged
          around that: it is loud, it explains itself, and it does not disappear
          on a stray tap. */}
      {minted ? (
        <div className="mb-4 rounded-2xl border border-money bg-money/10 p-3">
          <p className="text-base font-extrabold text-money">
            Copy this now — you will not see it again.
          </p>
          <p
            className="mt-2 rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-sm break-all text-ink"
            data-testid="new-api-key"
          >
            {minted}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(minted);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              onClick={() => {
                setMinted(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </div>
          <p className="mt-2 text-sm font-semibold text-muted">
            Only its hash is stored, so nobody — including you — can read it back.
            Lost keys get replaced, not recovered.
          </p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-line bg-surface-2 p-3">
        <TextField
          label="What is it for?"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Grime Busters Ops Agent"
        />

        <p className="mt-3 mb-1.5 text-sm font-semibold text-muted">What it can do</p>
        <div className="flex flex-col gap-2">
          {SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => toggleScope(scope)}
              aria-pressed={scopes.includes(scope)}
              className={`rounded-xl border p-2.5 text-left ${
                scopes.includes(scope)
                  ? scope === "send"
                    ? "border-danger bg-danger/15"
                    : "border-accent bg-accent/15"
                  : "border-line bg-surface"
              }`}
            >
              <span className="block text-base font-bold text-ink">
                {SCOPE_LABEL[scope]}
              </span>
              <span className="mt-0.5 block text-sm font-semibold text-muted">
                {SCOPE_HINT[scope]}
              </span>
            </button>
          ))}
        </div>

        {problem ? (
          <p className="mt-2 text-sm font-semibold text-muted">{problem}</p>
        ) : null}

        <Button full className="mt-3" onClick={() => void create()} disabled={busy || !!problem}>
          {busy ? "Creating…" : "Create key"}
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
        >
          {error}
        </p>
      ) : null}

      {keys.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {keys.map((key) => (
            <li
              key={key.id}
              className={`rounded-2xl border p-3 ${
                key.revokedAt ? "border-line bg-surface-2/50 opacity-60" : "border-line bg-surface-2"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-bold text-ink">
                    {key.label || "(unnamed)"}
                    {key.revokedAt ? " · revoked" : ""}
                  </p>
                  <p className="font-mono text-sm text-muted">{key.hint}…</p>
                  <p className="mt-0.5 text-sm font-semibold text-muted">
                    {key.scopes.map((scope) => SCOPE_LABEL[scope]).join(" · ") || "no scopes"}
                  </p>
                  {/* The line that makes an unexpectedly active key visible. */}
                  <p className="mt-0.5 text-sm font-semibold text-muted">
                    {key.lastUsedAt
                      ? `Last used ${formatRelative(key.lastUsedAt)}`
                      : "Never used"}
                  </p>
                </div>
                {key.revokedAt ? null : (
                  <Button variant="danger" onClick={() => void revoke(key.id)} disabled={busy}>
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm font-semibold text-muted">No keys yet.</p>
      )}
    </section>
  );
}
