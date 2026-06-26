import { createId } from "@paralleldrive/cuid2";

/**
 * Generate a cuid2 id, optionally namespaced with a short prefix
 * (e.g. `newId("match")` → `"match_xxxxx"`). Prefixes are for human
 * readability only — uniqueness comes from the cuid2 suffix.
 */
export function newId(prefix?: string): string {
  const id = createId();
  return prefix ? `${prefix}_${id}` : id;
}
