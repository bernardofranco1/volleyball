// Official-scoresheet data layer (spec/21 Phase B).
//
// Everything the FIVB indoor and beach sheets print per set — service rounds,
// substitutions with scores at change, timeout scores, court switches, TTO
// flags, sanctions, coin tosses, improper requests — is reconstructed from the
// SURVIVING raw event log (same UNDO/REWIND semantics as the engine replay in
// src/engine/core/factories.ts, applied to event rows here). Pure: no DB, no
// PDF; the renderers consume the result.

import type { ReportEvent, MatchReportData, ReportPlayer } from "@/lib/match-report";

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
  /** Pre-match coin toss (COIN_TOSS event). */
  tossWinnerSet1: TeamId | null;
  forfeit: { team: TeamId; reason: string } | null;
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
  const memberMark = (id: unknown): string | null => {
    if (typeof id !== "string") return null;
    const staff = staffMark.get(id);
    if (staff) return staff;
    const n = jerseyOf.get(id);
    return n == null ? null : String(n);
  };

  const events = survivingEvents(report.events);
  const isBeach = report.discipline === "BEACH";
  const positions = isBeach ? 2 : 6;

  const sets: SheetSetData[] = [];
  const sanctions: SheetSanction[] = [];
  const improperRequests: { team: TeamId; setNumber: number }[] = [];
  let tossWinnerSet1: TeamId | null = null;
  let forfeit: { team: TeamId; reason: string } | null = null;
  const remarks: string[] = [];

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

  for (const ev of events) {
    const p = (ev.payload ?? {}) as Record<string, unknown> & { type?: string };
    const type = p.type ?? ev.eventType;
    const team = (p.team === "A" || p.team === "B" ? p.team : null) as TeamId | null;
    const evScore = { a: num(ev.scoreAfterA), b: num(ev.scoreAfterB) };

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
        if (team)
          forfeit = {
            team,
            reason: typeof p.reason === "string" ? p.reason : "FORFEIT",
          };
        break;
      }

      case "ROTATION_FAULT":
      case "SERVICE_ORDER_FAULT": {
        // Auto-composed remark (spec/29 F13). The point the fault awarded is an
        // ordinary rally and shows in the ladder; this line says why.
        if (team) {
          const setNo = ev.setNumber ?? cur?.setNumber ?? sets.length;
          const what =
            type === "ROTATION_FAULT" ? "Rotation fault" : "Service order fault";
          remarks.push(
            `Set ${setNo}: ${what} — team ${team} at ${evScore.a}:${evScore.b}.`,
          );
        }
        break;
      }

      case "SET_DEFAULT": {
        // A defaulted set has no ladder of its own to explain it, so it goes to
        // REMARKS with the set and the score at the moment (spec/29 F14). The
        // set itself closes through SET_END and prints in the RESULTS block
        // like any other.
        if (team) {
          const setNo = ev.setNumber ?? cur?.setNumber ?? sets.length;
          remarks.push(
            `Set ${setNo}: team ${team} incomplete at ${evScore.a}:${evScore.b} — set awarded to ${team === "A" ? "B" : "A"}.`,
          );
        }
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

  return { sets, sanctions, improperRequests, tossWinnerSet1, forfeit, remarks };
}

export type { ReportPlayer };
