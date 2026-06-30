import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competitionBranding } from "@/db/schema";
import type { Discipline } from "@/engine/types";

// Broadcast-board theme tokens (mirror the template's --bg/--line/--accent/
// --font/--ff). Per-discipline defaults come from the templates you shared;
// each competition can override any of them from its Scoreboard config tab.
export interface BoardTheme {
  bg: string;
  line: string;
  accent: string;
  font: string; // text colour
  ff: string; // font-family stack
  radius: string;
}

const FF_FALLBACK =
  "'Barlow Condensed','Archivo',system-ui,-apple-system,sans-serif";

// Fonts offered in the config tab (loaded by the scoreboard route via next/font).
export const BOARD_FONTS = [
  "Saira Condensed",
  "Barlow Condensed",
  "Archivo",
  "Anton",
] as const;

const BEACH_DEFAULT: BoardTheme = {
  bg: "#0E1A2B",
  line: "#F2A01E",
  accent: "#F2A01E",
  font: "#FFFFFF",
  ff: `'Saira Condensed',${FF_FALLBACK}`,
  radius: "0px",
};

const INDOOR_DEFAULT: BoardTheme = {
  bg: "#181B21",
  line: "#5A5F6A",
  accent: "#E9EBEF",
  font: "#FFFFFF",
  ff: `'Saira Condensed',${FF_FALLBACK}`,
  radius: "0px",
};

export function defaultBoardTheme(discipline: Discipline): BoardTheme {
  return discipline === "INDOOR" ? INDOOR_DEFAULT : BEACH_DEFAULT;
}

export interface CompetitionBranding {
  bgColor: string | null;
  lineColor: string | null;
  accentColor: string | null;
  fontColor: string | null;
  fontFamily: string | null;
  logoUrl: string | null;
}

export async function getCompetitionBranding(
  competitionId: string,
): Promise<CompetitionBranding | null> {
  const rows = await db
    .select({
      bgColor: competitionBranding.bgColor,
      lineColor: competitionBranding.lineColor,
      accentColor: competitionBranding.accentColor,
      fontColor: competitionBranding.fontColor,
      fontFamily: competitionBranding.fontFamily,
      logoUrl: competitionBranding.logoUrl,
    })
    .from(competitionBranding)
    .where(eq(competitionBranding.competitionId, competitionId))
    .limit(1);
  return rows[0] ?? null;
}

/** Layer a competition's overrides (ignoring blanks) over the discipline default. */
export function resolveBoardTheme(
  discipline: Discipline,
  b: CompetitionBranding | null,
): BoardTheme {
  const d = defaultBoardTheme(discipline);
  return {
    bg: b?.bgColor || d.bg,
    line: b?.lineColor || d.line,
    accent: b?.accentColor || d.accent,
    font: b?.fontColor || d.font,
    ff: b?.fontFamily ? `'${b.fontFamily}',${FF_FALLBACK}` : d.ff,
    radius: d.radius,
  };
}
