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
  loadSetScores,
} from "@/lib/competitions";
import { Page, PageHeader } from "@/components/ui/Page";
import { FilterChip, Toolbar } from "@/components/ui/Toolbar";
import { resolveConfig, type TournamentConfig } from "@/engine/config";
import type { Discipline } from "@/engine/types";
import { TeamColorPicker } from "@/components/admin/TeamColorPicker";
import { ScorerPinAdmin } from "@/components/admin/ScorerPinAdmin";
import { getScorerPin, scorerPinCookieValue } from "@/lib/scorer-pin";
import {
  createMatchSession,
  revokeMatchSession,
} from "@/lib/match-session-actions";
import { qrSvg } from "@/lib/qr";
import { findSequenceGaps } from "@/lib/integrity";
import {
  confirmMatchResult,
  reopenMatchResult,
} from "@/lib/match-admin-actions";
import { MatchOfficialsForm, MatchVisIdForm } from "@/components/admin/MatchOfficialsForm";
import {
  loadOfficials,
  loadSignatures,
  SIGNATURE_ROLES,
  signatureRoleLabel,
} from "@/lib/match-signatures";
import { getT } from "@/lib/i18n/server";
import { ActionForm } from "@/components/admin/ActionForm";
import { RewindToHere } from "@/components/admin/RewindToHere";
import { CopyButton } from "@/components/CopyButton";
import { LocalTime } from "@/components/LocalTime";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { matchStatusLabel, statusBadgeClass, ui } from "@/components/admin/styles";
import { MatchTabs } from "@/components/admin/MatchTabs";
import { isReportableStatus } from "@/lib/reports";
import { searchPeople } from "@/lib/people";

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
  searchParams: Promise<{ log?: string; event?: string }>;
}) {
  const { tenantSlug, competitionId, matchId } = await params;
  const { log: logParam, event: eventFilter } = await searchParams;
  const { t } = await getT();
  const fullLog = logParam === "full";
  const ctx = await requireRole(
    tenantSlug,
    ADMIN_ROLES,
    `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}`,
  );

  // One round of concurrent fetches; access is gated (notFound) before render.
  const [competition, match, seqRows, logRows, sessions, origin, pin, signatures, officials] =
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
      loadSignatures(matchId),
      loadOfficials(matchId),
    ]);
  if (!competition) notFound();
  if (!match || match.competitionId !== competitionId) notFound();

  // Autocomplete sources for the officials pickers (spec/24 §6.3).
  const [refereePeople, scorerPeople] = await Promise.all([
    searchPeople(ctx.tenant.id, { roles: ["REFEREE"], limit: 500 }),
    searchPeople(ctx.tenant.id, { roles: ["SCORER"], limit: 500 }),
  ]);
  const officialsPickers = { referees: refereePeople, scorers: scorerPeople };

  const configRow = await getCompetitionConfig(competitionId);
  const config = resolveConfig(
    match.discipline as Discipline,
    (configRow ?? {}) as unknown as Partial<TournamentConfig>,
  );
  const integrity = findSequenceGaps(seqRows.map((r) => r.sequence));
  // Scoresheet approval (spec/20): obligation comes from the competition config,
  // the signatures themselves from match_signatures (live rows only).
  const signaturePolicy = config.resultSignatures;
  const confirmedVia = match.confirmedVia;
  const allLog = [...logRows].reverse(); // stored desc for LIMIT; display asc
  // Event-type filter: a finished indoor match is 300-450 rows and the question
  // is almost always about one kind of event ("where are the substitutions?").
  // Filtering client-of-the-URL keeps the row numbering honest — the sequence
  // numbers stay the real ones.
  const eventTypes = [...new Set(allLog.map((e) => e.eventType))].sort();
  const log = eventFilter
    ? allLog.filter((e) => e.eventType === eventFilter)
    : allLog;
  const setScores = await loadSetScores([matchId]);
  const sets = setScores.get(matchId) ?? [];
  const base = `/t/${tenantSlug}/competitions/${competitionId}`;
  // Reports only exist once there is a result to report on (spec/24 A2).
  const reportable = isReportableStatus(match.status);

  // Signed scorer deep-link: scanning it opens the scorer with the PIN gate
  // pre-satisfied (login + role still required). Rotating the PIN kills it.
  const scorerLink = pin
    ? `${origin}${base}/matches/${matchId}/live?key=${scorerPinCookieValue(matchId, pin)}`
    : null;
  const scorerLinkQr = scorerLink ? await qrSvg(scorerLink) : null;

  // Render a QR per active, non-expired session token (expiry filtered in SQL).
  const tokens = await Promise.all(
    sessions.map(async (s) => {
      const url = `${origin}/t/${tenantSlug}/matches/${matchId}/team/${s.team}?token=${s.id}`;
      return { session: s, url, svg: await qrSvg(url) };
    }),
  );

  return (
    <Page>
      <PageHeader
        crumbs={[
          { href: `/t/${tenantSlug}/competitions`, label: t("nav.competitions") },
          { href: `${base}`, label: competition.name },
          { href: `${base}/schedule`, label: t("tabs.schedule") },
        ]}
        title={`${match.teamAName} vs ${match.teamBName}`}
        badge={
          <span className={statusBadgeClass(match.status)}>
            {matchStatusLabel(match.status, t("match.pendingBadge"))}
          </span>
        }
        meta={
          <>
            {match.discipline}
            {match.roundName ? ` · ${match.roundName}` : ""}
            {match.courtNumber
              ? ` · ${t("match.court", { number: match.courtNumber })}`
              : ""}
            {match.scheduledAt && (
              <>
                {" · "}
                <LocalTime date={match.scheduledAt} />
              </>
            )}
          </>
        }
        actions={
          <>
            <Link href={`${base}/matches/${matchId}/live`} className={ui.btnPrimary}>
              {t("match.openScorer")}
            </Link>
            <a
              href={`/t/${tenantSlug}/scoreboard/${matchId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={ui.btnSecondary}
            >
              {t("match.viewScoreboard")}
            </a>
            {/* Every export moved to the Reports tab (spec/24 §3.2) — one home
                for match documents, respecting the tenant's allow-list. */}
            {reportable && (
              <Link
                href={`${base}/matches/${matchId}/reports`}
                className={ui.btnSecondary}
              >
                {t("reports.title")}
              </Link>
            )}
          </>
        }
      />

      <MatchTabs
        tenantSlug={tenantSlug}
        competitionId={competitionId}
        matchId={matchId}
        active="overview"
        canManage
        showReports={reportable}
      />

      {/*
        Two panes: what happened on the left (approval state, result,
        event log), what has to be set up on the right (colours, PIN,
        officials, tablet tokens). The setup cards used to sit between the
        header and the result, so the score — the reason most people open
        this page — was three scrolls down.
      */}
      <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
      {/* A scorer's final point parks the match here until the scoresheet is
          signed on the console or a manager confirms it (spec/20). */}
      {match.status === "PENDING_CONFIRMATION" && (
        <div className="mt-6 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
          <h2 className="font-medium text-amber-300">
            {t("match.awaitingConfirmation")}
          </h2>
          <p className="mt-1 text-sm text-score-dim">
            {t("match.confirmResultHint")}
          </p>
          {signaturePolicy !== "OFF" && (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {SIGNATURE_ROLES.map((role) => {
                const sig = signatures.find((x) => x.role === role);
                return (
                  <li key={role} className="flex items-center gap-2">
                    <span aria-hidden>{sig ? "✓" : "○"}</span>
                    <span className="text-score-dim">
                      {signatureRoleLabel(role)}:
                    </span>
                    <span>
                      {sig
                        ? `${sig.signerName}${
                            sig.intent === "PROTEST"
                              ? " — under protest"
                              : sig.intent === "REFUSED"
                                ? " — refused to sign"
                                : ""
                          }`
                        : t("match.signatureMissing")}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <ActionForm
            action={confirmMatchResult}
            confirm={t("match.confirmResultConfirm")}
            className="mt-3"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="competitionId" value={competitionId} />
            <input type="hidden" name="matchId" value={matchId} />
            {/* Confirming without the required signatures is an override — it
                has to say why, and the reason goes into the audit log. */}
            {signaturePolicy === "REQUIRED" &&
              signatures.length < SIGNATURE_ROLES.length && (
                <label className="mb-2 block text-sm">
                  <span className={ui.label}>{t("match.overrideReason")}</span>
                  <input
                    name="reason"
                    maxLength={300}
                    className={ui.input}
                    placeholder={t("match.overrideReasonHint")}
                  />
                </label>
              )}
            <SubmitButton pendingLabel={t("common.saving")}>
              {t("match.confirmResult")}
            </SubmitButton>
          </ActionForm>
        </div>
      )}

      {/* A confirmed result can be corrected only by reopening it, which
          invalidates the signatures (kept on record) — spec/20. */}
      {match.status === "FINISHED" && (
        <div className="mt-6 rounded-xl border border-border p-4">
          <h2 className="font-medium">
            {confirmedVia === "SIGNATURES"
              ? t("match.signedTitle")
              : t("match.confirmedTitle")}
          </h2>
          {signatures.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-score-dim">
              {signatures.map((sig) => (
                <li key={sig.role}>
                  {signatureRoleLabel(sig.role)}: {sig.signerName}
                  {sig.intent === "PROTEST"
                    ? " — under protest"
                    : sig.intent === "REFUSED"
                      ? " — refused to sign"
                      : ""}
                  {sig.remarks ? ` (${sig.remarks})` : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm text-score-dim">{t("match.reopenHint")}</p>
          <ActionForm
            action={reopenMatchResult}
            confirm={t("match.reopenConfirm")}
            className="mt-3"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="competitionId" value={competitionId} />
            <input type="hidden" name="matchId" value={matchId} />
            <label className="mb-2 block text-sm">
              <span className={ui.label}>{t("match.reopenReason")}</span>
              <input
                name="reason"
                maxLength={300}
                className={ui.input}
                placeholder={t("match.reopenReasonHint")}
              />
            </label>
            <SubmitButton pendingLabel={t("common.saving")}>
              {t("match.reopen")}
            </SubmitButton>
          </ActionForm>
        </div>
      )}

        <div className={ui.card}>
          <h2 className="mb-3 font-medium">{t("match.result")}</h2>
          <div className="flex items-center justify-around text-center">
            <div>
              <div className="text-sm text-score-dim">{match.teamAName}</div>
              <div className="text-4xl font-bold tabular-nums">
                {match.setsWonA}
              </div>
            </div>
            <div className="text-score-dim">{t("match.sets")}</div>
            <div>
              <div className="text-sm text-score-dim">{match.teamBName}</div>
              <div className="text-4xl font-bold tabular-nums">
                {match.setsWonB}
              </div>
            </div>
          </div>
          {/* Set-by-set, not just the tally: the tally alone can't tell a 3-0
              from a 3-0 that went to 29-27 twice. */}
          {sets.length > 0 && (
            <ol className="mt-4 flex flex-wrap justify-center gap-2">
              {sets.map((s, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-border px-2.5 py-1 text-center"
                >
                  <span className="block text-[10px] uppercase tracking-wide text-score-dim">
                    {t("match.setN", { n: i + 1 })}
                  </span>
                  <span className="font-mono text-sm tabular-nums">
                    <span className={s.a > s.b ? "font-bold" : "text-score-dim"}>
                      {s.a}
                    </span>
                    <span className="text-score-dim">–</span>
                    <span className={s.b > s.a ? "font-bold" : "text-score-dim"}>
                      {s.b}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {match.winner && (
            <p className="mt-3 text-center text-sm text-score-dim">
              {t("match.winner")}{" "}
              <span className="text-foreground">
                {match.winner === "A" ? match.teamAName : match.teamBName}
              </span>
            </p>
          )}
        </div>
      {/* Event log */}
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-medium">{t("match.eventLog")}</h2>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              integrity.ok
                ? "border-green-500/40 text-green-400"
                : "border-red-500/50 text-red-400"
            }`}
            title={
              integrity.ok
                ? t("match.logContiguous")
                : `Gaps: ${integrity.gaps.join(", ") || "—"} · Dupes: ${integrity.duplicates.join(", ") || "—"}`
            }
          >
            {integrity.ok
              ? t("match.eventsOk", { count: integrity.count })
              : t("match.integrityWarn", { count: integrity.gaps.length })}
          </span>
          {!fullLog && integrity.count > LOG_PREVIEW_ROWS && (
            <Link
              href={`${base}/matches/${matchId}?log=full`}
              className="text-xs text-score-dim underline hover:text-foreground"
            >
              {t("match.showAll", { count: integrity.count })}
            </Link>
          )}
        </div>

        {/* Filter by event type. The chips list only the types this match
            actually produced, so a beach match doesn't offer "SUBSTITUTION". */}
        {eventTypes.length > 1 && (
          <div className="mb-3">
            <Toolbar>
              <FilterChip
                href={`${base}/matches/${matchId}${fullLog ? "?log=full" : ""}`}
                active={!eventFilter}
                label={t("common.all")}
                count={allLog.length}
              />
              {eventTypes.map((ty) => (
                <FilterChip
                  key={ty}
                  href={`${base}/matches/${matchId}?event=${encodeURIComponent(ty)}${
                    fullLog ? "&log=full" : ""
                  }`}
                  active={eventFilter === ty}
                  label={ty}
                  count={allLog.filter((e) => e.eventType === ty).length}
                />
              ))}
            </Toolbar>
          </div>
        )}
        {log.length === 0 ? (
          <div className={`${ui.card} text-sm text-score-dim`}>
            {t("match.noEvents")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse">
              <thead className="bg-surface-raised">
                <tr>
                  <th className={ui.th}>#</th>
                  <th className={ui.th}>{t("match.thEvent")}</th>
                  <th className={ui.th}>{t("match.thSet")}</th>
                  <th className={ui.th}>{t("match.thScore")}</th>
                  <th className={ui.th}>{t("match.thActor")}</th>
                  <th className={ui.th}>{t("match.thTime")}</th>
                  <th className={ui.th}>{t("match.thRewind")}</th>
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
                    <td className={ui.td}>
                      {/* Can't rewind to before the match was created (#1). */}
                      {e.sequence > 1 ? (
                        <RewindToHere
                          tenantSlug={tenantSlug}
                          competitionId={competitionId}
                          matchId={matchId}
                          fromSequence={e.sequence}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </div>

        <aside className="flex flex-col gap-4">
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
        {scorerLink && scorerLinkQr && (
          <div className={ui.card}>
            <h2 className="mb-1 font-medium">{t("match.scorerLink")}</h2>
            <p className="mb-3 text-[11px] text-score-dim">
              {t("match.scorerLinkHint")}
            </p>
            <div
              className="mx-auto w-28 overflow-hidden rounded bg-white p-2 [&_svg]:h-full [&_svg]:w-full"
              // qrcode emits a trusted, self-generated SVG string.
              dangerouslySetInnerHTML={{ __html: scorerLinkQr }}
            />
            <div className="mt-2 text-center">
              <CopyButton text={scorerLink} label={t("match.copyScorerLink")} />
            </div>
          </div>
        )}
      </div>

      {/* Officials for the scoresheet APPROVAL block (spec/21). */}
      <div className="mt-6 flex max-w-2xl flex-col gap-4">
        <MatchOfficialsForm
          referees={officialsPickers.referees}
          scorers={officialsPickers.scorers}
          tenantSlug={tenantSlug}
          competitionId={competitionId}
          matchId={matchId}
          officials={officials}
        />
        {/* VIS join key for the VSR live feed (spec/22). */}
        <MatchVisIdForm
          tenantSlug={tenantSlug}
          competitionId={competitionId}
          matchId={matchId}
          visId={match.visId}
        />
      </div>

        {/* Team tablet QR tokens */}
        <div className={ui.card}>
          <h2 className="mb-1 font-medium">{t("match.tabletAccess")}</h2>
          {config.teamTabletEnabled ? (
            <>
              <p className="mb-4 text-xs text-score-dim">
                {t("match.tabletHint")}
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
                      {t("match.generateQr", {
                        team: team === "A" ? match.teamAName : match.teamBName,
                      })}
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
                        {t("match.teamLabel", { team: session.team })}
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
                        confirm={t("match.revokeConfirm", { team: session.team })}
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
                          {t("match.revoke")}
                        </button>
                      </ActionForm>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-score-dim">
              {t("match.tabletsDisabled")}
            </p>
          )}
        </div>
        </aside>
      </div>
    </Page>
  );
}
