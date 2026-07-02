"use client";

// Escape hatch from the lineup-confirmation step: a set started by mistake
// used to trap the scorer (no Undo is reachable during LINEUP_PENDING).
// After a confirmation, this unwinds the whole set setup — every
// LINEUP_CONFIRMED recorded so far AND the SET_START — by dispatching one
// UNDO per scorer event (the server undoes the latest scorer event each
// time; posts are serialized by the provider).
import { useT } from "@/lib/i18n/client";

export function CancelSetStart({
  setNumber,
  undoCount,
  dispatch,
  pending,
}: {
  setNumber: number;
  /** LINEUP_CONFIRMED events recorded this set + 1 for the SET_START. */
  undoCount: number;
  dispatch: (payload: { type: "UNDO"; targetEventId: string }) => void;
  pending: boolean;
}) {
  const t = useT();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(t("scoring.cancelSetStartConfirm", { set: setNumber })))
          return;
        for (let i = 0; i < undoCount; i++)
          dispatch({ type: "UNDO", targetEventId: "" });
      }}
      className="mt-3 w-full rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
    >
      {t("scoring.cancelSetStart")}
    </button>
  );
}
