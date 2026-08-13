"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { FormState } from "@/lib/action-state";

const INIT: FormState = { error: null };

/**
 * Batch-edit form: inline edits across many rows accumulate into one sticky
 * "n unsaved changes" bar and commit together.
 *
 * The schedule page previously carried one <form> and one Save button per
 * match — 28 of each for a league season, 28 round trips, 28 audit entries to
 * reschedule a round. Here the whole table is one form; a hidden `dirtyIds`
 * field tells the action which rows actually changed so it still writes the
 * minimum.
 *
 * Dirtiness is measured against each control's `defaultValue`, so a field
 * edited and then typed back to its original value correctly stops counting.
 */
export function BatchEditForm({
  action,
  children,
  labelFor,
  strings,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  /**
   * Human label for a dirty control, used in the bar's summary line. Receives
   * the control's `data-row` and `data-field`.
   */
  labelFor?: (row: string, field: string) => string;
  strings: {
    unsaved: (n: number) => string;
    save: string;
    saving: string;
    discard: string;
    saved: string;
  };
}) {
  const [state, formAction, pending] = useActionState(action, INIT);
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState<{ row: string; field: string }[]>([]);

  // A completed save re-renders the rows from the server, so the new values
  // become the new defaults and nothing is dirty any more. Cleared via a task
  // rather than synchronously in the effect body (eslint react-hooks
  // set-state-in-effect), same pattern as ActionForm's auto-dismiss.
  useEffect(() => {
    if (!state.ok) return;
    const t = setTimeout(() => setDirty([]), 0);
    return () => clearTimeout(t);
  }, [state.ok, state.stamp]);

  const recompute = () => {
    const form = formRef.current;
    if (!form) return;
    const next: { row: string; field: string }[] = [];
    for (const el of Array.from(form.elements)) {
      if (
        !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)
      )
        continue;
      const row = el.dataset.row;
      const field = el.dataset.field;
      if (!row || !field) continue;
      // A <select> has no defaultValue; its baseline is the option the markup
      // marked selected.
      const changed =
        el instanceof HTMLSelectElement
          ? el.value !==
            (Array.from(el.options).find((o) => o.defaultSelected)?.value ??
              el.options[0]?.value ??
              "")
          : el.type === "checkbox"
            ? el.checked !== el.defaultChecked
            : el.value !== el.defaultValue;
      if (changed) next.push({ row, field });
    }
    setDirty(next);
  };

  const rows = Array.from(new Set(dirty.map((d) => d.row)));
  const summary = dirty
    .slice(0, 3)
    .map((d) => labelFor?.(d.row, d.field) ?? `${d.row} ${d.field}`)
    .join(" · ");

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={recompute}
      onChange={recompute}
    >
      {/* Lets the action write only what changed instead of every row. */}
      <input type="hidden" name="dirtyIds" value={rows.join(",")} />
      {children}

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      {dirty.length > 0 && (
        <div className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning bg-surface-3 px-4 py-2.5 shadow-lg">
          <b className="text-sm text-warning">{strings.unsaved(dirty.length)}</b>
          {summary && (
            <span className="min-w-0 truncate text-xs text-score-dim">
              {summary}
              {dirty.length > 3 ? " …" : ""}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => {
              formRef.current?.reset();
              setDirty([]);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-score-dim transition-colors hover:text-foreground"
          >
            {strings.discard}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? strings.saving : strings.save}
          </button>
        </div>
      )}

      {state.ok && dirty.length === 0 && (
        <p role="status" className="mt-3 text-sm text-success">
          {state.message ?? strings.saved} ✓
        </p>
      )}
    </form>
  );
}
