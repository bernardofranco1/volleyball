/**
 * "Is the scoreboard going to work?" — every dependency, checked (spec/41).
 *
 * The chain a live board depends on, in request order: the venue's own
 * connection, this deployment, the database, our VIS integration (the allowlist
 * and the payload cache), VIS itself, and the artwork. The first of those is
 * measured in the BROWSER, because no server can see a hall's wifi; everything
 * below is measured here.
 *
 * Two rules this module is built around:
 *
 * 1. **Green must mean something.** Each check rules out a distinct failure, and
 *    none is green when the thing it stands for is broken. In particular
 *    `feed` is separate from `vis`: VIS can answer every request perfectly while
 *    the scorer's laptop has stopped publishing, and that is the one incident
 *    where every other check stays green while the hall sees a frozen board.
 *
 * 2. **Watching VIS must not weigh on VIS.** The default read answers from the
 *    caches the boards already fill. A live probe is opt-in (`probe`), so a
 *    status page left open on a desk does not add a request per refresh to the
 *    upstream it is watching.
 *
 * WHICH cache this sees, and why it is the right one: Next bundles route
 * handlers and server components into separate module registries, so the store
 * has one instance per layer. This module runs as a route handler, which is the
 * same layer as `/api/vis/board/[matchNo]` — the endpoint every live viewer
 * polls. So the figures here are what viewers are actually being served, rather
 * than what a page render happened to fetch. Verified 2026-08-19: a board
 * fetched through the API appears here; one fetched by rendering the page does
 * not.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DB_SCHEMA, IS_PROD_SCHEMA } from "@/db/env";
import { competitionBranding, competitions, tenants } from "@/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { visRequest, volleyMatchListEnvelope } from "@/lib/vis-live/client";
import { visStoreSnapshot, type VisStoreSnapshot } from "@/lib/vis-live/store";
import { REPLAY_MATCH_NO } from "@/lib/vis-live/replay";

export type CheckState = "ok" | "warn" | "down" | "idle";

export interface StatusCheck {
  id: string;
  group: "platform" | "vis";
  label: string;
  detail: string;
  state: CheckState;
  /** Short right-hand figure, e.g. "18 ms" or "46 rows". */
  value: string;
}

export interface StatusMatch {
  matchNo: number;
  label: string;
  detail: string;
  state: CheckState;
  value: string;
}

export interface BoardStatus {
  checkedAt: string;
  commit: string | null;
  environment: string;
  overall: CheckState;
  headline: string;
  /** True when the VIS figures come from the cache rather than a live call. */
  fromCache: boolean;
  checks: StatusCheck[];
  matches: StatusMatch[];
  notes: string[];
}

/**
 * A live payload this old means our polling is broken, not that VIS is quiet:
 * during play the cadence is one second, so thirty is two orders of magnitude
 * late.
 */
const STALE_PAYLOAD_S = 30;
/**
 * How long a live score may sit still before it is worth remarking on.
 *
 * Deliberately generous, because volleyball is full of legitimate pauses: a
 * time-out is 30 s, a technical time-out 60 s, and a video challenge or an
 * injury can hold a set for two minutes with nothing wrong anywhere. A gap of
 * half a minute is an ordinary rally interval — warning on that would cry wolf
 * through every match and teach everyone to ignore the page, which is worse
 * than not having it.
 */
const NO_MOVEMENT_WARN_S = 90;
/** Past this, a set that is supposedly in play has stopped being published. */
const NO_MOVEMENT_DOWN_S = 240;

