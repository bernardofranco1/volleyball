/**
 * Roster-row vocabulary shared by the match surfaces (spec/29 F1).
 *
 * A roster row (`players`) is a membership, and `role` says what kind:
 *
 *   PLAYER — may be put on court: lineups, substitutions, libero replacement.
 *   BENCH  — a registered player not in the starting six; still court-eligible.
 *   STAFF  — a bench official (coach, doctor, …). NEVER court-eligible, but
 *            sanctionable, and printed in the TEAMS block of the scoresheet.
 *
 * Pure: no db, no React, no I/O — imported by server renderers and client
 * consoles alike.
 */

/**
 * The letters the FIVB scoresheet prints for bench officials, in the order they
 * occupy the TEAMS block's staff rows.
 *
 * The paper sheet gives one row per function, so the codes ARE the row labels:
 * a team fields one coach (C1), up to three assistants (A1-A3), a doctor (D1),
 * a therapist (T) and a physiotherapist (P).
 */
export const STAFF_FUNCTIONS = ["C1", "A1", "A2", "A3", "D1", "T", "P"] as const;
export type StaffFunction = (typeof STAFF_FUNCTIONS)[number];

const STAFF_FUNCTION_LABELS: Record<StaffFunction, string> = {
  C1: "Coach",
  A1: "Assistant coach 1",
  A2: "Assistant coach 2",
  A3: "Assistant coach 3",
  D1: "Doctor",
  T: "Therapist",
  P: "Physiotherapist",
};

export function isStaffFunction(v: unknown): v is StaffFunction {
  return typeof v === "string" && (STAFF_FUNCTIONS as readonly string[]).includes(v);
}

/** "C1 — Coach", for pickers. Falls back to the bare code if ever unknown. */
export function staffFunctionLabel(fn: StaffFunction | null): string {
  if (!fn) return "Bench official";
  return `${fn} — ${STAFF_FUNCTION_LABELS[fn]}`;
}

/**
 * The minimum any roster consumer needs to decide what someone may do.
 *
 * `role` is optional because the client-side `PlayerLite` makes it optional:
 * a row without one is treated as a player, which is what every roster
 * contained before bench officials existed.
 */
export interface RosterRole {
  /**
   * Widened to `string` deliberately: `ReportPlayer` (match-report, feeding the
   * PDF renderers and the VSR export) carries `role?: string | null`, and these
   * helpers must serve it as well as the strictly-typed rows. Every consumer
   * only ever compares against the literals, so nothing is lost.
   */
  role?: string | null;
}

/**
 * May this roster row be put ON COURT?
 *
 * Every picker that chooses a body for the court — lineup entry, service order,
 * substitutions, libero replacement, the serving player — must filter through
 * this. Before staff rows existed the rosters happened to contain only players,
 * so the filters were absent; the first coach added to a roster would otherwise
 * appear in the starting six (spec/29 §Revalidation §1).
 */
export function courtEligible<T extends RosterRole>(row: T): boolean {
  return row.role !== "STAFF";
}

/** The bench officials: sanction targets and TEAMS-block staff rows. */
export function isStaff<T extends RosterRole>(row: T): boolean {
  return row.role === "STAFF";
}

/** Court-eligible rows only, preserving order. */
export function courtRoster<T extends RosterRole>(rows: T[]): T[] {
  return rows.filter(courtEligible);
}

/** Staff rows only, ordered by the scoresheet's function order. */
export function staffRoster<T extends RosterRole & { staffFunction?: StaffFunction | null }>(
  rows: T[],
): T[] {
  const rank = (fn: StaffFunction | null | undefined) => {
    const i = fn ? STAFF_FUNCTIONS.indexOf(fn) : -1;
    // Undeclared functions sort last but still print — a bench official with no
    // code is a real (if sloppy) roster, not a row to hide.
    return i === -1 ? STAFF_FUNCTIONS.length : i;
  };
  return rows
    .filter(isStaff)
    .sort((a, b) => rank(a.staffFunction) - rank(b.staffFunction));
}
