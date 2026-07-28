"use client";

import { useEffect, type ReactNode } from "react";

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Rendered pinned to the bottom, inside the safe area. */
  footer?: ReactNode;
}

/**
 * Bottom sheet rather than a centred modal: the whole app is used one-handed
 * in portrait, so content and actions have to sit in the lower half of the
 * screen where a thumb reaches.
 */
export function Sheet({ open, title, onClose, children, footer }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[88vh] flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl"
        style={{ animation: "gb-sheet-in 180ms ease-out" }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-target -mr-2 flex items-center justify-center rounded-xl px-3 text-2xl leading-none text-muted hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <div className="pb-safe border-t border-line px-4 pt-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
