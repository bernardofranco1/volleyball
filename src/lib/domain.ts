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

type SchemaCategory = NonNullable<
  (typeof competitions.category.enumValues)[number]
>;
export const CATEGORIES = ["SENIOR", "JUNIOR", "YOUTH", "KID"] as const satisfies Exhaustive<
  SchemaCategory,
  readonly SchemaCategory[]
>;

export type Gender = (typeof GENDERS)[number];
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];
export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v);
}

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

// ── Reports (spec/24 §4) ─────────────────────────────────────────────────────
//
// The documents a finished match can produce. Each tenant enables a subset
// (tenant_config.enabled_report_types) and the Reports tab offers only those.
// One list drives the settings checkboxes, the tab, and the export-route guard,
// so what a tenant can tick and what the server will serve cannot drift.
export const REPORT_TYPES = [
  "OFFICIAL_SCORESHEET",
  "SCORESHEET",
  "MATCH_REPORT",
  "EVENT_LOG",
  "VSR_LOG",
  "TIMINGS",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(v: string): v is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(v);
}

/**
 * The three match documents any tenant member may download, versus the
 * technical exports that stay behind SCORING_ROLES (spec/24 §1 decision 4).
 */
export const VIEWER_REPORT_TYPES: readonly ReportType[] = [
  "OFFICIAL_SCORESHEET",
  "SCORESHEET",
  "MATCH_REPORT",
];

/** A tenant must keep at least one of these enabled or the tab is empty. */
export const CORE_REPORT_TYPES = VIEWER_REPORT_TYPES;

/**
 * Where each report type is served from. `pdfType` is the `?type=` value on
 * /api/matches/[id]/export.pdf; the two JSON exports have their own routes.
 */
export const REPORT_ROUTES: Record<
  ReportType,
  { path: (matchId: string) => string; format: "PDF" | "JSON" }
> = {
  OFFICIAL_SCORESHEET: {
    path: (id) => `/api/matches/${id}/export.pdf?type=official`,
    format: "PDF",
  },
  SCORESHEET: {
    path: (id) => `/api/matches/${id}/export.pdf?type=sheet`,
    format: "PDF",
  },
  MATCH_REPORT: {
    path: (id) => `/api/matches/${id}/export.pdf`,
    format: "PDF",
  },
  EVENT_LOG: {
    path: (id) => `/api/matches/${id}/export.pdf?type=log`,
    format: "PDF",
  },
  VSR_LOG: { path: (id) => `/api/matches/${id}/export.vsr`, format: "JSON" },
  TIMINGS: {
    path: (id) => `/api/matches/${id}/export.timings`,
    format: "JSON",
  },
};

/**
 * Only beach and indoor have true official-scoresheet renderers; the other two
 * disciplines fall back to the generic sheet, which the export route already
 * does. Used to label the Reports tab honestly rather than promising an
 * official sheet the renderer can't produce.
 */
export const OFFICIAL_SHEET_DISCIPLINES: readonly Discipline[] = [
  "BEACH",
  "INDOOR",
];
