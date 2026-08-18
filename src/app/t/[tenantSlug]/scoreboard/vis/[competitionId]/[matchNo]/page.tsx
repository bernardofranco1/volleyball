/**
 * The VIS-fed broadcast board (spec/34) — the page a venue TV points at.
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
import { getTenantBySlug } from "@/lib/tenant";
import { getT } from "@/lib/i18n/server";
import { getBoard, getMatchList, getVisCompetition } from "@/lib/vis-live/store";
import { getCompetitionBranding } from "@/lib/board-theme";
import {
  VIS_BOARD_THEME,
  type VisBoardTheme,
} from "@/components/scoreboard/vis-board-theme";
import { VisBoardDisplay } from "@/components/scoreboard/VisBoardDisplay";

export const dynamic = "force-dynamic";

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

export default async function VisBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string; matchNo: string }>;
  searchParams: Promise<{
    bg?: string;
    layout?: string;
    screen?: string;
    window?: string;
  }>;
}) {
  const { tenantSlug, competitionId, matchNo: rawNo } = await params;
  const { bg, layout: layoutParam, screen, window: windowParam } = await searchParams;
  const { t } = await getT();
  if (!/^\d{1,9}$/.test(rawNo)) notFound();
  const matchNo = Number(rawNo);

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();
  const comp = await getVisCompetition(tenant.id, competitionId);
  if (!comp) notFound();

  // The match must belong to THIS competition's tournament — the URL is public,
  // so it must not be a way to render any VIS match under any competition's
  // branding. This read also warms the allowlist the board API checks.
  const { value: schedule } = await getMatchList(comp.visTournamentNo).catch(() => ({
    value: [],
  }));
  const scheduleRow = schedule.find((m) => m.matchNo === matchNo) ?? null;
  if (schedule.length > 0 && !scheduleRow) notFound();

  const [boardResult, branding] = await Promise.all([
    getBoard(matchNo).then(
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

  const backgroundUrl =
    safeBackground(bg) ?? `/board-bg/${encodeURIComponent(competitionId)}.jpg`;

  const layout = layoutParam === "ushape" ? ("ushape" as const) : ("full" as const);
  const screenOverride =
    screen === "board" ? ("board" as const) : screen === "stats" ? ("stats" as const) : null;
  const windowFill = windowParam === "black" ? ("black" as const) : ("transparent" as const);

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
        scheduledFallback={
          scheduleRow?.dateLocal
            ? [scheduleRow.dateLocal, scheduleRow.timeLocal].filter(Boolean).join(" ")
            : null
        }
      />
    </>
  );
}
