// Shared engine types used across all four disciplines.

export type Discipline = "BEACH" | "INDOOR" | "GRASS" | "LIGHT";

export const DISCIPLINES: readonly Discipline[] = [
  "BEACH",
  "INDOOR",
  "GRASS",
  "LIGHT",
] as const;

/** Which team in a match. */
export type TeamId = "A" | "B";

/** Physical side of the court a team currently occupies. */
export type CourtSide = "LEFT" | "RIGHT";

/** Physical side of the court a team currently occupies. */
export type Side = "LEFT" | "RIGHT";

export type SetNumber = number;

export interface MisconductRecord {
  type:
    | "MISCONDUCT_WARNING"
    | "MISCONDUCT_PENALTY"
    | "MISCONDUCT_EXPULSION"
    | "MISCONDUCT_DISQUALIFICATION";
  playerId: string;
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
}

export function oppositeTeam(team: TeamId): TeamId {
  return team === "A" ? "B" : "A";
}

export function oppositeSide(side: Side): Side {
  return side === "LEFT" ? "RIGHT" : "LEFT";
}

/** The set currently being played (1-based `currentSetNumber`). */
export function activeSet<TSet>(state: {
  sets: TSet[];
  currentSetNumber: SetNumber;
}): TSet | undefined {
  return state.sets[state.currentSetNumber - 1];
}

export type Gender = "MEN" | "WOMEN" | "MIXED" | "UNSPECIFIED";

/** Who produced an event. */
export type Actor = "SCORER" | "TEAM_A" | "TEAM_B" | "SYSTEM";
