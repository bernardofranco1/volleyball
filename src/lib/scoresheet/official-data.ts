// Official-scoresheet data layer (spec/21 Phase B).
//
// Everything the FIVB indoor and beach sheets print per set — service rounds,
// substitutions with scores at change, timeout scores, court switches, TTO
// flags, sanctions, coin tosses, improper requests — is reconstructed from the
// SURVIVING raw event log (same UNDO/REWIND semantics as the engine replay in
// src/engine/core/factories.ts, applied to event rows here). Pure: no DB, no
// PDF; the renderers consume the result.

import type { ReportEvent, MatchReportData, ReportPlayer } from "@/lib/match-report";
import { remark, type RemarkContext } from "./remarks";

type TeamId = "A" | "B";

/** One service-round entry: the team's score written when its server lost the
 *  serve (or, circled, the team's final score at set end). */
export interface ServiceEntry {
  /** Indoor: rotation column 0..5 (service order I..VI). Beach: player slot 0..1. */
  col: number;
  /** Indoor: service round row 0-based. Beach: index within the player's row. */
  round: number;
  score: number;
  circled: boolean;
}

export interface SheetSubstitution {
  /** Rotation column (0..5) of the affected starter's slot; -1 if unknown. */
  col: number;
  inJersey: number | null;
  outJersey: number | null;
  score: { a: number; b: number };
  /** Set when the starter came back (the sheet circles the sub + 2nd score). */
  returnScore: { a: number; b: number } | null;
}

export interface SheetTimeout {
  team: TeamId;
  score: { a: number; b: number };
}

export interface SheetSwitch {
  score: { a: number; b: number };
  tto: boolean;
}

export interface SheetSanction {
  kind:
    | "DELAY_WARNING"
    | "DELAY_PENALTY"
    | "MISCONDUCT_WARNING"
    | "MISCONDUCT_PENALTY"
    | "MISCONDUCT_EXPULSION"
    | "MISCONDUCT_DISQUALIFICATION";
  team: TeamId;
  jersey: number | null; // null = team-level (delay) sanction
  /**
   * What goes in the grid's "player" column (FIVB sanction grid): the jersey
   * number for a player, the function letter for a bench official (spec/29
   * F1/F2 — a coach takes cards too, and has no number), and null for a
   * team-level delay sanction.
   */
  member: string | null;
  setNumber: number;
  score: { a: number; b: number };
}

export interface SheetSetData {
  setNumber: number;
  scoreA: number;
  scoreB: number;
  winner: TeamId | null;
  startedAt: Date | null;
  endedAt: Date | null;
  firstServer: TeamId | null;
  teamAStartSide: "LEFT" | "RIGHT" | null;
  /** Indoor: starting six as jersey numbers (pos I..VI). Empty when unknown. */
  lineupA: (number | null)[];
  lineupB: (number | null)[];
  /** Beach: the two players in service-order slots [first server, partner]. */
  serviceOrderA: (number | null)[];
  serviceOrderB: (number | null)[];
  serviceA: ServiceEntry[];
  serviceB: ServiceEntry[];
  subsA: SheetSubstitution[];
  subsB: SheetSubstitution[];
  timeouts: SheetTimeout[];
  switches: SheetSwitch[];
  tossWinner: TeamId | null; // deciding-set re-toss (from SET_START)
}

export interface OfficialSheetData {
  sets: SheetSetData[];
  sanctions: SheetSanction[];
  improperRequests: { team: TeamId; setNumber: number }[];
  /**
   * In-match protests (spec/29 F12), in order. Separate from the APPROVAL
   * block's PROTEST signature intent, which contests the FINAL result.
   */
  protests: {
    team: TeamId;
    setNumber: number;
    score: { a: number; b: number };
    text: string | null;
  }[];
  /** Pre-match coin toss (COIN_TOSS event). */
  tossWinnerSet1: TeamId | null;
  /**
   * Match ended early (FIVB 6.4). `noShow` is the 6.4.2 default: the team
   * never played, so the sheet prints the convention scoreline (0-25 per set
   * indoor, 0-21 beach) rather than a blank ladder (spec/29 F8). A 6.4.3
   * retirement is NOT a no-show — points already played are kept.
   */
  forfeit: { team: TeamId; reason: string; noShow: boolean } | null;
  remarks: string[];
}

