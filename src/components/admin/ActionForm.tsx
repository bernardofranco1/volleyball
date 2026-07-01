"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { FormState } from "@/lib/action-state";

const INIT: FormState = { error: null };

/**
 * Standard wrapper for FormState server actions: renders inline error /
 * transient "Saved ✓" feedback under the form, optionally asks for
 * confirmation before destructive submits, and can reset fields on success.
 * Children stay server-rendered (passed through the client boundary as nodes).
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  resetOnOk = false,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  /** Ask before submitting (destructive actions). */
  confirm?: string;
  /** Clear the form after a successful submit (create-style forms). */
  resetOnOk?: boolean;
}) {
  const [state, formAction] = useActionState(action, INIT);
  const ref = useRef<HTMLFormElement>(null);
  // Success feedback is derived from state and auto-dismissed by stamping the
  // result we've already hidden (no synchronous setState inside the effect).
  const [dismissedStamp, setDismissedStamp] = useState<number | undefined>();

  useEffect(() => {
    if (!state.ok) return;
    if (resetOnOk) ref.current?.reset();
    const stamp = state.stamp;
    const t = setTimeout(() => setDismissedStamp(stamp), 4000);
    return () => clearTimeout(t);
  }, [state.ok, state.stamp, resetOnOk]);

  const okVisible = Boolean(state.ok) && state.stamp !== dismissedStamp;

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state.error && (
        <p role="alert" className="mt-2 w-full basis-full text-sm text-red-400">
          {state.error}
        </p>
      )}
      {okVisible && state.message && (
        <p
          role="status"
          className="mt-2 w-full basis-full text-sm text-emerald-400"
        >
          {state.message} ✓
        </p>
      )}
    </form>
  );
}
