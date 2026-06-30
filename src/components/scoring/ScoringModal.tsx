"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// Centered popup for scoring panels (subs, libero). Renders as a fixed overlay
// in the middle of the screen with a dismissable backdrop, so it never pushes
// the scoring UI around or forces scrolling on a phone. Portaled to <body> so a
// backdrop-filter/transform ancestor (e.g. the action bar) can't trap the fixed
// positioning and shift it off-centre.
export function ScoringModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-surface-raised p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded px-2 py-1 text-base leading-none text-score-dim hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="space-y-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