// ── survivors (UNDO / REWIND) ────────────────────────────────────────────────

/** Resolve UNDO/REWIND control events over the raw log — the row-level twin of
 *  the survivor pass in createReplayFn (engine/core/factories.ts): UNDO drops
 *  its target row (matched by event id), REWIND truncates every survivor past
 *  its cutoff. Neither control event survives itself. */
export function survivingEvents(events: ReportEvent[]): ReportEvent[] {
  const survivors: ReportEvent[] = [];
  for (const ev of events) {
    const p = ev.payload as { type?: string; targetEventId?: string; toSequence?: number } | null;
    const type = p?.type ?? ev.eventType;
    if (type === "UNDO") {
      const target = p?.targetEventId ?? "";
      const i = survivors.findIndex((s) => s.id === target);
      if (i !== -1) survivors.splice(i, 1);
      continue;
    }
    if (type === "REWIND") {
      const cutoff = p?.toSequence ?? Number.MAX_SAFE_INTEGER;
      for (let i = survivors.length - 1; i >= 0; i--) {
        if (survivors[i].sequence > cutoff) survivors.splice(i, 1);
      }
      continue;
    }
    survivors.push(ev);
  }
  return survivors;
}

/** A surviving event paired with the score as of that event (spec/30 Phase B). */
export interface ScoredEvent {
  event: ReportEvent;
  /** Score after this event when it is a rally; the running score otherwise. */
  score: { a: number; b: number };
}

/**
 * Resolve UNDO/REWIND **and** re-count the score, in one pass.
 *
 * Every document that states a CURRENT score has to do this, and until spec/30
 * each did its own thing: the sheet counted (spec/29 Phase 6), while the VSR
 * feed and the timings export walked the same survivors but stamped scores from
 * each row's denormalized `scoreAfter*` columns.
 *
 * Those columns are a cache written once at append time and never corrected.
 * That is harmless while undo only ever removes events from the TAIL — which
 * was true until F13's fault correction, whose entire purpose is undoing points
 * in the MIDDLE of a set. After one, every surviving later row still carries a
 * score that counted the cancelled points, so a consumer trusting the cache
 * reports a match that never happened.
 *
 * One implementation, so the sheet, the feed and the timings can never
 * disagree again. The cache remains the fallback while a set has no rally
 * events at all — imported/synthetic matches, where a declared SET_END score is
 * the only score there is.
 *
 * Audit views deliberately do NOT use this: showing what was recorded at the
 * time, and marking what was later cancelled, is their job (spec/30 Phase D).
 */
export function scoredSurvivingEvents(events: ReportEvent[]): ScoredEvent[] {
  const survivors = survivingEvents(events);
  const out: ScoredEvent[] = [];
  let running = { a: 0, b: 0 };
  let ralliesSeen = 0;

  for (const ev of survivors) {
    const p = (ev.payload ?? {}) as { type?: string };
    const type = p.type ?? ev.eventType;
    if (type === "SET_START") {
      running = { a: 0, b: 0 };
      ralliesSeen = 0;
    }
    if (type === "RALLY_WON_A") {
      running = { a: running.a + 1, b: running.b };
      ralliesSeen += 1;
    } else if (type === "RALLY_WON_B") {
      running = { a: running.a, b: running.b + 1 };
      ralliesSeen += 1;
    }
    out.push({
      event: ev,
      score:
        ralliesSeen > 0
          ? { a: running.a, b: running.b }
          : {
              a: typeof ev.scoreAfterA === "number" ? ev.scoreAfterA : 0,
              b: typeof ev.scoreAfterB === "number" ? ev.scoreAfterB : 0,
            },
    });
  }
  return out;
}

// ── main computation ─────────────────────────────────────────────────────────

const num = (v: unknown): number => (typeof v === "number" ? v : 0);

