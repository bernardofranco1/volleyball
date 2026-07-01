// Single source of truth for competition domain constants. Values are plain
// literals (safe to import from client components — no drizzle in the bundle);
// the `satisfies`/Exhaustive checks tie them to the DB schema enums at compile
// time so the UI selects, action validators, and columns can't drift.

import type { competitions } from "@/db/schema";
import type { Discipline } from "@/engine/types";

type SchemaDiscipline = (typeof competitions.discipline.enumValues)[number];
type SchemaGender = (typeof competitions.gender.enumValues)[number];
type SchemaStatus = (typeof competitions.status.enumValues)[number];

// Exhaustive<Union, Tuple> errors if Tuple is missing a member of Union.
type Exhaustive<U, T extends readonly U[]> = U extends T[number] ? T : never;

export const DISCIPLINES = ["BEACH", "INDOOR", "GRASS", "LIGHT"] as const satisfies Exhaustive<
  SchemaDiscipline,
  readonly SchemaDiscipline[]
>;
export const GENDERS = ["MEN", "WOMEN", "MIXED", "UNSPECIFIED"] as const satisfies Exhaustive<
  SchemaGender,
  readonly SchemaGender[]
>;
export const COMPETITION_STATUSES = ["DRAFT", "ACTIVE", "FINISHED"] as const satisfies Exhaustive<
  SchemaStatus,
  readonly SchemaStatus[]
>;

export type Gender = (typeof GENDERS)[number];
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

export function isDiscipline(v: string): v is Discipline {
  return (DISCIPLINES as readonly string[]).includes(v);
}
export function isGender(v: string): v is Gender {
  return (GENDERS as readonly string[]).includes(v);
}
export function isCompetitionStatus(v: string): v is CompetitionStatus {
  return (COMPETITION_STATUSES as readonly string[]).includes(v);
}

/**
 * Legal status transitions. Also drives the buttons on the competition
 * overview page, so what the UI offers and what the action accepts stay equal.
 */
export const NEXT_STATUS: Record<
  CompetitionStatus,
  { to: CompetitionStatus; label: string }[]
> = {
  DRAFT: [{ to: "ACTIVE", label: "Activate" }],
  ACTIVE: [
    { to: "FINISHED", label: "Finish" },
    { to: "DRAFT", label: "Back to draft" },
  ],
  FINISHED: [{ to: "ACTIVE", label: "Reopen" }],
};

export function canTransition(
  from: CompetitionStatus,
  to: CompetitionStatus,
): boolean {
  return NEXT_STATUS[from].some((t) => t.to === to);
}

/** Legal players-per-side overrides for the disciplines that allow one. */
export const PLAYERS_PER_SIDE: Partial<Record<Discipline, number[]>> = {
  GRASS: [3, 4],
  LIGHT: [4, 5],
};
