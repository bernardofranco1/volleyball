"use client";

import { useEffect, useId, useState } from "react";
import { IconClose } from "@/components/ui/icons";

/**
 * A create/edit surface that appears on demand instead of living permanently in
 * a 320px right rail.
 *
 * Every admin page used to reserve a column for an "Add …" form that was in use
 * for a few seconds a week; on the schedule page that rail plus the always-open
 * per-row edit forms are most of why the season needed ~5,000px of scroll. The
 * children are server-rendered and passed through, so the existing ActionForm
 * server actions drop in unchanged.
 */
export function Drawer({
  label,
  title,
  children,
  variant = "secondary",
  width = "md",
}: {
  /** Trigger button text. */
  label: React.ReactNode;
  /** Panel heading; defaults to the trigger label. */
  title?: React.ReactNode;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  width?: "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const trigger =
    variant === "primary"
      ? "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
      : "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-score-dim transition-colors hover:text-foreground";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={trigger}
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/50"
          />
          <div
            id={id}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            className={`relative flex h-dvh w-full flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl ${
              width === "lg" ? "sm:w-[36rem]" : "sm:w-[26rem]"
            }`}
          >
            <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
              <h2 className="text-sm font-semibold">{title ?? label}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-score-dim transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <IconClose size={16} />
              </button>
            </div>
            <div className="p-4">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
