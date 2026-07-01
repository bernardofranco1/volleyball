import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, matchSessions } from "@/db/schema";
import { ADMIN_ROLES, requireRole } from "@/lib/authz";
import {
  getCompetition,
  getCompetitionConfig,
  getMatch,
} from "@/lib/competitions";
import { resolveConfig, type TournamentConfig } from "@/engine/config";
import type { Discipline } from "@/engine/types";
import { TeamColorPicker } from "@/components/admin/TeamColorPicker";
import { ScorerPinAdmin } from "@/components/admin/ScorerPinAdmin";
import { getScorerPin } from "@/lib/scorer-pin";
import {
  createMatchSession,
  revokeMatchSession,
} from "@/lib/match-session-actions";
import { qrSvg } from "@/lib/qr";
import { findSequenceGaps } from "@/lib/integrity";
import { ActionForm } from "@/components/admin/ActionForm";
import { CopyButton } from "@/components/CopyButton";
import { LocalTime } from "@/components/LocalTime";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { statusBadgeClass, ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

// The admin hub is visited often pre-match; render only the latest slice of
// the log by default (a finished indoor match is 300-450 rows).
const LOG_PREVIEW_ROWS = 50;

/**
 * Absolute origin for scannable QR URLs. Prefer the configured app URL so a
 * spoofed Host/X-Forwarded-Host header can't make the QR point elsewhere
 * (spec/14 §F6); fall back to request headers only in development.
 */
async function resolveOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function MatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{
    tenantSlug: string;
    competitionId: string;
    matchId: string;
  }>;
  searchParams: Promise<{ log?: string }>;
}) {
  const { tenantSlug, competitionId, matchId } = await params;
  const { log: logParam } = await searchParams;
  const fullLog = logParam === "full";
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}`,
  );

  // One round of concurrent fetches; access is gated (notFound) before render.
  const [competition, match, seqRows, logRows, sessions, origin, pin] =
    await Promise.all([
      getCompetition(ctx.tenant.id, competitionId),
      getMatch(ctx.tenant.id, matchId),
      // Integrity check needs every sequence number — but only that column.
      db
        .select({ sequence: events.sequence })
        .from(events)
        .where(eq(events.matchId, matchId)),
      db
        .select({
          sequence: events.sequence,
          eventType: events.eventType,
          setNumber: events.setNumber,
          scoreAfterA: events.scoreAfterA,
          scoreAfterB: events.scoreAfterB,
          actor: events.actor,
          timestamp: events.timestamp,
        })
        .from(events)
        .where(eq(events.matchId, matchId))
        .orderBy(desc(events.sequence))
        .limit(fullLog ? 100000 : LOG_PREVIEW_ROWS),
      db
        .select()
        .from(matchSessions)
        .where(
          and(
            eq(matchSessions.matchId, matchId),
            isNull(matchSessions.revokedAt),
            gt(matchSessions.expiresAt, sql`now()`),
          ),
        ),
      resolveOrigin(),
      getScorerPin(matchId),
    ]);
  if (!competition) notFound();
  if (!match || match.competitionId !== competitionId) notFound();

  const configRow = await getCompetitionConfig(competitionId);
  const config = resolveConfig(
    match.discipline as Discipline,
    (configRow ?? {}) as unknown as Partial<TournamentConfig>,
  );
  const integrity = findSequenceGaps(seqRows.map((r) => r.sequence));
  const log = [...logRows].reverse(); // stored desc for LIMIT; display asc
  const base = `/t/${tenantSlug}/competitions/${competitionId}`;

  // Render a QR per active, non-expired session token (expiry filtered in SQL).
  const tokens = await Promise.all(
    sessions.map(async (s) => {
      const url = `${origin}/t/${tenantSlug}/matches/${matchId}/team/${s.team}?token=${s.id}`;
      return { session: s, url, svg: await qrSvg(url) };
    }),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <Link
        href={`${base}/schedule`}
        className="text-sm text-score-dim hover:text-foreground"
      >
        ← Schedule
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {match.teamAName} vs {match.teamBName}
          </h1>
          <span className={statusBadgeClass(match.status)}>{match.status}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/matches/${matchId}/live`} className={ui.btnPrimary}>
            Open Scorer
          </Link>
          <a
            href={`/t/${tenantSlug}/scoreboard/${matchId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={ui.btnSecondary}
          >
            View Scoreboard
          </a>
          <a
            href={`/api/matches/${matchId}/export.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className={ui.btnSecondary}
          >
            Export PDF
          </a>
        </div>
      </div>

      <p className="mt-1 text-sm text-score-dim">
        {competition.name} · {match.discipline}
        {match.roundName ? ` · ${match.roundName}` : ""}
        {match.courtNumber ? ` · Court ${match.courtNumber}` : ""}
        {match.scheduledAt && (
          <>
            {" · "}
            <LocalTime date={match.scheduledAt} />
          </>
        )}
      </p>

      <div className="mt-6 grid max-w-2xl gap-4 sm:grid-cols-2">
        <TeamColorPicker
          tenantSlug={tenantSlug}
          competitionId={competitionId}
          matchId={matchId}
          teamAName={match.teamAName}
          teamBName={match.teamBName}
          teamAColor={match.teamAColor}
          teamBColor={match.teamBColor}
        />
        <ScorerPinAdmin
          tenantSlug={tenantSlug}
          competitionId={competitionId}
          matchId={matchId}
          pin={pin}
        />
      </div>

      {/* Result */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className={ui.card}>
          <h2 className="mb-3 font-medium">Result</h2>
          <div className="flex items-center justify-around text-center">
            <div>
              <div className="text-sm text-score-dim">{match.teamAName}</div>
              <div className="text-4xl font-bold tabular-nums">
                {match.setsWonA}
              </div>
            </div>
            <div className="text-score-dim">sets</div>
            <div>
              <div className="text-sm text-score-dim">{match.teamBName}</div>
              <div className="text-4xl font-bold tabular-nums">
                {match.setsWonB}
              </div>
            </div>
          </div>
          {match.winner && (
            <p className="mt-3 text-center text-sm text-score-dim">
              Winner:{" "}
              <span className="text-foreground">
                {match.winner === "A" ? match.teamAName : match.teamBName}
              </span>
            </p>
          )}
        </div>

        {/* Team tablet QR tokens */}
        <div className={ui.card}>
          <h2 className="mb-1 font-medium">Team tablet access</h2>
          {config.teamTabletEnabled ? (
            <>
              <p className="mb-4 text-xs text-score-dim">
                Generate a QR for each team’s tablet. Tokens expire in 12 hours.
              </p>

              <div className="flex gap-2">
                {(["A", "B"] as const).map((team) => (
                  <ActionForm key={team} action={createMatchSession}>
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input
                      type="hidden"
                      name="competitionId"
                      value={competitionId}
                    />
                    <input type="hidden" name="matchId" value={matchId} />
                    <input type="hidden" name="team" value={team} />
                    <SubmitButton variant="secondary" pendingLabel="…">
                      Generate QR for{" "}
                      {team === "A" ? match.teamAName : match.teamBName}
                    </SubmitButton>
                  </ActionForm>
                ))}
              </div>

              {tokens.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  {tokens.map(({ session, svg, url }) => (
                    <div
                      key={session.id}
                      className="rounded-lg border border-border p-3"
                    >
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-score-dim">
                        Team {session.team}
                      </div>
                      <div
                        className="mx-auto w-32 overflow-hidden rounded bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
                        // qrcode emits a trusted, self-generated SVG string.
                        dangerouslySetInnerHTML={{ __html: svg }}
                      />
                      {/* Don't print the full token URL — screenshots of this
                          page would leak live tablet credentials. */}
                      <div className="mt-2 text-center">
                        <CopyButton text={url} />
                      </div>
                      <ActionForm
                        action={revokeMatchSession}
                        confirm={`Revoke team ${session.team}'s tablet token? The tablet loses access immediately.`}
                        className="mt-2"
                      >
                        <input
                          type="hidden"
                          name="tenantSlug"
                          value={tenantSlug}
                        />
                        <input
                          type="hidden"
                          name="competitionId"
                          value={competitionId}
                        />
                        <input type="hidden" name="matchId" value={matchId} />
                        <input
                          type="hidden"
                          name="sessionId"
                          value={session.id}
                        />
                        <button
                          type="submit"
                          className="text-xs text-score-dim hover:text-red-400"
                        >
                          Revoke
                        </button>
                      </ActionForm>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-score-dim">
              Team tablets are disabled for this competition (Scoring rules →
              team tablet).
            </p>
          )}
        </div>
      </div>

      {/* Event log */}
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-medium">Event log</h2>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              integrity.ok
                ? "border-green-500/40 text-green-400"
                : "border-red-500/50 text-red-400"
            }`}
            title={
              integrity.ok
                ? "Contiguous event log"
                : `Gaps: ${integrity.gaps.join(", ") || "—"} · Dupes: ${integrity.duplicates.join(", ") || "—"}`
            }
          >
            {integrity.ok
              ? `✓ ${integrity.count} events`
              : `⚠ integrity (${integrity.gaps.length} gaps)`}
          </span>
          {!fullLog && integrity.count > LOG_PREVIEW_ROWS && (
            <Link
              href={`${base}/matches/${matchId}?log=full`}
              className="text-xs text-score-dim underline hover:text-foreground"
            >
              Show all {integrity.count} events
            </Link>
          )}
        </div>
        {log.length === 0 ? (
          <div className={`${ui.card} text-sm text-score-dim`}>
            No events yet — open the scorer to start the match.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse">
              <thead className="bg-surface-raised">
                <tr>
                  <th className={ui.th}>#</th>
                  <th className={ui.th}>Event</th>
                  <th className={ui.th}>Set</th>
                  <th className={ui.th}>Score</th>
                  <th className={ui.th}>Actor</th>
                  <th className={ui.th}>Time</th>
                </tr>
              </thead>
              <tbody>
                {log.map((e) => (
                  <tr key={e.sequence} className="border-t border-border">
                    <td className={`${ui.td} text-score-dim`}>{e.sequence}</td>
                    <td className={`${ui.td} font-mono text-xs`}>
                      {e.eventType}
                    </td>
                    <td className={ui.td}>{e.setNumber ?? "–"}</td>
                    <td className={`${ui.td} tabular-nums`}>
                      {e.scoreAfterA != null && e.scoreAfterB != null
                        ? `${e.scoreAfterA}–${e.scoreAfterB}`
                        : "–"}
                    </td>
                    <td className={`${ui.td} text-score-dim`}>{e.actor}</td>
                    <td className={`${ui.td} text-score-dim`}>
                      {new Date(e.timestamp).toUTCString().slice(17, 25)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
