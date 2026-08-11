// Client-safe half of the people registry (spec/24 §6): constants, labels and
// pure name formatting, with NO database import — the same split as domain.ts.
// people.ts (server-only, queries the DB) re-exports everything here so server
// code has a single entry point, while client components import from this module
// and don't drag drizzle/postgres into the browser bundle.

export const PERSON_ROLES = ["PLAYER", "REFEREE", "COACH", "SCORER"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

export function isPersonRole(v: string): v is PersonRole {
  return (PERSON_ROLES as readonly string[]).includes(v);
}

/** VIS PlayerVolleyPosition 1–6, in VIS's order. */
export const PERSON_POSITIONS = [
  "SETTER",
  "WING_SPIKER",
  "MIDDLE_BLOCKER",
  "LIBERO",
  "UNIVERSAL",
  "OPPOSITE",
] as const;
export type PersonPosition = (typeof PERSON_POSITIONS)[number];

/**
 * Labels carry both names where VIS and the sport disagree, so anyone mapping a
 * record to VIS can see which field they're looking at (spec/24 §7.5).
 */
export const POSITION_LABEL: Record<PersonPosition, string> = {
  SETTER: "Setter",
  WING_SPIKER: "Outside hitter (wing spiker)",
  MIDDLE_BLOCKER: "Middle blocker",
  LIBERO: "Libero",
  UNIVERSAL: "Universal",
  OPPOSITE: "Opposite",
};

/** Mirrors VIS's VolleyTeam staff slots exactly (spec/24 §7.3). */
export const STAFF_FUNCTIONS = [
  "HEAD_COACH",
  "ASSISTANT_COACH",
  "ASSISTANT_COACH_2",
  "DOCTOR",
  "TRAINER",
  "MANAGER",
] as const;
export type StaffFunction = (typeof STAFF_FUNCTIONS)[number];

export const STAFF_FUNCTION_LABEL: Record<StaffFunction, string> = {
  HEAD_COACH: "Head coach",
  ASSISTANT_COACH: "Assistant coach",
  ASSISTANT_COACH_2: "Assistant coach 2",
  DOCTOR: "Doctor",
  TRAINER: "Trainer",
  MANAGER: "Manager",
};

export interface PersonRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  federationCode: string | null;
  visPersonNo: number | null;
  roles: PersonRole[];
}

/**
 * Placeholder address for seeded/test people (spec/25 §2).
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so a placeholder can
 * never become real mail to a real stranger — this app has a working sender
 * (invite and welcome templates), which makes a plausible-looking domain a
 * genuine hazard rather than a cosmetic choice. Per-row, because email is
 * unique-when-present: one shared placeholder would collide on the second row.
 */
export function placeholderEmail(personId: string): string {
  return `person-${personId}@example.invalid`;
}

/** True for an address that exists only to satisfy tests/seeds. */
export function isPlaceholderEmail(email: string | null): boolean {
  return email != null && email.endsWith("@example.invalid");
}

/**
 * Basic shape check. Deliberately permissive — the registry holds addresses
 * typed by tournament staff, and rejecting unusual-but-valid addresses is worse
 * than storing one that bounces.
 */
export function looksLikeEmail(v: string): boolean {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v);
}

/** Normalised form used for identity matching: trimmed and lower-cased. */
export function normalizeEmail(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase();
  return t || null;
}

export interface PersonDetail extends PersonRow {
  gender: "M" | "W" | null;
  email: string | null;
  birthdate: string | null;
  /** Login account, when this person has one (spec/25 §3). */
  userId: string | null;
  heightCm: number | null;
  weightKg: number | null;
  position: PersonPosition | null;
  spikeReachCm: number | null;
  blockReachCm: number | null;
  handedness: "LEFT" | "RIGHT" | null;
  photoUrl: string | null;
  refereeLevel: string | null;
  notes: string | null;
}

/**
 * A readable name: "Last, First" when both are known, otherwise whatever exists.
 * The display/shirt label is a LAST resort and is never appended to a real name —
 * doing that is what produced names like "Thatdao N.Thatdao" in production
 * (spec/24 §7.5).
 */
export function personName(p: {
  firstName: string | null;
  lastName: string | null;
  displayName: string;
}): string {
  if (p.lastName && p.firstName) return `${p.lastName}, ${p.firstName}`;
  return p.lastName ?? p.firstName ?? p.displayName;
}
