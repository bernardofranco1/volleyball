/**
 * Day index for a VIS-linked competition (spec/34): every match of the event,
 * grouped by its venue-local date, each linking to its board.
 *
 * Public, like the rest of /t/{slug}/scoreboard — venue staff open this on a
 * laptop to send the right court to the right screen.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant";
import { getT } from "@/lib/i18n/server";
import { getMatchList, getVisCompetition } from "@/lib/vis-live/store";
import type { VisMatchSummary } from "@/lib/vis-live/board-data";

export const dynamic = "force-dynamic";
// The index is glanced at, not watched — a plain reload keeps it current
// without a client bundle.
export const revalidate = 0;

export default async function VisIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; competitionId: string }>;
}) {
  const { tenantSlug, competitionId } = await params;
  const { t } = await getT();
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();
  const comp = await getVisCompetition(tenant.id, competitionId);
  if (!comp) notFound();

  let matches: VisMatchSummary[] = [];
  let error: string | null = null;
  let ageSeconds = 0;
  try {
    const res = await getMatchList(comp.visTournamentNo);
    matches = res.value;
    ageSeconds = res.ageSeconds;
  } catch (err) {
    error = err instanceof Error ? err.message : "VIS unavailable";
  }

  // Group by venue-local date, dates ascending, live matches first within a day.
  const byDate = new Map<string, VisMatchSummary[]>();
  for (const m of matches) {
    const key = m.dateLocal ?? "—";
    const list = byDate.get(key) ?? [];
    list.push(m);
    byDate.set(key, list);
  }
  const dates = [...byDate.keys()].sort();
  const rank = { LIVE: 0, UPCOMING: 1, FINISHED: 2 } as const;

  const base = `/t/${tenantSlug}/scoreboard/vis/${competitionId}`;

  return (
    <main className="min-h-screen bg-surface px-6 py-8 text-foreground">
      <header className="mx-auto max-w-4xl">
        <p className="text-xs uppercase tracking-widest text-score-dim">
          {t("visBoard.eyebrow")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{comp.name}</h1>
        <p className="mt-1 text-sm text-score-dim">
          {[comp.city, comp.country].filter(Boolean).join(", ")}
          {matches.length > 0
            ? ` · ${t("visBoard.matchCount", { count: matches.length })}`
            : ""}
          {ageSeconds > 0
            ? ` · ${t("visBoard.updatedAgo", { seconds: ageSeconds })}`
            : ""}
        </p>
      </header>

      {error ? (
        <p className="mx-auto mt-8 max-w-4xl rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {t("visBoard.visUnavailable", { error })}
        </p>
      ) : null}

      <div className="mx-auto mt-6 max-w-4xl space-y-8">
        {dates.map((date) => (
          <section key={date}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-score-dim">
              {date}{" "}
              <span className="font-normal">{t("visBoard.localDate")}</span>
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {byDate
                .get(date)!
                .slice()
                .sort(
                  (a, b) =>
                    rank[a.status] - rank[b.status] ||
                    (a.timeLocal ?? "").localeCompare(b.timeLocal ?? ""),
                )
                .map((m) => (
                  <li key={m.matchNo}>
                    <Link
                      href={`${base}/${m.matchNo}`}
                      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-raised"
                    >
                      <span className="w-12 shrink-0 font-mono text-sm tabular-nums text-score-dim">
                        {m.timeLocal ?? "—"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {m.teamAName} <span className="text-score-dim">v</span>{" "}
                        {m.teamBName}
                      </span>
                      {m.resultText ? (
                        <span className="shrink-0 font-mono text-sm tabular-nums">
                          {m.resultText}
                        </span>
                      ) : null}
                      <StatusChip status={m.status} t={t} />
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

function StatusChip({
  status,
  t,
}: {
  status: VisMatchSummary["status"];
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const style =
    status === "LIVE"
      ? "border-red-400 bg-red-500/15 text-red-300"
      : status === "FINISHED"
        ? "border-border bg-surface-raised text-score-dim"
        : "border-sky-400/60 bg-sky-500/10 text-sky-300";
  const label =
    status === "LIVE"
      ? t("visBoard.statusLive")
      : status === "FINISHED"
        ? t("visBoard.statusFinal")
        : t("visBoard.statusScheduled");
  return (
    <span
      className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style}`}
    >
      {label}
    </span>
  );
}
