"use client";

import { useRef, useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};
/** False during SSR/hydration, true after — avoids a server/client mismatch. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** `YYYY-MM-DDTHH:mm` in the viewer's zone, from a UTC instant. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Local wall-clock input value → the UTC value the server action parses. */
function toUtcInputValue(local: string): string {
  if (!local) return "";
  const d = new Date(local); // no zone suffix ⇒ parsed as local time
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16);
}

/**
 * Schedule time field that speaks the operator's local time.
 *
 * The old form was labelled "Time UTC" and left the human to do the conversion
 * for every row — which is exactly the arithmetic a computer should be doing,
 * and got it wrong twice in the LNA fixtures.
 *
 * Storage stays UTC and the server action is unchanged: the visible field is
 * local and uncontrolled (so batch dirty-detection compares against a real
 * defaultValue), while a hidden sibling carries the UTC value that is actually
 * submitted. The `key` flip remounts the visible field once with its local
 * default — the value can't be corrected in place without a controlled input.
 */
export function LocalDateTimeInput({
  name,
  utcValue,
  row,
  field = "time",
  className,
  ariaLabel,
}: {
  name: string;
  /** Current value as a UTC `YYYY-MM-DDTHH:mm`, or "" when unscheduled. */
  utcValue: string;
  /** Row id, for the batch bar's dirty tracking. */
  row: string;
  field?: string;
  className?: string;
  ariaLabel: string;
}) {
  const hydrated = useHydrated();
  const hidden = useRef<HTMLInputElement>(null);
  const shown = hydrated && utcValue ? toLocalInputValue(`${utcValue}Z`) : utcValue;

  return (
    <>
      <input
        key={hydrated ? "local" : "utc"}
        type="datetime-local"
        defaultValue={shown}
        aria-label={ariaLabel}
        data-row={row}
        data-field={field}
        onChange={(e) => {
          if (hidden.current)
            hidden.current.value = toUtcInputValue(e.target.value);
        }}
        className={className}
      />
      <input type="hidden" name={name} ref={hidden} defaultValue={utcValue} />
    </>
  );
}