export function buildOfficialSheetData(report: MatchReportData): OfficialSheetData {
  const jerseyOf = new Map<string, number | null>();
  for (const p of [...report.rosterA, ...report.rosterB])
    jerseyOf.set(p.id, p.jerseyNumber);
  const jersey = (id: unknown): number | null =>
    typeof id === "string" ? (jerseyOf.get(id) ?? null) : null;

  // Bench officials are roster rows (spec/29 F1), so a misconduct payload's
  // `playerId` may be one of them — same id space, no payload change needed.
  // They print their function letter (C1, A1, …) where a player prints a number.
  const staffMark = new Map<string, string>();
  for (const p of [...report.rosterA, ...report.rosterB]) {
    if (p.role === "STAFF") staffMark.set(p.id, p.staffFunction ?? "C");
  }
  // Standardized REMARKS lines are composed from typed events (spec/29 Phase
  // 4) so the block stays a rendering of the log rather than a second place
  // facts are entered. Free-text NOTE keeps the scorer's own voice.
  const ctxOf = (
    ev: ReportEvent,
    extra?: { team?: TeamId; playerId?: unknown },
  ): RemarkContext => ({
    setNumber: ev.setNumber ?? cur?.setNumber ?? sets.length,
    score: { a: num(ev.scoreAfterA), b: num(ev.scoreAfterB) },
    team: extra?.team,
    member: extra?.playerId != null ? memberMark(extra.playerId) : null,
    name: nameOf(extra?.playerId),
  });
  const nameById = new Map<string, string>();
  for (const p of [...report.rosterA, ...report.rosterB])
    nameById.set(p.id, p.jerseyName);
  const nameOf = (id: unknown): string | null =>
    typeof id === "string" ? (nameById.get(id) ?? null) : null;

  const memberMark = (id: unknown): string | null => {
    if (typeof id !== "string") return null;
    const staff = staffMark.get(id);
    if (staff) return staff;
    const n = jerseyOf.get(id);
    return n == null ? null : String(n);
  };

  const scored = scoredSurvivingEvents(report.events);
  const isBeach = report.discipline === "BEACH";
  const positions = isBeach ? 2 : 6;

  const sets: SheetSetData[] = [];
  const sanctions: SheetSanction[] = [];
  const improperRequests: { team: TeamId; setNumber: number }[] = [];
  const protests: OfficialSheetData["protests"] = [];
  let tossWinnerSet1: TeamId | null = null;
  let forfeit: OfficialSheetData["forfeit"] = null;
  const remarks: string[] = [];
  // Recoveries per player, so the remark can say "#2 for this player" (F11).
  const recoveryCount = new Map<string, number>();

  // Per-set walk state.
  let cur: SheetSetData | null = null;
  let server: TeamId | null = null;
  let turns: Record<TeamId, number> = { A: 0, B: 0 };
  let score = { a: 0, b: 0 };
  // Sub slots: starterId → current substitute playerId (indoor).
  let slots: Record<TeamId, Map<string, string>> = { A: new Map(), B: new Map() };
  let lineupIds: Record<TeamId, string[]> = { A: [], B: [] };
  // Open sub records by substitute playerId, to attach the return score.
  let openSubs: Record<TeamId, Map<string, SheetSubstitution>> = {
    A: new Map(),
    B: new Map(),
  };
  let pendingTTO = false;
  // The row/column position of each team's CURRENT server (in-progress or
  // most recent service turn). The set-end circle belongs there — "the player
  // that served the last time the team scored" — not on the next server.
  let serverSlot: Record<TeamId, { col: number; round: number } | null> = {
    A: null,
    B: null,
  };
  // Lineups confirmed before their SET_START (defensive: the indoor engine
  // confirms them after SET_START, but replay edges can reorder).
  const pendingLineups: Record<TeamId, (number | null)[]> = { A: [], B: [] };
  const pendingLineupIds: Record<TeamId, string[]> = { A: [], B: [] };

  /** Column + round for team X's k-th service turn (0-based). The receiving
   *  team's round-1/pos-I box is the crossed-out one, so its turns shift one
   *  position (the paper convention: entries start under column II). */
  const posOf = (team: TeamId, k: number): { col: number; round: number } => {
    if (!cur || !cur.firstServer) return { col: k % positions, round: Math.floor(k / positions) };
    const offset = team === cur.firstServer ? 0 : isBeach ? 0 : 1;
    return {
      col: (k + offset) % positions,
      round: Math.floor((k + offset) / positions),
    };
  };

  const sideOut = (loser: TeamId) => {
    if (!cur) return;
    const { col, round } = serverSlot[loser] ?? posOf(loser, turns[loser]);
    const entry: ServiceEntry = {
      col,
      round,
      score: loser === "A" ? score.a : score.b,
      circled: false,
    };
    (loser === "A" ? cur.serviceA : cur.serviceB).push(entry);
    turns[loser] += 1;
  };

  /** `team` gains the right to serve — its upcoming turn's position becomes
   *  the current server slot. */
  const gainServe = (team: TeamId) => {
    serverSlot[team] = posOf(team, turns[team]);
  };

  const resetSetState = () => {
    server = null;
    turns = { A: 0, B: 0 };
    score = { a: 0, b: 0 };
    slots = { A: new Map(), B: new Map() };
    lineupIds = { A: [], B: [] };
    openSubs = { A: new Map(), B: new Map() };
    pendingTTO = false;
    serverSlot = { A: null, B: null };
  };

  // Scores are COUNTED from the surviving rallies, never read off each row's
  // denormalized cache — see scoredSurvivingEvents above for why.
  for (const { event: ev, score: evScore } of scored) {
    const p = (ev.payload ?? {}) as Record<string, unknown> & { type?: string };
    const type = p.type ?? ev.eventType;
    const team = (p.team === "A" || p.team === "B" ? p.team : null) as TeamId | null;

    switch (type) {
      case "COIN_TOSS": {
        if (p.tossWinner === "A" || p.tossWinner === "B")
          tossWinnerSet1 = p.tossWinner;
        break;
      }

      case "SET_START": {
        resetSetState();
        cur = {
          setNumber: num(p.setNumber) || sets.length + 1,
          scoreA: 0,
          scoreB: 0,
          winner: null,
          startedAt: ev.timestamp ?? null,
          endedAt: null,
          firstServer: p.firstServer === "B" ? "B" : p.firstServer === "A" ? "A" : null,
          teamAStartSide:
            p.teamAStartSide === "LEFT" || p.teamAStartSide === "RIGHT"
              ? p.teamAStartSide
              : null,
          lineupA: [],
          lineupB: [],
          serviceOrderA: [],
          serviceOrderB: [],
          serviceA: [],
          serviceB: [],
          subsA: [],
          subsB: [],
          timeouts: [],
          switches: [],
          tossWinner:
            p.tossWinner === "A" || p.tossWinner === "B" ? p.tossWinner : null,
        };
        sets.push(cur);
        server = cur.firstServer;
        if (server) gainServe(server);
        // Consume any lineup confirmed while no set was open.
        for (const t of ["A", "B"] as const) {
          if (pendingLineups[t].length) {
            if (t === "A") cur.lineupA = pendingLineups[t];
            else cur.lineupB = pendingLineups[t];
            lineupIds[t] = pendingLineupIds[t];
            pendingLineups[t] = [];
            pendingLineupIds[t] = [];
          }
        }
        break;
      }

      case "LINEUP_CONFIRMED": {
        if (!team) break;
        const ids = Array.isArray(p.playerIds) ? (p.playerIds as string[]) : [];
        lineupIds[team] = ids;
        const jerseys = ids.map((id) => jersey(id));
        // A lineup may arrive before SET_START (LINEUP_PENDING phase); park it
        // on the set once it exists.
        if (cur) {
          if (team === "A") cur.lineupA = jerseys;
          else cur.lineupB = jerseys;
        } else {
          // Pre-set lineup: attach when the set starts (store and re-apply).
          pendingLineups[team] = jerseys;
          pendingLineupIds[team] = ids;
        }
        break;
      }

      case "SERVICE_ORDER": {
        if (!cur || !team) break;
        const firstId = typeof p.firstServerPlayerId === "string" ? p.firstServerPlayerId : null;
        const roster = team === "A" ? report.rosterA : report.rosterB;
        const first = roster.find((r) => r.id === firstId) ?? null;
        const other = roster.find((r) => r.id !== firstId) ?? null;
        const order = [first?.jerseyNumber ?? null, other?.jerseyNumber ?? null];
        if (team === "A") cur.serviceOrderA = order;
        else cur.serviceOrderB = order;
        break;
      }

      case "RALLY_WON_A":
      case "RALLY_WON_B": {
        if (!cur) break;
        const winnerTeam: TeamId = type === "RALLY_WON_A" ? "A" : "B";
        if (server && server !== winnerTeam) {
          // Side-out: the previous server's score is written on the sheet.
          score = { a: evScore.a, b: evScore.b };
          // Record with the loser's score BEFORE this rally == unchanged by
          // the opponent's point, so post-rally denorms are safe to use.
          sideOut(server);
          server = winnerTeam;
          gainServe(winnerTeam);
        } else {
          score = { a: evScore.a, b: evScore.b };
          if (!server) {
            server = winnerTeam;
            gainServe(winnerTeam);
          }
        }
        cur.scoreA = score.a;
        cur.scoreB = score.b;
        break;
      }

      case "TIMEOUT_REQUEST": {
        if (cur && team) cur.timeouts.push({ team, score: evScore });
        break;
      }

      case "TTO_START": {
        // The TTO belongs to the court switch at the SAME score. The engine
        // auto-emits SIDE_SWITCH before TTO_START at the trigger sum, so flag
        // the switch already recorded; keep the pending path for the reverse
        // order.
        const last = cur?.switches[cur.switches.length - 1];
        if (last && last.score.a === evScore.a && last.score.b === evScore.b) {
          last.tto = true;
        } else {
          pendingTTO = true;
        }
        break;
      }

      case "SIDE_SWITCH": {
        if (cur) {
          cur.switches.push({ score: evScore, tto: pendingTTO });
          pendingTTO = false;
        }
        break;
      }

      case "SUBSTITUTION": {
        if (!cur || !team) break;
        const outId = typeof p.outPlayerId === "string" ? p.outPlayerId : "";
        const inId = typeof p.inPlayerId === "string" ? p.inPlayerId : "";
        const lineup = lineupIds[team];
        const subs = team === "A" ? cur.subsA : cur.subsB;
        const open = openSubs[team];
        const returning = open.get(outId);
        if (returning && lineup.includes(inId)) {
          // Starter returns: circle the sub and stamp the second score.
          returning.returnScore = evScore;
          open.delete(outId);
          slots[team].delete(inId);
        } else {
          const col = lineup.indexOf(outId);
          const rec: SheetSubstitution = {
            col,
            inJersey: jersey(inId),
            outJersey: jersey(outId),
            score: evScore,
            returnScore: null,
          };
          subs.push(rec);
          open.set(inId, rec);
          if (col >= 0 && lineup[col]) slots[team].set(lineup[col], inId);
        }
        // Rule 15.7 (spec/29 F9): an exceptional substitution has no cell of
        // its own on the sheet — the sub boxes look like any other — so the
        // REMARKS line is the only thing that says it did not count.
        if (p.isExceptional === true || p.isEmergency === true) {
          remarks.push(
            remark.exceptionalSubstitution(
              ctxOf(ev, { team, playerId: outId }),
              [memberMark(inId), nameOf(inId)].filter(Boolean).join(" ") || null,
            ),
          );
        }
        break;
      }

      case "MEDICAL_TIMEOUT": {
        // Recovery with the player and the score (spec/29 F11).
        if (team) {
          const pid = typeof p.playerId === "string" ? p.playerId : undefined;
          if (pid) recoveryCount.set(pid, (recoveryCount.get(pid) ?? 0) + 1);
          remarks.push(
            remark.recovery(
              ctxOf(ev, { team, playerId: pid }),
              pid ? recoveryCount.get(pid) : undefined,
            ),
          );
        }
        break;
      }

      case "LIBERO_REDESIGNATION": {
        // Rule 19.4.2 (spec/29 F10).
        if (team) {
          const nid = typeof p.newLiberoId === "string" ? p.newLiberoId : null;
          remarks.push(
            remark.liberoRedesignation(
              ctxOf(ev, { team }),
              nid ? [memberMark(nid), nameOf(nid)].filter(Boolean).join(" ") : null,
            ),
          );
        }
        break;
      }

      case "SET_END": {
        if (!cur) break;
        const winner: TeamId | null =
          p.winner === "A" ? "A" : p.winner === "B" ? "B" : null;
        cur.winner = winner;
        cur.endedAt = ev.timestamp ?? null;
        cur.scoreA = num(p.scoreA) || cur.scoreA;
        cur.scoreB = num(p.scoreB) || cur.scoreB;
        // Paper convention at set end: each team's final score is CIRCLED in
        // the row of its CURRENT server — the player who served the last time
        // the team held serve — never the next server. If the final rally
        // side-outed that team, the side-out already wrote the same score in
        // that row: circle it instead of duplicating.
        for (const t of ["A", "B"] as const) {
          const pos = serverSlot[t] ?? posOf(t, 0);
          const final = t === "A" ? cur.scoreA : cur.scoreB;
          const list = t === "A" ? cur.serviceA : cur.serviceB;
          const last = list[list.length - 1];
          if (last && last.col === pos.col && last.score === final && !last.circled) {
            last.circled = true;
          } else {
            list.push({ col: pos.col, round: pos.round, score: final, circled: true });
          }
        }
        cur = null;
        break;
      }

      case "DELAY_WARNING":
      case "DELAY_PENALTY": {
        if (team)
          sanctions.push({
            kind: type,
            team,
            jersey: null,
            member: null,
            setNumber: ev.setNumber ?? cur?.setNumber ?? sets.length,
            score: evScore,
          });
        break;
      }

      case "MISCONDUCT_WARNING":
      case "MISCONDUCT_PENALTY":
      case "MISCONDUCT_EXPULSION":
      case "MISCONDUCT_DISQUALIFICATION": {
        if (team)
          sanctions.push({
            kind: type,
            team,
            jersey: jersey(p.playerId),
            member: memberMark(p.playerId),
            setNumber: ev.setNumber ?? cur?.setNumber ?? sets.length,
            score: evScore,
          });
        break;
      }

      case "IMPROPER_REQUEST": {
        if (team)
          improperRequests.push({
            team,
            setNumber: ev.setNumber ?? cur?.setNumber ?? sets.length,
          });
        break;
      }

      case "FORFEIT": {
        if (team) {
          const reason = typeof p.reason === "string" ? p.reason : "FORFEIT";
          // A no-show is a FORFEIT with nothing played: no set has a score and
          // none was won. A retirement, or a forfeit after play began, keeps
          // the real ladder.
          const nothingPlayed =
            sets.length === 0 ||
            sets.every((st) => st.scoreA === 0 && st.scoreB === 0);
          forfeit = { team, reason, noShow: reason === "FORFEIT" && nothingPlayed };
          // The RESULTS block prints the outcome; the remark says when it
          // happened and at what score (spec/29 F8).
          remarks.push(remark.forfeit(ctxOf(ev, { team }), reason));
        }
        break;
      }

      case "ROTATION_FAULT":
      case "SERVICE_ORDER_FAULT": {
        // Auto-composed remark (spec/29 F13). The point the fault awarded is an
        // ordinary rally and shows in the ladder; this line says why.
        if (team)
          remarks.push(
            remark.positionalFault(
              ctxOf(ev, { team }),
              type === "ROTATION_FAULT" ? "ROTATION" : "SERVICE_ORDER",
            ),
          );
        break;
      }

      case "PROTEST_LODGED": {
        // Printed through the composer (spec/29 F12). Kept separate from the
        // APPROVAL block's PROTEST intent, which is about the final result.
        if (team) {
          const pid = typeof p.playerId === "string" ? p.playerId : undefined;
          protests.push({
            team,
            setNumber: ev.setNumber ?? cur?.setNumber ?? sets.length,
            score: evScore,
            text: typeof p.text === "string" ? p.text.trim() || null : null,
          });
          remarks.push(
            remark.protest(
              ctxOf(ev, { team, playerId: pid }),
              typeof p.text === "string" ? p.text : null,
            ),
          );
        }
        break;
      }

      case "SET_DEFAULT": {
        // A defaulted set has no ladder of its own to explain it, so it goes to
        // REMARKS with the set and the score at the moment (spec/29 F14). The
        // set itself closes through SET_END and prints in the RESULTS block
        // like any other.
        if (team) remarks.push(remark.setDefault(ctxOf(ev, { team })));
        break;
      }

      case "NOTE": {
        if (typeof p.text === "string" && p.text.trim())
          remarks.push(p.text.trim());
        break;
      }

      default:
        break;
    }
  }

  return {
    sets,
    sanctions,
    improperRequests,
    protests,
    tossWinnerSet1,
    forfeit,
    remarks,
  };
}

export type { ReportPlayer };
