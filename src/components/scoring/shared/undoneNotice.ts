// Turns the event types removed by an UNDO (provider `undoneNotice`) into the
// toast text shown in the scoring header — "Undone: point, set start". Making
// the removals visible is half the undo fix: a wrong-target undo used to be
// silent, so scorers re-tapped and unwound more than they meant to.

import type { MsgParams } from "@/lib/i18n/messages";

const ITEM_KEYS: Record<string, string> = {
  RALLY_WON_A: "undo.item.point",
  RALLY_WON_B: "undo.item.point",
  SET_START: "undo.item.setStart",
  SERVICE_ORDER: "undo.item.serviceOrder",
  LINEUP_CONFIRMED: "undo.item.lineup",
  TIMEOUT_REQUEST: "undo.item.timeout",
  TIMEOUT_END: "undo.item.timeout",
  MEDICAL_TIMEOUT: "undo.item.medicalTimeout",
  MEDICAL_TIMEOUT_END: "undo.item.medicalTimeout",
  SUBSTITUTION: "undo.item.substitution",
  FORFEIT: "undo.item.forfeit",
  REPLAY_POINT: "undo.item.replay",
  NOTE: "undo.item.note",
};

// Auto-emitted consequences that always travel with the scorer event that
// caused them — naming the rally already covers them.
const SILENT = new Set(["SET_END", "MATCH_END", "SIDE_SWITCH", "TTO_START"]);

export function describeUndone(
  t: (key: string, params?: MsgParams) => string,
  types: string[] | null,
): string | null {
  if (!types || types.length === 0) return null;
  const named = types.filter((ty) => !SILENT.has(ty));
  // De-duplicate (a timeout pair reads as one "time-out") while keeping order.
  const items = [
    ...new Set(
      (named.length > 0 ? named : types).map((ty) =>
        t(ITEM_KEYS[ty] ?? "undo.item.action"),
      ),
    ),
  ];
  return t("scoring.undoneNotice", { items: items.join(", ") });
}
