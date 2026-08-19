/**
 * The VIS-fed board screen itself (spec/34), shared by the two URLs that serve
 * it: the tenant path inside the scoring app, and `/m/{matchNo}` on the public
 * board host (spec/38). One renderer, so the two can never drift.
 *
 * Public and read-only. The initial board is fetched server-side so the screen
 * is correct on first paint; VisBoardDisplay keeps it current from there.
 *
 * BACKGROUND ARTWORK, two ways in, neither needing a schema change:
 *   ?bg=<https url or /path>   — per-screen override, handy for a rehearsal
 *   public/board-bg/<competitionId>.jpg — the convention; drop the hi-res file
 *   in and every board of that competition picks it up. A missing file simply
 *   reveals the built-in gradient (CSS falls through a 404 background layer).
 */

import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import {
  MOCK_LABEL,
  getBoard,
  getMatchList,
  getMockBoard,
  getVisCompetition,
} from "@/lib/vis-live/store";
import { getCompetitionBranding } from "@/lib/board-theme";
import {
  VIS_BOARD_THEME,
  type VisBoardTheme,
} from "@/components/scoreboard/vis-board-theme";
import { VisBoardDisplay } from "@/components/scoreboard/VisBoardDisplay";

/** The mock (spec/35 W9) stands in for this match without touching VIS. */
export const MOCK_BOARD_MATCH_NO = 21546;

export interface VisBoardQuery {
  bg?: string;
  layout?: string;
  screen?: string;
  window?: string;
  replica?: string;
}

/** Only same-origin paths or https URLs may be painted onto a board. */
function safeBackground(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function VisBoardScreen({
  tenantId,
  competitionId,
  rawMatchNo,
  query,
}: {
  tenantId: string;
  competitionId: string;
  /** The path segment: a VIS match number, or "mock". */
  rawMatchNo: string;
  query: VisBoardQuery;
}) {
  const { t } = await getT();
  const isMock = rawMatchNo === "mock";
  if (!isMock && !/^\d{1,9}$/.test(rawMatchNo)) notFound();
  const matchNo = isMock ? MOCK_BOARD_MATCH_NO : Number(rawMatchNo);

  const comp = await getVisCompetition(tenantId, competitionId);
  if (!comp) notFound();

  // The match must belong to THIS competition's tournament — the URL is public,
  // so it must not be a way to render any VIS match under any competition's
  // branding. This read also warms the allowlist the board API checks.
  const schedule = isMock
    ? []
    : (await getMatchList(comp.visTournamentNo).catch(() => ({ value: [] }))).value;
  if (!isMock && schedule.length > 0 && !schedule.some((m) => m.matchNo === matchNo)) {
    notFound();
  }

  const [boardResult, branding] = await Promise.all([
    (isMock ? Promise.resolve(getMockBoard()) : getBoard(matchNo)).then(
      (r) => ({ ok: true as const, board: r.value }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    getCompetitionBranding(competitionId),
  ]);

  if (!boardResult.ok) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("visBoard.boardUnavailable")}
          </h1>
          <p className="mt-2 text-score-dim">
            {t("visBoard.boardUnavailableBody", { match: matchNo })}
          </p>
        </div>
      </main>
    );
  }

  // A competition may retint the board from its existing Scoreboard config;
  // anything unset keeps the template's own palette.
  const theme: VisBoardTheme = {
    ...VIS_BOARD_THEME,
    bg: branding?.bgColor || VIS_BOARD_THEME.bg,
    accent: branding?.accentColor || VIS_BOARD_THEME.accent,
    ink: branding?.fontColor || VIS_BOARD_THEME.ink,
  };

  // Background artwork, in order of precedence (spec/40):
  //   ?bg=…                     one screen, for a rehearsal or a sponsor night
  //   branding.boardBgUrl       the competition's own, set in the admin console
  //   /board-bg/{id}.jpg        the file convention, still supported
  // Only the first two can be changed without a commit, which is the point of
  // the second. A 404 on any of them simply reveals the built-in artwork, since
  // CSS falls through a background layer it cannot load.
  const backgroundUrl =
    safeBackground(query.bg) ??
    safeBackground(branding?.boardBgUrl ?? undefined) ??
    `/board-bg/${encodeURIComponent(competitionId)}.jpg`;

  const layout = query.layout === "ushape" ? ("ushape" as const) : ("full" as const);
  const screenOverride =
    query.screen === "board"
      ? ("board" as const)
      : query.screen === "stats"
        ? ("stats" as const)
        : null;
  const windowFill = query.window === "black" ? ("black" as const) : ("transparent" as const);

  return (
    <>
      {layout === "ushape" && windowFill === "transparent" ? (
        // The U-shape's centre window must key through to the TV feed in
        // vMix/OBS, which requires the PAGE itself to be transparent — the
        // root layout paints an opaque body that would otherwise fill the cut.
        <style>{"html,body{background:transparent!important}"}</style>
      ) : null}
      <VisBoardDisplay
        matchNo={matchNo}
        initialBoard={boardResult.board}
        layout={layout}
        screenOverride={screenOverride}
        theme={theme}
        backgroundUrl={backgroundUrl}
        logoUrl={branding?.logoUrl ?? null}
        windowFill={windowFill}
        replica={query.replica === "1"}
        notice={isMock ? MOCK_LABEL : null}
      />
    </>
  );
}
