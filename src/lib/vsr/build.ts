// VSR match-log builder (spec/22): rebuilds a complete VolleyStation-style
// .vsr JSON snapshot of a match from the append-only event log, at any point
// in the match. Field mapping documented in spec/22-vsr-live-feed.md; derived
// from two real reference logs (indoor 26665 / beach 505567).

import type { TournamentConfig } from "@/engine/config";
import type { MatchReportData, ReportEvent, ReportPlayer } from "@/lib/match-report";
import type { SignatureStrokes } from "@/lib/match-signatures";
import { survivingEvents } from "@/lib/scoresheet/official-data";

type TeamKey = "home" | "away";
type Json = Record<string, unknown>;

const teamKey = (t: unknown): TeamKey => (t === "B" ? "away" : "home");
const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** First token = first name, remainder = last name (officials store one
 *  free-text name; the references carry multi-word both ways — documented
 *  approximation in spec/22). */
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: "", lastName: name.trim() };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function playerName(p: ReportPlayer): { firstName: string; lastName: string } {
  if (p.firstName || p.lastName)
    return { firstName: p.firstName ?? "", lastName: p.lastName ?? "" };
  return splitName(p.fullName);
}

/** Signature strokes → the SVG string format the reference approvals carry
 *  (500×150 viewBox, black polyline paths). */
