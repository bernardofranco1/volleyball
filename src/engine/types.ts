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

export type Gender = "MEN" | "WOMEN" | "MIXED" | "UNSPECIFIED";

/** Who produced an event. */
export type Actor = "SCORER" | "TEAM_A" | "TEAM_B" | "SYSTEM";
