"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { TextAreaField, TextField } from "@/components/ui/Field";
import {
  MAX_DESCRIPTION,
  MAX_PHOTOS,
  draftProblem,
  itemsTotal,
  subtotalForTotal,
  type PricedItem,
} from "@/lib/estimateDraft";
import {
  draftLineItems,
  preparePhotos,
  type DraftPhotoPayload,
} from "@/lib/estimateDraftClient";
import { formatMoneyExact } from "@/lib/format";
import type { ServiceType } from "@/lib/types";

/**
 * Describe the job, say what you're charging, get the lines written for you.
 *
 * The price field is above the description on purpose. It is the one input that
 * is not a draft — whatever is typed there is what the customer will be asked
 * to pay, and the lines are divided to add up to it exactly. Nothing the model
 * writes changes that number.
 *
 * The result lands in the builder, editable, and nothing is sent from here.
 * A drafted estimate that goes out unread is worse than one typed by hand.
 */
export function DraftEstimateSheet({
  open,
  serviceType,
  taxRatePct,
  discount,
  onClose,
  onDrafted,
}: {
  open: boolean;
  serviceType: ServiceType;
  /** The builder's own rate, so the lines are sized to land on the total. */
  taxRatePct: number;
  discount: number;
  onClose: () => void;
  onDrafted: (items: PricedItem[]) => void;
}) {
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [photos, setPhotos] = useState<DraftPhotoPayload[]>([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const total = Number.parseFloat(price.replace(/[^0-9.]/g, ""));
  const problem = draftProblem({
    description,
    total,
    serviceType,
    photoCount,
  });

  function reset() {
    setDescription("");
    setPrice("");
    setPhotos([]);
    setPhotoCount(0);
    setError(null);
  }

  async function onPickPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPreparing(true);
    setError(null);
    try {
      const picked = Array.from(files);
      setPhotoCount(picked.length);
      // Shrunk in the browser before anything leaves the phone. See
      // lib/estimateDraftClient.ts for why.
      setPhotos(await preparePhotos(picked));
    } catch {
      setError("Those photos couldn't be read. Try taking them again.");
      setPhotos([]);
      setPhotoCount(0);
    } finally {
      setPreparing(false);
    }
  }

  async function onDraft() {
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The model is asked to split the *subtotal*, not the total the operator
      // said. Tax is added by the builder afterwards and lands the document
      // exactly on the spoken number. See subtotalForTotal.
      const items = await draftLineItems({
        description,
        total: subtotalForTotal(total, taxRatePct, discount),
        serviceType,
        photos,
      });
      if (items.length === 0) {
        setError("Nothing usable came back. Try describing the job differently.");
        return;
      }
      onDrafted(items);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not draft this.");
    } finally {
      setBusy(false);
    }
  }

  const priced = Number.isFinite(total) && total > 0;

  return (
    <Sheet
      open={open}
      title="Draft the estimate"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button full onClick={() => void onDraft()} disabled={busy || preparing}>
            {busy ? "Writing…" : "Write the lines"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="What are you charging?"
          inputMode="decimal"
          placeholder="450"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          hint="What the customer pays, tax included. The lines are sized to land on it."
        />

        <TextAreaField
          label="What's the job?"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
          placeholder="Washed the driveway, the walkway and the back patio. Heavy algae on the north side, treated it twice."
        />
        <p className="-mt-2 text-sm font-semibold text-muted">
          Say it how you&rsquo;d say it out loud. Tap the mic on your keyboard if
          that&rsquo;s easier than typing.
        </p>

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">
            Photos {photos.length > 0 ? `· ${photos.length} ready` : "(optional)"}
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void onPickPhotos(e.target.files)}
          />
          <Button
            variant="secondary"
            full
            onClick={() => fileInput.current?.click()}
            disabled={preparing || busy}
          >
            {preparing ? "Shrinking…" : photos.length > 0 ? "Change photos" : "Add photos"}
          </Button>
          <p className="mt-1.5 text-sm font-semibold text-muted">
            Up to {MAX_PHOTOS}. They&rsquo;re shrunk on your phone before they&rsquo;re sent.
          </p>
        </div>

        {/* Shown before the button is pressed, not after it fails. The whole
            point is that somebody standing in a driveway can see what is
            missing without waiting for a round trip. */}
        {/* The number the customer pays, stated before the button is pressed.
            This used to promise the total and deliver the subtotal — the lines
            summed to $450 and the estimate came to $477 once Kentucky's 6% went
            on. Now the lines are sized so the document lands on the number. */}
        {priced && !problem ? (
          <p className="text-sm font-semibold text-money">
            The customer pays {formatMoneyExact(total)}
            {taxRatePct > 0
              ? ` — ${formatMoneyExact(subtotalForTotal(total, taxRatePct, discount))} of work plus ${taxRatePct}% tax.`
              : "."}
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/60 bg-danger/15 px-3 py-2.5 text-base font-semibold text-ink"
          >
            {error}
          </p>
        ) : null}

        <p className="text-sm font-semibold text-muted">
          It writes the wording. You check it before anything goes out.
        </p>
      </div>
    </Sheet>
  );
}

/** Exported for the tests that walk the built app. */
export function draftedTotal(items: PricedItem[]): number {
  return itemsTotal(items);
}
