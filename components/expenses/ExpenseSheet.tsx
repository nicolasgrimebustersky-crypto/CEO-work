"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import {
  createExpense,
  deleteExpense,
  newExpenseId,
  removeReceiptFile,
  updateExpense,
  uploadReceipt,
  type Expense,
} from "@/lib/db/expenses";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_HINT,
  EXPENSE_CATEGORY_LABEL,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  PROOF_LABEL,
  expenseProblem,
  localDate,
  parseAmount,
  type ExpenseCategory,
  type ExpenseFields,
  type PaymentMethod,
  type ProofKind,
  type ReceiptFile,
} from "@/lib/expenses";

/**
 * Adds or edits one expense.
 *
 * The receipt comes first on purpose: snapping it is the fastest way to log
 * an expense and the thing most often skipped. Without one, the expense has
 * to say what it rests on instead — a statement line, or only the word of
 * whoever logged it — and "confirmed in person" is the default because it
 * claims the least.
 */
export function ExpenseSheet({
  open,
  expense,
  assets,
  onClose,
}: {
  open: boolean;
  /** The expense to edit, or null for a new one. */
  expense: Expense | null;
  /** Things money has been spent "for" before, most used first. */
  assets: string[];
  onClose: () => void;
}) {
  const { author } = useTeam();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [id, setId] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("fuel");
  const [forWhat, setForWhat] = useState("");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(localDate());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [proof, setProof] = useState<ProofKind>("in_person");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<ReceiptFile | null>(null);
  /** A receipt uploaded in this sitting, removed again if the sheet is abandoned. */
  const [freshReceipt, setFreshReceipt] = useState<ReceiptFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setId(expense?.id ?? newExpenseId());
    setAmount(expense ? expense.amount.toFixed(2) : "");
    setCategory(expense?.category ?? "fuel");
    setForWhat(expense?.forWhat ?? "");
    setVendor(expense?.vendor ?? "");
    setDate(expense?.date ?? localDate());
    setPaymentMethod(expense?.paymentMethod ?? "card");
    setProof(expense?.proof ?? "in_person");
    setNotes(expense?.notes ?? "");
    setReceipt(expense?.receipt ?? null);
    setFreshReceipt(null);
    setConfirmDelete(false);
    setError(null);
  }, [open, expense]);

  const assetChoices = useMemo(() => {
    const list = [...assets];
    if (forWhat && !list.some((a) => a.toLowerCase() === forWhat.toLowerCase())) list.unshift(forWhat);
    return list;
  }, [assets, forWhat]);

  async function onFile(file: File | undefined) {
    if (!file || !id || !author) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadReceipt(expense?.createdBy || author?.uid || "", id, file);
      // Replacing a receipt uploaded in this same sitting: that one is nobody's.
      if (freshReceipt) void removeReceiptFile(freshReceipt);
      setReceipt(uploaded);
      setFreshReceipt(uploaded);
      setProof("receipt");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the receipt.");
    } finally {
      setUploading(false);
    }
  }

  function dropReceipt() {
    if (freshReceipt) void removeReceiptFile(freshReceipt);
    setFreshReceipt(null);
    setReceipt(null);
    setProof("in_person");
  }

  function close() {
    // Abandoning a new expense, or an edit, leaves no stray upload behind.
    if (freshReceipt) void removeReceiptFile(freshReceipt);
    onClose();
  }

  async function save() {
    if (!author) return;
    const parsed = parseAmount(amount);
    const fields: ExpenseFields = {
      date,
      amount: parsed ?? 0,
      category,
      vendor,
      forWhat,
      paymentMethod,
      proof: receipt ? "receipt" : proof === "receipt" ? "in_person" : proof,
      notes,
      receipt,
    };
    const problem = parsed === null ? "Enter how much it cost, like 42.50." : expenseProblem(fields);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (expense) await updateExpense(expense.id, fields, author);
      else await createExpense(id, fields, author);
      // The receipt this one replaced, if any, is no longer pointed at.
      if (expense?.receipt && expense.receipt.path !== receipt?.path) {
        void removeReceiptFile(expense.receipt);
      }
      setFreshReceipt(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the expense.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!expense) return;
    setSaving(true);
    try {
      if (freshReceipt) void removeReceiptFile(freshReceipt);
      await deleteExpense(expense);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the expense.");
    } finally {
      setSaving(false);
    }
  }

  const isPdf = receipt?.contentType === "application/pdf";

  return (
    <Sheet
      open={open}
      title={expense ? "Expense" : "Add an expense"}
      onClose={close}
      footer={
        <div className="flex gap-3">
          {expense ? (
            confirmDelete ? (
              <Button variant="danger" onClick={() => void remove()} disabled={saving}>
                Delete it
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmDelete(true)} disabled={saving}>
                Delete
              </Button>
            )
          ) : (
            <Button variant="secondary" onClick={close} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button full onClick={() => void save()} disabled={saving || uploading}>
            {saving ? "Saving…" : "Save expense"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* The receipt */}
        <div className="rounded-2xl border border-line bg-surface-2 p-3">
          <p className="text-sm font-bold tracking-wide text-muted uppercase">Receipt</p>
          {receipt ? (
            <div className="mt-2 flex items-center gap-3">
              <a href={receipt.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                {isPdf ? (
                  <span className="flex size-20 items-center justify-center rounded-xl border border-line bg-surface text-sm font-extrabold text-ink">
                    PDF
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={receipt.url}
                    alt="Receipt"
                    className="size-20 rounded-xl border border-line object-cover"
                  />
                )}
              </a>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-money">Receipt on file</p>
                <div className="mt-1.5 flex gap-2">
                  <Button variant="secondary" onClick={() => cameraInput.current?.click()} disabled={uploading}>
                    Retake
                  </Button>
                  <Button variant="ghost" onClick={dropReceipt} disabled={uploading}>
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-2 flex gap-2">
                <Button full onClick={() => cameraInput.current?.click()} disabled={uploading}>
                  {uploading ? "Uploading…" : "Scan receipt"}
                </Button>
                <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  From files
                </Button>
              </div>
              <p className="mt-2.5 text-sm font-semibold text-muted">No receipt? Say what proves it:</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {(["in_person", "statement"] as const).map((kind) => (
                  <Chip key={kind} active={proof === kind} onClick={() => setProof(kind)}>
                    {PROOF_LABEL[kind]}
                  </Chip>
                ))}
              </div>
            </>
          )}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        <TextField
          label="Amount"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">What kind</p>
          <div className="flex flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map((c) => (
              <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                {EXPENSE_CATEGORY_LABEL[c]}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-sm font-semibold text-muted">{EXPENSE_CATEGORY_HINT[category]}</p>
        </div>

        {category !== "tax_payment" ? (
          <div>
            <p className="mb-1.5 text-sm font-semibold text-muted">What it was for</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {assetChoices.map((asset) => (
                <Chip
                  key={asset}
                  active={forWhat.toLowerCase() === asset.toLowerCase()}
                  onClick={() => setForWhat(forWhat.toLowerCase() === asset.toLowerCase() ? "" : asset)}
                >
                  {asset}
                </Chip>
              ))}
            </div>
            <TextField
              label="Or type it"
              placeholder="Hot-water pressure washer, the F-150…"
              maxLength={80}
              value={forWhat}
              onChange={(e) => setForWhat(e.target.value)}
            />
          </div>
        ) : null}

        <TextField
          label={category === "tax_payment" ? "Paid to" : "Where"}
          placeholder={category === "tax_payment" ? "IRS, Kentucky DOR" : "Shell, Home Depot, the dealer…"}
          maxLength={120}
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />

        <TextField label="Date paid" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <div>
          <p className="mb-1.5 text-sm font-semibold text-muted">Paid with</p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <Chip key={m} active={paymentMethod === m} onClick={() => setPaymentMethod(m)}>
                {PAYMENT_METHOD_LABEL[m]}
              </Chip>
            ))}
          </div>
        </div>

        <TextAreaField
          label={receipt ? "Notes" : "Notes — who confirmed it, and how"}
          rows={2}
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {expense ? (
          <p className="text-sm font-semibold text-muted">
            Logged by {expense.createdByName}
            {expense.updatedByName && expense.updatedByName !== expense.createdByName
              ? ` · edited by ${expense.updatedByName}`
              : ""}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
