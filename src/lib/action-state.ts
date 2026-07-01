// Shared result shape for form Server Actions used with React `useActionState`.
// `error` non-null renders an inline message. Actions that stay on the page
// return `ok()` so forms can show a success note and reset; `stamp` changes on
// every result so effects can key off it without comparing object identity.
export interface FormState {
  error: string | null;
  ok?: boolean;
  message?: string;
  stamp?: number;
}

export const OK: FormState = { error: null };

export function ok(message?: string): FormState {
  return { error: null, ok: true, message, stamp: Date.now() };
}

export function fail(message: string): FormState {
  return { error: message, stamp: Date.now() };
}

/** Result shape for CSV import actions: a row tally plus per-row error notes. */
export interface ImportState {
  error: string | null;
  summary?: { ok: number; errors: number; messages: string[] };
}

export const IMPORT_INIT: ImportState = { error: null };
