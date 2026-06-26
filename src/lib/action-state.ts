// Shared result shape for form Server Actions used with React `useActionState`.
// `error` non-null renders an inline message; actions that fully succeed usually
// redirect() instead of returning, so a returned state with error: null is rare.
export interface FormState {
  error: string | null;
}

export const OK: FormState = { error: null };

export function fail(message: string): FormState {
  return { error: message };
}

/** Result shape for CSV import actions: a row tally plus per-row error notes. */
export interface ImportState {
  error: string | null;
  summary?: { ok: number; errors: number; messages: string[] };
}

export const IMPORT_INIT: ImportState = { error: null };
