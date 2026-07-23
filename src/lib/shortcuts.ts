// Scorer-console keyboard shortcuts: action ids, default keymap, and the
// per-device persistence. Keys are bound to what's ON SCREEN, not to team A/B —
// "pointLeft" scores for whichever team the court currently shows on the left,
// so a side switch swaps the keys together with the buttons. Every destructive
// action still goes through the two-tap arming (first press arms, second
// commits), identical to touch.
//
// The keymap is a per-device preference (scorer stations differ; works
// offline): stored in localStorage, merged over the defaults so actions added
// later automatically get their default key. Pure helpers are separated from
// the storage wrappers for testability.

export type ShortcutActionId =
  | "pointLeft"
  | "pointRight"
  | "replay"
  | "undo"
  | "timeoutLeft"
  | "timeoutRight"
  | "note"
  | "advance"
  | "help";

/** Display order in the settings panel. */
export const SHORTCUT_ACTION_IDS: readonly ShortcutActionId[] = [
  "pointLeft",
  "pointRight",
  "replay",
  "undo",
  "timeoutLeft",
  "timeoutRight",
  "note",
  "advance",
  "help",
];

export const DEFAULT_KEYMAP: Readonly<Record<ShortcutActionId, string>> = {
  pointLeft: ",",
  pointRight: ".",
  replay: "r",
  undo: "u",
  timeoutLeft: "1",
  timeoutRight: "2",
  note: "n",
  advance: "enter",
  help: "?",
};

export type Keymap = Record<ShortcutActionId, string>;

const STORAGE_KEY = "vbkeymap";

/**
 * Canonical form of a KeyboardEvent.key for matching and storage: lowercase,
 * with the one unnameable key given a name. "Enter" → "enter", " " → "space".
 */
export function normalizeKey(key: string): string {
  const k = key.toLowerCase();
  return k === " " ? "space" : k;
}

/** Merge a stored (possibly partial/corrupt) value over the defaults. Pure. */
export function mergeKeymap(raw: unknown): Keymap {
  const map: Keymap = { ...DEFAULT_KEYMAP };
  if (raw && typeof raw === "object") {
    for (const id of SHORTCUT_ACTION_IDS) {
      const v = (raw as Record<string, unknown>)[id];
      if (typeof v === "string" && v.length > 0 && v.length <= 24)
        map[id] = normalizeKey(v);
    }
  }
  return map;
}

/** Keys bound to more than one action (highlighted in the settings panel). */
export function keymapConflicts(map: Keymap): Set<string> {
  const seen = new Map<string, number>();
  for (const id of SHORTCUT_ACTION_IDS)
    seen.set(map[id], (seen.get(map[id]) ?? 0) + 1);
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

export function loadKeymap(): Keymap {
  if (typeof window === "undefined") return { ...DEFAULT_KEYMAP };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return mergeKeymap(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_KEYMAP };
  }
}

export function saveKeymap(map: Keymap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable (private mode) — the session keeps defaults */
  }
}

export function resetKeymap(): Keymap {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_KEYMAP };
}
