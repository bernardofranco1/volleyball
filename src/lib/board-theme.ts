import { unstable_cache } from "next/cache";
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

// Fonts offered in the config tab. Self-hosted at build time by
// src/lib/board-fonts.ts, which the scoreboard route applies (spec/24 §9.5 F7).
export const BOARD_FONTS = [
  "Saira Condensed",
  "Barlow Condensed",
  "Archivo",
  "Anton",
] as const;

// Human family name (as stored on competition branding) → the CSS variable
// next/font generates. next/font hashes the family it registers, so naming
// 'Saira Condensed' directly no longer resolves; going through variables keeps
// the stored branding values working with no data migration.
const FONT_VAR: Record<string, string> = {
  "Saira Condensed": "var(--font-saira-condensed)",
  "Barlow Condensed": "var(--font-barlow-condensed)",
  Archivo: "var(--font-archivo)",
  Anton: "var(--font-anton)",
};

const SYSTEM_FALLBACK = "system-ui,-apple-system,sans-serif";

/**
 * CSS font-family stack for a board. Unknown/absent names fall back to Saira
 * Condensed, the default every per-discipline theme has always used. The other
 * condensed faces stay in the stack as near-metric fallbacks, mirroring the
 * previous hand-written stack.
 */
export function boardFontStack(fontFamily?: string | null): string {
  const primary =
    (fontFamily ? FONT_VAR[fontFamily] : undefined) ??
    FONT_VAR["Saira Condensed"];
  const fallbacks = [
    FONT_VAR["Barlow Condensed"],
    FONT_VAR.Archivo,
    SYSTEM_FALLBACK,
  ].filter((f) => f !== primary);
  return [primary, ...fallbacks].join(",");
}

const BEACH_DEFAULT: BoardTheme = {
  bg: "#0E1A2B",
  line: "#F2A01E",
  accent: "#F2A01E",
  font: "#FFFFFF",
  ff: boardFontStack(),
  radius: "0px",
};

const INDOOR_DEFAULT: BoardTheme = {
  bg: "#181B21",
  line: "#5A5F6A",
  accent: "#E9EBEF",
  font: "#FFFFFF",
  ff: boardFontStack(),
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

// Cached across requests (data cache, tag `competition-branding:<id>`); the
// scoreboard loads it on every render. `updateCompetitionBranding` revalidates
// the tag, with a 5-min TTL fallback. All fields are JSON-safe.
export async function getCompetitionBranding(
  competitionId: string,
): Promise<CompetitionBranding | null> {
  return unstable_cache(
    async () => {
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
    },
    ["competition-branding", competitionId],
    { tags: [`competition-branding:${competitionId}`], revalidate: 60 },
  )();
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
    ff: b?.fontFamily ? boardFontStack(b.fontFamily) : d.ff,
    radius: d.radius,
  };
}