export function strokesToSvg(strokes: SignatureStrokes): string {
  const W = 500;
  const H = 150;
  const paths = strokes.strokes
    .filter((s) => s.length > 0)
    .map((stroke) => {
      const pts = stroke.map(
        ([x, y]) => `${((x ?? 0) * W).toFixed(3)},${((y ?? 0) * H).toFixed(3)}`,
      );
      const d =
        pts.length === 1
          ? `M ${pts[0]} L ${pts[0]}`
          : `M ${pts[0]} L ${pts.slice(1).join(" L ")}`;
      return `<path d="${d}" stroke-width="6.000" stroke="black" fill="none" stroke-linecap="round"></path>`;
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${paths}</svg>`
  );
}

// ── settings templates (copied from the reference files; config overrides) ──

const INDOOR_SETTINGS: Json = {
  winningScore: 3, regularSetWin: 25, decidingSetWin: 15, goldenSetWin: 15,
  maxForeign: 6, maxConfederation: 0, maxSubstitution: 8, maxVideoChallenge: 2,
  maxTimeout: 2, timeoutLength: [30], technicalTimeouts: [],
  decidingTechnicalTimeouts: [], technicalTimeoutLength: [],
  squadSizeForSecondLibero: 15, playersOnRoster: 14,
  rotationZones: [1, 6, 5, 4, 3, 2], libero: true,
  technicalTimeoutScoreSum: false, coinTossEachSet: false, maxPenalty: 1,
  sanctionsPerSet: false, fixedSets: false, noVideoChallengeRefunds: false,
  setBreaks: [180, 300, 180], trackCaptain: false, digitalSignatures: false,
  liberoCanServe: false, multiplePositionSubs: false, liberoPerSet: false,
  simpleStats: false, manualSideChange: false, newSideMarkers: true,
  setWinWithoutLead: false, pin: "", goldenSet: false, mediaTimeout: false,
  medicalAssistance: false, midRallyChallenge: false,
  noScoreChangeOnGreenCard: false, nonDisabledInLineup: 1,
  nonDisabledOnRoster: 2, organiserName: "FIVB", paraVolley: false,
  regularSetSideChanges: [2], remarksApprovals: [],
  resultApprovals: ["captain", "referee1", "referee2", "refereeChallenge", "scorer1", "scorer2"],
  rosterApprovals: ["captain", "coach"], serveTimer: 15,
  superPointInSet: null, superPointInSetDeciding: null, timeoutResets: [],
  variation: "indoor", challengeOptions: "simpleExtendedAutomated",
  videoChallengePerMatch: false, vis: true, codeOnReports: false,
  decidingSetSideChange: false, decidingSetSideDecision: false,
  fixedRotations: false, noTabletSubstitutions: true,
};

const BEACH_SETTINGS: Json = {
  winningScore: 2, regularSetWin: 21, decidingSetWin: 15, goldenSetWin: 15,
  maxForeign: 2, maxConfederation: 0, maxSubstitution: 0, maxVideoChallenge: 2,
  maxTimeout: 1, timeoutLength: [60], technicalTimeouts: [21],
  decidingTechnicalTimeouts: [], technicalTimeoutLength: [60],
  squadSizeForSecondLibero: 0, playersOnRoster: 2, rotationZones: [1, 5],
  libero: false, technicalTimeoutScoreSum: true, coinTossEachSet: true,
  maxPenalty: 2, sanctionsPerSet: true, fixedSets: false,
  noVideoChallengeRefunds: false, setBreaks: [60], trackCaptain: false,
  digitalSignatures: false, liberoCanServe: false, multiplePositionSubs: false,
  liberoPerSet: false, simpleStats: false, goldenSet: false,
  mediaTimeout: false, medicalAssistance: true, midRallyChallenge: true,
  noScoreChangeOnGreenCard: false, nonDisabledInLineup: 0,
  nonDisabledOnRoster: 0, organiserName: "", paraVolley: false,
  pointsToSwitchSides: 7, pointsToSwitchSidesDeciding: 5,
  regularSetSideChanges: [], remarksApprovals: ["referee1", "delegate"],
  resultApprovals: ["captain", "referee1", "referee2", "refereeChallenge", "scorer1", "scorer2"],
  rosterApprovals: ["captain", "coach"], serveTimer: null,
  superPointInSet: null, superPointInSetDeciding: null, timeoutResets: [],
  variation: "beach", challengeOptions: "beach", videoChallengePerMatch: false,
  vis: true, codeOnReports: false, decidingSetSideChange: true,
  decidingSetSideDecision: true, fixedRotations: true,
  noTabletSubstitutions: false,
};

function buildSettings(discipline: string, config: TournamentConfig): Json {
  const beach = discipline === "BEACH";
  const s: Json = { ...(beach ? BEACH_SETTINGS : INDOOR_SETTINGS) };
  s.winningScore = Math.ceil(config.bestOf / 2);
  s.regularSetWin = config.setScore;
  s.decidingSetWin = config.setScoreTiebreak;
  s.maxSubstitution = config.maxSubsPerSet ?? s.maxSubstitution;
  s.maxTimeout = config.timeoutsPerSet;
  s.timeoutLength = [config.timeoutDurationSecs];
  s.libero = config.liberoEnabled;
  s.setBreaks = config.setBreakDurationsSecs?.length
    ? config.setBreakDurationsSecs
    : s.setBreaks;
  s.serveTimer = config.serveClockEnabled ? config.serveClockSecs : null;
  s.maxVideoChallenge = config.vcsEnabled ? (config.vcsChallengesPerSet ?? 2) : 0;
  if (config.ttoEnabled && config.ttoTriggerScore != null) {
    s.technicalTimeouts = [config.ttoTriggerScore];
    s.technicalTimeoutLength = [config.ttoDurationSecs];
  } else {
    s.technicalTimeouts = [];
    s.technicalTimeoutLength = [];
  }
  if (beach) {
    s.pointsToSwitchSides = config.sideSwitchEvery ?? 7;
    s.pointsToSwitchSidesDeciding = config.sideSwitchTiebreakEvery ?? 5;
  }
  return s;
}

// ── teams / officials / approvals ────────────────────────────────────────────

function buildTeam(report: MatchReportData, side: "A" | "B"): Json {
  const roster = side === "A" ? report.rosterA : report.rosterB;
  const name = side === "A" ? report.teamAName : report.teamBName;
  const country = side === "A" ? report.teamACountry : report.teamBCountry;
  const players = roster.filter((p) => !p.isLibero && p.role !== "STAFF" && p.role !== "BENCH");
  const reserve = roster.filter((p) => p.role === "BENCH");
  const staff = roster.filter((p) => p.role === "STAFF");
  const toPlayer = (p: ReportPlayer, i: number): Json => ({
    ...playerName(p),
    shirtNumber: p.jerseyNumber,
    shirtName: playerName(p).lastName || p.fullName,
    code: p.id,
    position: i,
  });
  return {
    libero: roster.filter((p) => p.isLibero).map((p) => p.jerseyNumber),
    code: side === "A" ? report.matchId + ":A" : report.matchId + ":B",
    name,
    shortName: country ?? name.slice(0, 3).toUpperCase(),
    captain: roster.find((p) => p.isCaptain)?.jerseyNumber ?? null,
    players: players.map(toPlayer),
    reserve: reserve.map(toPlayer),
    staff: staff.map((p, i) => ({
      person: playerName(p),
      type: i === 0 ? "coach" : "assistant",
    })),
    color: "",
  };
}

const OFFICIAL_ROLE_TO_VSR: Record<string, string> = {
  FIRST_REFEREE: "referee1",
  SECOND_REFEREE: "referee2",
  THIRD_REFEREE: "referee3",
  CHALLENGE_REFEREE: "refereeChallenge",
  SCORER: "scorer1",
  ASSISTANT_SCORER: "scorer2",
  LINE_JUDGE_1: "lineJudge1",
  LINE_JUDGE_2: "lineJudge2",
  LINE_JUDGE_3: "lineJudge3",
  LINE_JUDGE_4: "lineJudge4",
};

function buildOfficials(report: MatchReportData): Json {
  const out: Json = {};
  for (const o of report.approval.officials) {
    const key = OFFICIAL_ROLE_TO_VSR[o.role];
    if (!key) continue;
    out[key] = { ...splitName(o.name), level: o.level ?? o.country ?? "" };
  }
  return out;
}

function buildApprovals(report: MatchReportData): Json {
  const sig = (role: string): string | undefined => {
    const s = report.approval.signatures.find((x) => x.role === role);
    return s?.strokes ? strokesToSvg(s.strokes) : undefined;
  };
  const compact = (o: Record<string, string | undefined>): Json | undefined => {
    const entries = Object.entries(o).filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  };
  const out: Json = {};
  // roster.* = pre-match approvals; result.* = post-match (spec/22 mapping).
  const rosterCaptain = compact({
    home: sig("TEAM_A_CAPTAIN_PREMATCH"),
    away: sig("TEAM_B_CAPTAIN_PREMATCH"),
  });
  if (rosterCaptain) out.roster = { captain: rosterCaptain };
  const resultCaptain = compact({
    home: sig("TEAM_A_CAPTAIN"),
    away: sig("TEAM_B_CAPTAIN"),
  });
  const result: Json = {};
  if (resultCaptain) result.captain = resultCaptain;
  const ref1 = sig("FIRST_REFEREE");
  if (ref1) result.referee1 = ref1;
  const scorer1 = sig("SCORER");
  if (scorer1) result.scorer1 = scorer1;
  const scorer2 = sig("ASSISTANT_SCORER");
  if (scorer2) result.scorer2 = scorer2;
  if (Object.keys(result).length) out.result = result;
  return out;
}

// ── scout (the per-set action stream) ────────────────────────────────────────

interface VsrSet {
  startingLineup: Record<TeamKey, (number | null)[]>;
  coinToss?: Json;
  startTime: string | null;
  events: Json[];
  duration: number | null;
  endTime: string | null;
  score: Record<TeamKey, number>;
}

function buildScout(report: MatchReportData, beach: boolean): Json {
  const jerseyOf = new Map<string, number | null>();
  for (const p of [...report.rosterA, ...report.rosterB]) jerseyOf.set(p.id, p.jerseyNumber);
  const jersey = (id: unknown): number | null =>
    typeof id === "string" ? (jerseyOf.get(id) ?? null) : null;

  const events = survivingEvents(report.events);
  const sets: VsrSet[] = [];
  let cur: VsrSet | null = null;
  let prevTs: string | null = null;
  let coinToss: Json | null = null;
  let openChallenge: { team: TeamKey; atScore: Json; startTime: string | null } | null = null;
  // Latest lineup per team (indoor jersey rotation / beach service order),
  // applied to the current set — also covers pre-set declarations.
  const lineups: Record<TeamKey, (number | null)[]> = {
    home: [],
    away: [],
  };

  const num = (v: unknown): number => (typeof v === "number" ? v : 0);

  for (const ev of events) {
    const p = (ev.payload ?? {}) as Json & { type?: string };
    const type = (p.type as string | undefined) ?? ev.eventType;
    const ts = iso(ev.timestamp);
    const scoreNow = { home: num(ev.scoreAfterA), away: num(ev.scoreAfterB) };

    switch (type) {
      case "COIN_TOSS": {
        coinToss = {
          start: {
            leftSide: p.teamAStartSide === "LEFT" ? "home" : "away",
            serve: teamKey(p.firstServer),
            winner: p.tossWinner ? teamKey(p.tossWinner) : teamKey(p.firstServer),
          },
        };
        break;
      }
      case "SET_START": {
        // Beach without a declared SERVICE_ORDER: roster order is the assumed
        // order (matches the scorer console's fallback).
        if (beach) {
          for (const [key, roster] of [
            ["home", report.rosterA],
            ["away", report.rosterB],
          ] as const) {
            if (lineups[key].length === 0 && roster.length >= 2)
              lineups[key] = [
                roster[0]?.jerseyNumber ?? null,
                null,
                null,
                null,
                roster[1]?.jerseyNumber ?? null,
                null,
              ];
          }
        }
        cur = {
          startingLineup: { home: [...lineups.home], away: [...lineups.away] },
          startTime: ts,
          events: [],
          duration: null,
          endTime: null,
          score: { home: 0, away: 0 },
        };
        if (beach)
          cur.coinToss = {
            leftSide: p.teamAStartSide === "LEFT" ? "home" : "away",
            winner: p.tossWinner
              ? teamKey(p.tossWinner)
              : teamKey(p.firstServer),
            serve: teamKey(p.firstServer),
          };
        sets.push(cur);
        prevTs = ts;
        break;
      }
      case "LINEUP_CONFIRMED": {
        const ids = Array.isArray(p.playerIds) ? (p.playerIds as string[]) : [];
        const key = teamKey(p.team);
        lineups[key] = ids.map((id) => jersey(id));
        if (cur) {
          cur.startingLineup[key] = [...lineups[key]];
          prevTs = ts;
        }
        break;
      }
      case "SERVICE_ORDER": {
        // Beach: 6-slot array with the two jerseys at indexes 0 and 4, in
        // service order (the reference format).
        const key = teamKey(p.team);
        const roster = p.team === "A" ? report.rosterA : report.rosterB;
        const first = roster.find((r) => r.id === p.firstServerPlayerId);
        const second = roster.find((r) => r.id !== p.firstServerPlayerId);
        lineups[key] = [first?.jerseyNumber ?? null, null, null, null, second?.jerseyNumber ?? null, null];
        if (cur) {
          cur.startingLineup[key] = [...lineups[key]];
          prevTs = ts;
        }
        break;
      }
      case "RALLY_WON_A":
      case "RALLY_WON_B": {
        if (!cur) break;
        cur.events.push({
          rally: {
            startTime: prevTs ?? cur.startTime,
            endTime: ts,
            point: type === "RALLY_WON_A" ? "home" : "away",
          },
        });
        cur.score = scoreNow;
        prevTs = ts;
        break;
      }
      case "TIMEOUT_REQUEST": {
        cur?.events.push({ timeout: { team: teamKey(p.team), time: ts } });
        prevTs = ts;
        break;
      }
      case "TTO_START": {
        cur?.events.push({ technicalTimeout: { time: ts, approved: true } });
        prevTs = ts;
        break;
      }
      case "SUBSTITUTION": {
        cur?.events.push({
          substitution: {
            team: teamKey(p.team),
            in: jersey(p.inPlayerId),
            out: jersey(p.outPlayerId),
            time: ts,
          },
        });
        prevTs = ts;
        break;
      }
      case "LIBERO_REPLACEMENT": {
        cur?.events.push({
          libero: {
            enters: p.direction === "IN",
            team: teamKey(p.team),
            libero: jersey(p.liberoId),
            player: jersey(p.outPlayerId),
            time: ts,
          },
        });
        prevTs = ts;
        break;
      }
      case "VCS_CHALLENGE": {
        openChallenge = { team: teamKey(p.team), atScore: scoreNow, startTime: ts };
        break;
      }
      case "VCS_RESULT": {
        if (cur && openChallenge) {
          cur.events.push({
            videoChallenge: {
              team: openChallenge.team,
              // We don't capture the challenge reason yet (spec/22 §open).
              reason: "other",
              atScore: openChallenge.atScore,
              startTime: openChallenge.startTime,
              method: "video",
              endTime: ts,
              response: p.upheld ? "correct" : "wrong",
            },
          });
        }
        openChallenge = null;
        prevTs = ts;
        break;
      }
      case "SET_END": {
        if (!cur) break;
        cur.endTime = ts;
        cur.score = {
          home: num(p.scoreA) || cur.score.home,
          away: num(p.scoreB) || cur.score.away,
        };
        if (cur.startTime && ts)
          cur.duration = Math.max(
            0,
            Math.round((new Date(ts).getTime() - new Date(cur.startTime).getTime()) / 60000),
          );
        cur = null;
        break;
      }
      default:
        break;
    }
  }

  const scout: Json = {
    sets,
    interruptions: [],
    objections: [],
    undoLog: [],
  };
  if (!beach && coinToss) scout.coinToss = coinToss;
  const ended = iso(report.finishedAt);
  if (ended) scout.ended = ended;
  return scout;
}

// ── entry point ──────────────────────────────────────────────────────────────

export function buildVsr(report: MatchReportData, config: TournamentConfig): Json {
  const beach = report.discipline === "BEACH";
  const remarks = survivingEvents(report.events)
    .filter((e) => (e.payload as { type?: string } | null)?.type === "NOTE")
    .map((e) => String((e.payload as { text?: unknown }).text ?? ""))
    .filter(Boolean)
    .join(" · ");

  const vsr: Json = {
    scout: buildScout(report, beach),
    settings: buildSettings(report.discipline, config),
    signatures: {},
    approvals: buildApprovals(report),
    version: beach ? 6 : 7,
    startDate: iso(report.startedAt ?? report.scheduledAt),
    ...(beach
      ? { court: report.courtNumber != null ? String(report.courtNumber) : "" }
      : {
          city: report.city ?? "",
          country: report.country ?? "",
          hall: report.hall ?? report.venue ?? "",
        }),
    phase: report.phaseName ?? "",
    round: report.roundName ?? String(report.matchNumber ?? ""),
    competition: report.competitionName,
    matchNumber: String(report.matchNumber ?? ""),
    division:
      report.gender === "MEN" ? "M" : report.gender === "WOMEN" ? "F" : "X",
    category: (report.category ?? "SENIOR").slice(0, 1),
    teams: { home: buildTeam(report, "A"), away: buildTeam(report, "B") },
    officials: buildOfficials(report),
    visId: report.visId ?? "",
    spectators: null,
  };
  if (remarks) vsr.remarks = remarks;
  return vsr;
}

/** The filename convention of the reference logs. */
export function vsrFilename(report: MatchReportData): string {
  const id = report.visId || String(report.matchNumber ?? report.matchId);
  return `Match log ${id}.vsr`;
}