const ms = (t: number) => `${Math.round(t)} ms`;
const ago = (s: number) => (s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`);

async function timed<T>(work: () => Promise<T>): Promise<[T | null, number, unknown]> {
  const started = Date.now();
  try {
    return [await work(), Date.now() - started, null];
  } catch (err) {
    return [null, Date.now() - started, err];
  }
}

/** Every competition that has background artwork configured (spec/40). */
async function configuredArtwork(): Promise<{ id: string; url: string }[]> {
  const rows = await db
    .select({ id: competitionBranding.competitionId, url: competitionBranding.boardBgUrl })
    .from(competitionBranding)
    .where(isNotNull(competitionBranding.boardBgUrl));
  return rows.filter((r): r is { id: string; url: string } => !!r.url);
}

/**
 * Artwork fails SILENTLY by design — CSS falls through a background it cannot
 * load, which is what stops a missing file blanking a screen. The cost is that
 * a competition pointed at a dead URL looks fine to the code and wrong in the
 * hall, so this is the one place it can surface. Only explicitly configured
 * URLs are checked: the file convention 404s legitimately for most
 * competitions, and reporting that would be noise.
 */
async function checkArtwork(origin: string): Promise<StatusCheck> {
  const [art, , err] = await timed(configuredArtwork);
  if (err || !art) {
    return {
      id: "artwork", group: "platform", label: "Competition artwork",
      detail: "could not read the configured backgrounds", state: "warn", value: "unknown",
    };
  }
  if (art.length === 0) {
    return {
      id: "artwork", group: "platform", label: "Competition artwork",
      detail: "no competition overrides the built-in artwork", state: "idle", value: "none set",
    };
  }
  const results = await Promise.all(
    art.map(async (a) => {
      const url = a.url.startsWith("/") ? `${origin}${a.url}` : a.url;
      const [res] = await timed(() =>
        fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000), cache: "no-store" }),
      );
      return { id: a.id, ok: !!res && res.ok };
    }),
  );
  const bad = results.filter((r) => !r.ok);
  return {
    id: "artwork", group: "platform", label: "Competition artwork",
    detail: bad.length
      ? `${bad.length} of ${art.length} background URLs unreachable`
      : `${art.length} configured background${art.length === 1 ? "" : "s"} reachable`,
    state: bad.length ? "warn" : "ok",
    value: bad.length ? bad.map((b) => b.id).join(", ") : "all reachable",
  };
}

function visChecks(
  snap: VisStoreSnapshot,
  probe: { ok: boolean; ms: number; rows: number; error: string | null } | null,
): StatusCheck[] {
  const out: StatusCheck[] = [];

  if (probe) {
    out.push({
      id: "vis-endpoint", group: "vis", label: "VIS endpoint",
      detail: "fivb.org/Vis2009/XmlRequest.asmx",
      state: probe.ok ? "ok" : "down",
      value: probe.ok ? ms(probe.ms) : (probe.error ?? "unreachable"),
    });
    out.push({
      id: "vis-auth", group: "vis", label: "VIS credentials",
      detail: probe.ok ? "the app id was accepted" : "no answer to authenticate against",
      state: probe.ok ? "ok" : "down",
      value: probe.ok ? "authorised" : "unknown",
    });
  } else {
    out.push({
      id: "vis-endpoint", group: "vis", label: "VIS endpoint",
      detail: "not called — reading from cache so watching VIS does not weigh on VIS",
      state: "idle", value: "probe to test",
    });
  }

  const lists = snap.matchLists;
  const freshest = lists.length ? Math.min(...lists.map((l) => l.ageSeconds)) : null;
  const rows = probe?.rows ?? lists.reduce((n, l) => n + l.rows, 0);
  out.push({
    id: "vis-lists", group: "vis", label: "Match lists",
    detail: lists.length
      ? `${lists.length} tournament${lists.length === 1 ? "" : "s"} cached`
      : "nothing cached on this instance yet",
    state: lists.length === 0 ? "idle" : freshest! > 15 * 60 ? "warn" : "ok",
    value: lists.length ? `${rows} rows · ${ago(freshest!)}` : "—",
  });

  // The check that matters: is VIS PUBLISHING, or merely answering?
  const live = snap.boards.filter((b) => b.status === "LIVE" && !b.inSetBreak);
  if (live.length === 0) {
    out.push({
      id: "vis-feed", group: "vis", label: "Live feed advancing",
      detail: "no match is being played right now",
      state: "idle", value: "nothing live",
    });
  } else {
    const best = Math.min(...live.map((b) => b.sinceChangeSeconds));
    out.push({
      id: "vis-feed", group: "vis", label: "Live feed advancing",
      detail: "score, sets or serve moved recently",
      state:
        best > NO_MOVEMENT_DOWN_S ? "down" : best > NO_MOVEMENT_WARN_S ? "warn" : "ok",
      value: `last change ${ago(best)}`,
    });
  }
  return out;
}

export async function readBoardStatus(opts: {
  origin: string;
  probe: boolean;
  now?: number;
}): Promise<BoardStatus> {
  const now = opts.now ?? Date.now();
  const snap = visStoreSnapshot(now);
  const notes: string[] = [];

  const [dbRow, dbMs, dbErr] = await timed(() => db.execute(sql`select 1`));
  const dbOk = !dbErr && !!dbRow;

  const [comps] = await timed(() =>
    db
      .select({ id: competitions.id })
      .from(competitions)
      .innerJoin(tenants, eq(tenants.id, competitions.tenantId))
      .where(isNotNull(competitions.visTournamentNo)),
  );

  let probe: { ok: boolean; ms: number; rows: number; error: string | null } | null = null;
  if (opts.probe) {
    const tournament = snap.matchLists[0]?.tournamentNo ?? 1670;
    const [xml, took, err] = await timed(() => visRequest(volleyMatchListEnvelope(tournament)));
    probe = {
      ok: !err && !!xml,
      ms: took,
      rows: xml ? (xml.match(/<VolleyballMatch\b/g) ?? []).length : 0,
      error: err instanceof Error ? err.message.slice(0, 80) : err ? "failed" : null,
    };
  }

  const checks: StatusCheck[] = [
    {
      id: "db", group: "platform", label: "Database",
      detail: `Supabase · ${DB_SCHEMA} schema`,
      state: dbOk ? (dbMs > 1500 ? "warn" : "ok") : "down",
      value: dbOk ? ms(dbMs) : "unreachable",
    },
    {
      id: "allowlist", group: "platform", label: "Match allowlist",
      detail: snap.allowlist
        ? `${comps?.length ?? 0} competitions · ${snap.allowlist.matches} matches`
        : "not built on this instance yet — the first board request builds it",
      state: snap.allowlist ? "ok" : "idle",
      value: snap.allowlist ? `built ${ago(snap.allowlist.ageSeconds)}` : "not built",
    },
    await checkArtwork(opts.origin),
    ...visChecks(snap, probe),
  ];

  const matches: StatusMatch[] = snap.boards
    .slice()
    .sort((a, b) => rank(a.status) - rank(b.status) || a.matchNo - b.matchNo)
    .map((b) => {
      const live = b.status === "LIVE";
      // The replay board (spec/44) is a real previous match on a permanent
      // loop. It is cached and served like any other, so it belongs in this
      // list — but it must be impossible to mistake for a fixture being played
      // tonight, and its "score has not moved" reading means nothing.
      const isReplay = b.matchNo === REPLAY_MATCH_NO;
      return {
        matchNo: b.matchNo,
        label: isReplay ? `REPLAY · ${b.teamA} v ${b.teamB}` : `${b.teamA} v ${b.teamB}`,
        detail: [
          isReplay ? "validation loop · never touches VIS" : `#${b.matchNo}`,
          live ? (b.inSetBreak ? "set break" : `set ${b.currentSet ?? "—"}`) : b.status.toLowerCase(),
          live ? `${b.scoreA}-${b.scoreB}` : null,
        ].filter(Boolean).join(" · "),
        state: isReplay ? "idle" : gradeMatch(b),
        value: live
          ? `poll ${Math.round(b.pollMs / 1000)} s · payload ${b.ageSeconds} s old`
          : `payload ${ago(b.ageSeconds)}`,
      };
    });

  notes.push(
    snap.boards.length === 0
      ? "Nothing is cached on this instance. That is not the same as nothing being served: these caches are per serverless instance, so a board in a hall may be running against another one."
      : "Cache figures are per serverless instance. This is the same cache the boards themselves poll, so it is what viewers are being served — but a screen in the hall may be talking to a different instance.",
  );
  if (!opts.probe) {
    notes.push(
      "VIS was not called for this read — the figures come from the caches the boards already fill, so a status page left open does not add load to the feed it is watching.",
    );
  }

  const worst = pickWorst(checks.map((c) => c.state).concat(matches.map((m) => m.state)));
  return {
    checkedAt: new Date(now).toISOString(),
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    environment: IS_PROD_SCHEMA ? "production" : "homologation",
    overall: worst,
    headline: headlineFor(worst, matches),
    fromCache: !opts.probe,
    checks,
    matches,
    notes,
  };
}

