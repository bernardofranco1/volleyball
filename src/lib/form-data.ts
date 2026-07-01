// Shared FormData parsing helpers for Server Actions. One definition instead of
// per-file copies (they had already started to drift).

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** A date input value, or null when blank. Drizzle `date` columns use string mode. */
export function dateOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v || null;
}

/** A positive integer, or null when blank/unparseable. */
export function intOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * A `datetime-local` value (`YYYY-MM-DDTHH:mm`, no zone) → Date, interpreted as
 * UTC (spec/14 §E2). The schedule UI labels and prefills times in UTC, so this
 * makes the round-trip exact regardless of the server's local timezone.
 */
export function dateTimeOrNull(fd: FormData, key: string): Date | null {
  const v = str(fd, key);
  if (!v) return null;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(v);
  const d = new Date(hasZone ? v : `${v}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A Date → `datetime-local` input value in UTC (inverse of dateTimeOrNull). */
export function toUtcInputValue(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 16);
}

/**
 * Tri-state select value → boolean override or null for "use discipline default".
 * Pairs with <select> options "" / "on" / "off".
 */
export function boolOrNull(fd: FormData, key: string): boolean | null {
  const v = str(fd, key);
  if (v === "on") return true;
  if (v === "off") return false;
  return null;
}