const rank = (s: string) => (s === "LIVE" ? 0 : s === "UPCOMING" ? 1 : 2);

/**
 * How a single match reads.
 *
 * A frozen feed outranks a stale payload: a board can be one second behind a
 * VIS that stopped publishing ten minutes ago, and payload age alone would call
 * that perfectly healthy. A set break is not frozen — nothing is supposed to
 * move — and a finished or scheduled match is idle, never down.
 */
function gradeMatch(b: {
  status: "UPCOMING" | "LIVE" | "FINISHED";
  inSetBreak: boolean;
  ageSeconds: number;
  sinceChangeSeconds: number;
}): CheckState {
  if (b.status !== "LIVE") return "idle";
  if (!b.inSetBreak && b.sinceChangeSeconds > NO_MOVEMENT_DOWN_S) return "down";
  if (b.ageSeconds > STALE_PAYLOAD_S) return "warn";
  if (!b.inSetBreak && b.sinceChangeSeconds > NO_MOVEMENT_WARN_S) return "warn";
  return "ok";
}

/** Pure graders, exported for the tests that pin what green means. */
export const __statusInternals = { pickWorst, headlineFor, gradeMatch };

function pickWorst(states: CheckState[]): CheckState {
  if (states.includes("down")) return "down";
  if (states.includes("warn")) return "warn";
  return states.some((s) => s === "ok") ? "ok" : "idle";
}

function headlineFor(worst: CheckState, matches: StatusMatch[]): string {
  const live = matches.filter((m) => m.state !== "idle").length;
  if (worst === "down") return "Boards are not updating";
  if (worst === "warn") return "Boards are live, but something needs looking at";
  if (worst === "idle") return "Nothing live right now";
  return live > 0 ? "Boards are live" : "Everything healthy";
}
