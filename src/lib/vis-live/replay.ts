/**
 * The replay board: one real match, always in progress (spec/44).
 *
 * A board URL that never touches VIS and is permanently somewhere in a real
 * match, so any screen — warm-up, a rally, a timeout, a substitution, a set
 * break, match point, the final result — can be looked at whenever somebody
 * needs to check it, without waiting for a fixture to be played.
 *
 * The donor is match 27550, chosen because it is the awkward one: it contains
 * the on-court wrong-server fault of spec/43, a libero legally standing at
 * position 1 while receiving, libero exchanges, ordinary substitutions,
 * timeouts and challenges. If the board can render 27550 it can render anything
 * these reference matches contain.
 *
 * THREE properties hold this together:
 *
 * **Nothing is invented.** The capture carries a real millisecond clock —
 * `Set@BeginTimeOffset`, `Rally@TimeOffset`/`EndTimeOffset`,
 * `Timeout@TimeOffset` — all relative to the match start. An event enters the
 * replayed feed when virtual time passes its END, which is exactly how VIS
 * behaves: a rally is published once it has been played.
 *
 * **Document order is preserved.** Substitutions between two rallies must stay
 * between them: the enforced rotation reads `subsBefore` from that order, so a
 * frame that emitted all the events and then all the rallies would hand every
 * substitution in the set to rally one.
 *
 * **Nothing is scheduled.** The phase is a pure function of the wall clock
 * modulo one cycle length, so every serverless instance computes the identical
 * frame with no coordination, no cron and no warmer — and nothing runs at all
 * when no board is open. That is the rule the cadence module already follows.
 */

import { REPLAY_CAPTURE_XML } from "./replay-capture";
import { num, parseAttrs, str, tagBlocks, type Attrs } from "./parse";
import { designatedLiberos } from "./events";

/** Impossible as a real VIS match number, so it can never collide with one. */
export const REPLAY_MATCH_NO = -27550;
export const REPLAY_LABEL = "REPLAY · 27550 QAT-VEN";

/** Fixed and committed. Derived at module load, instances would disagree. */
export const REPLAY_EPOCH_MS = Date.UTC(2026, 7, 20);
/** Virtual milliseconds per wall millisecond while the match is being played. */
export const REPLAY_SPEED = 4;
/** The board sits on the pre-match screen for this long, every cycle... */
const HOLD_UPCOMING_MS = 120_000;
/** ...and on the final result for this long. */
const HOLD_FINISHED_MS = 120_000;
/** How long a stale line-up is republished in chaos mode, in feed time. */
const CHAOS_WINDOW_MS = 1_500;
/**
 * Feed time between the replay's t=0 and the first serve. Long enough that the
 * board really passes through "set one, no rallies yet", which is the only
 * moment `Set@NoServingTeam` names the first server (spec/42).
 */
const PRE_ROLL_MS = 30_000;

interface ReplayRally {
  kind: "rally";
  /** When it becomes visible: its END, because VIS publishes a rally after it. */
  at: number;
  scoreA: number;
  scoreB: number;
  /** The element, split so its line-ups can be swapped in chaos mode. */
  open: string;
  body: string;
  lineups: string;
  /** `Note="3"` actions: who scored, with which skill. */
  points: { player: string; skill: string }[];
  /** Points credited to a team rather than a player, with their note. */
  teamPoints: { noTeam: string; note: string }[];
  /** The player who served it, from the first `<Action>`. */
  server: string | null;
  /** Teams of the substitutions nested inside the rally that COUNT (see below). */
  subTeams: string[];
}

interface ReplayEvent {
  kind: "event";
  at: number;
  xml: string;
  tag: string;
  noTeam: string | null;
  /** ChallengeResult only: 2 is upheld, anything else costs the allowance. */
  outcome: string | null;
  /** A substitution VIS counts against the six — i.e. not a libero exchange. */
  countsAsSubstitution: boolean;
}

type ReplayItem = ReplayRally | ReplayEvent;

interface ReplaySet {
  no: number;
  beginAt: number;
  attrs: Attrs;
  /** The set's own `LineUp` rows, verbatim — the registered starting six. */
  head: string;
  /** Rallies and interruptions together, in the order the capture states them. */
  items: ReplayItem[];
  /** The team that served this set's first rally, from its serve action. */
  firstServingTeam: string | null;
}

interface Capture {
  matchAttrs: Attrs;
  /** The Match element's children (VolleyballMatch and friends), verbatim. */
  matchInner: string;
  /** Tournament, Pool and the two Team blocks, verbatim. */
  context: string;
  sets: ReplaySet[];
  noTeamA: string;
  noTeamB: string;
  playerTeam: Map<string, string>;
  /** The last moment anything happens: the match's length in feed time. */
  spanMs: number;
  pollDelay: string;
}

let cached: Capture | null = null;

function capture(): Capture {
  if (cached) return cached;
  const xml = REPLAY_CAPTURE_XML;

  const matchOpenAt = xml.indexOf("<Match ");
  const matchInnerAt = xml.indexOf(">", matchOpenAt) + 1;
  const matchCloseAt = xml.indexOf("</Match>");
  const matchAttrs = tagBlocks(xml, "Match")[0]?.attrs ?? {};
  const matchInner = xml.slice(matchInnerAt, matchCloseAt);

  const noTeamA = String(matchAttrs.NoTeamA ?? "");
  const noTeamB = String(matchAttrs.NoTeamB ?? "");

  const playerTeam = new Map<string, string>();
  for (const team of tagBlocks(xml, "Team")) {
    const no = String(team.attrs.No ?? "");
    for (const m of team.inner.matchAll(/<Player\b([^>]*?)\/?>/g)) {
      const id = str(parseAttrs(m[1]), "No");
      if (id) playerTeam.set(id, no);
    }
  }

  // Everything between the Match element and the first Set: Tournament, Pool
  // and the two Team blocks, emitted verbatim in every frame.
  const afterMatch = xml.slice(matchCloseAt + "</Match>".length);
  const firstSetAt = afterMatch.indexOf("<Set ");
  const context = (firstSetAt < 0 ? afterMatch : afterMatch.slice(0, firstSetAt)).replace(
    /<\/VolleyLive>[\s\S]*$/,
    "",
  );

  const parsed = tagBlocks(xml, "Set")
    .map((block) => parseSet(block, playerTeam))
    .sort((a, b) => a.no - b.no);

  // EVERY offset in the capture is milliseconds from `Match@BeginDateTime`,
  // which is the SCHEDULED start — and 27550 was scheduled for 13:35 but first
  // served at 14:01. Replaying those 26 minutes would spend a quarter of every
  // cycle on an empty court, so the replay's clock starts a short pre-roll
  // before the first serve instead. Nothing else is rescaled: the gaps between
  // rallies, the time-outs and the set breaks all keep their real lengths.
  const firstServe = parsed
    .flatMap((s) => s.items.filter((i) => i.kind === "rally"))
    .reduce((min, r) => Math.min(min, r.at), Number.POSITIVE_INFINITY);
  const origin = Number.isFinite(firstServe) ? firstServe - PRE_ROLL_MS : 0;

  const sets = parsed.map((s) => ({
    ...s,
    // Set one's own begin offset goes negative, which is right: it is already
    // under way when the replay picks the match up.
    beginAt: s.beginAt - origin,
    items: s.items.map((i) => ({ ...i, at: i.at - origin })) as ReplayItem[],
  }));

  const spanMs = sets.reduce(
    (max, s) => s.items.reduce((m, i) => Math.max(m, i.at), Math.max(max, s.beginAt)),
    0,
  );

  cached = {
    matchAttrs,
    matchInner,
    context,
    sets,
    noTeamA,
    noTeamB,
    playerTeam,
    spanMs,
    pollDelay: str(parseAttrs(/<VolleyLive\b([^>]*)>/.exec(xml)?.[1] ?? ""), "PollDelay") ?? "20",
  };
  return cached;
}

/** Every event element the capture carries, rallies aside. */
const EVENT_TAGS =
  "Timeout|EndTimeout|TechnicalTimeout|Substitution|ChallengeRequest|ChallengeResult|Injury|Protest|Comment|Sanction";
const ITEM_RE = new RegExp(`<(Rally|${EVENT_TAGS})\\b([^>]*?)(/?)>`, "g");

function parseSet(
  block: { attrs: Attrs; inner: string },
  playerTeam: Map<string, string>,
): ReplaySet {
  const eventsInner = tagBlocks(block.inner, "Events")[0]?.inner ?? "";
  const head = block.inner.split("<Events")[0];

  /**
   * A libero coming and going is delivered as a `<Substitution>`, but VIS does
   * NOT count it against the six a team may make — verified per set against
   * this capture's own `NbSubstitutionTeam*`: 28 substitution events for Qatar
   * in set one, of which the feed counts 2, and the two are exactly the ones
   * involving no designated libero. Counting them all would empty the board's
   * substitution allowance a few rallies in.
   */
  const liberos = designatedLiberos(head);
  const counts = (out: string | null, incoming: string | null) =>
    !!out && !!incoming && !liberos.has(out) && !liberos.has(incoming);

  const items: ReplayItem[] = [];
  let consumedTo = 0;
  for (const m of eventsInner.matchAll(ITEM_RE)) {
    const from = m.index ?? 0;
    // Elements nested inside a rally were consumed with it.
    if (from < consumedTo) continue;
    const attrs = parseAttrs(m[2]);

    if (m[1] === "Rally") {
      const bodyAt = from + m[0].length;
      const close = eventsInner.indexOf("</Rally>", bodyAt);
      const end = close < 0 ? eventsInner.length : close;
      consumedTo = close < 0 ? eventsInner.length : close + "</Rally>".length;
      items.push(rallyOf(m[0], attrs, eventsInner.slice(bodyAt, end), playerTeam, counts));
      continue;
    }

    consumedTo = from + m[0].length;
    const out = str(attrs, "NoPlayerOut");
    items.push({
      kind: "event",
      at: num(attrs, "TimeOffset", 0),
      xml: m[0],
      tag: m[1],
      noTeam: str(attrs, "NoTeam") ?? (out ? (playerTeam.get(out) ?? null) : null),
      outcome: str(attrs, "Outcome"),
      countsAsSubstitution:
        m[1] === "Substitution" && counts(out, str(attrs, "NoPlayerIn")),
    });
  }

  const opener = items.find((i): i is ReplayRally => i.kind === "rally")?.server;
  return {
    no: num(block.attrs, "No", 0),
    beginAt: num(block.attrs, "BeginTimeOffset", 0),
    attrs: block.attrs,
    head,
    items,
    firstServingTeam: opener ? (playerTeam.get(opener) ?? null) : null,
  };
}

function rallyOf(
  open: string,
  attrs: Attrs,
  inner: string,
  playerTeam: Map<string, string>,
  counts: (out: string | null, incoming: string | null) => boolean,
): ReplayRally {
  const lineups = (inner.match(/<LineUp\b[^>]*?\/>/g) ?? []).join("");
  const body = inner.replace(/<LineUp\b[^>]*?\/>/g, "");

  const points: { player: string; skill: string }[] = [];
  let server: string | null = null;
  for (const m of inner.matchAll(/<Action\b([^>]*?)\/?>/g)) {
    const a = parseAttrs(m[1]);
    const player = str(a, "NoPlayer");
    if (!server) server = player;
    if (str(a, "Note") === "3" && player) {
      points.push({ player, skill: str(a, "Skill") ?? "" });
    }
  }

  const teamPoints: { noTeam: string; note: string }[] = [];
  for (const m of inner.matchAll(/<TeamPoint\b([^>]*?)\/?>/g)) {
    const a = parseAttrs(m[1]);
    const noTeam = str(a, "NoTeam");
    if (noTeam) teamPoints.push({ noTeam, note: str(a, "Note") ?? "" });
  }

  const subTeams: string[] = [];
  for (const m of inner.matchAll(/<Substitution\b([^>]*?)\/?>/g)) {
    const a = parseAttrs(m[1]);
    const out = str(a, "NoPlayerOut");
    if (!counts(out, str(a, "NoPlayerIn"))) continue;
    const team = out ? playerTeam.get(out) : null;
    if (team) subTeams.push(team);
  }

  return {
    kind: "rally",
    // `EndTimeOffset` is when the rally finished, and therefore the first
    // moment VIS could publish it. Falling back to the start keeps a malformed
    // row visible rather than invisible forever.
    at: num(attrs, "EndTimeOffset", num(attrs, "TimeOffset", 0)),
    scoreA: num(attrs, "PointsTeamA", 0),
    scoreB: num(attrs, "PointsTeamB", 0),
    open,
    body,
    lineups,
    points,
    teamPoints,
    server,
    subTeams,
  };
}

export type ReplayPhase = "UPCOMING" | "PLAY" | "FINISHED";

export interface ReplayFrame {
  phase: ReplayPhase;
  /** Virtual time into the match, in feed milliseconds; -1 before it starts. */
  tMs: number;
  /** Wall-clock ms at which the play phase started, or will start. */
  beginAtMs: number;
  positionMs: number;
  cycleMs: number;
  /** How many complete loops have run since the epoch. */
  cycleIndex: number;
}

/** How long the play phase lasts in wall time, at `speed`. */
function playWallMs(speed: number): number {
  return Math.ceil(capture().spanMs / Math.max(1, speed));
}

/** The length of one full loop, in wall milliseconds. */
export function cycleMs(speed: number = REPLAY_SPEED): number {
  return HOLD_UPCOMING_MS + playWallMs(speed) + HOLD_FINISHED_MS;
}

/**
 * Where in the loop the wall clock puts us. Pure, and identical on every
 * instance: no stored state, no scheduling, nothing that can drift apart.
 */
export function phaseAt(nowMs: number, speed: number = REPLAY_SPEED): ReplayFrame {
  const rate = Math.max(1, speed);
  const play = playWallMs(rate);
  const cycle = HOLD_UPCOMING_MS + play + HOLD_FINISHED_MS;
  const elapsed = nowMs - REPLAY_EPOCH_MS;
  const position = ((elapsed % cycle) + cycle) % cycle;
  const cycleIndex = Math.floor((elapsed - position) / cycle);
  const base = { positionMs: position, cycleMs: cycle, cycleIndex };

  if (position < HOLD_UPCOMING_MS) {
    return {
      ...base,
      phase: "UPCOMING",
      tMs: -1,
      // Still in the future, which is what makes the board read UPCOMING.
      beginAtMs: nowMs + (HOLD_UPCOMING_MS - position),
    };
  }
  const intoPlay = position - HOLD_UPCOMING_MS;
  const beginAtMs = nowMs - intoPlay;
  if (intoPlay < play) {
    return { ...base, phase: "PLAY", tMs: intoPlay * rate, beginAtMs };
  }
  return { ...base, phase: "FINISHED", tMs: capture().spanMs, beginAtMs };
}

const ISO = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function attrsToXml(attrs: Record<string, string | number | null | undefined>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(
      ([k, v]) =>
        ` ${k}="${String(v)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/"/g, "&quot;")}"`,
    )
    .join("");
}

interface IncludedSet {
  set: ReplaySet;
  items: ReplayItem[];
  rallies: ReplayRally[];
  complete: boolean;
}

/**
 * What `GetVolleyLive` would have answered at this moment of the replay.
 *
 * Everything the board reads is either verbatim from the capture or recomputed
 * from what has happened by now — never carried back from the end of the match,
 * which is the trap the static mock falls into and the reason it can only ever
 * show a single frame.
 */
export function replayXml(
  nowMs: number,
  opts: { speed?: number; chaos?: boolean } = {},
): string {
  const cap = capture();
  const speed = opts.speed ?? REPLAY_SPEED;
  const frame = phaseAt(nowMs, speed);
  const t = frame.tMs;

  const included: IncludedSet[] = cap.sets
    .filter((s) => s.beginAt <= t)
    .map((set) => {
      const items = set.items.filter((i) => i.at <= t);
      const rallies = items.filter((i): i is ReplayRally => i.kind === "rally");
      const total = set.items.filter((i) => i.kind === "rally").length;
      return { set, items, rallies, complete: total > 0 && rallies.length === total };
    });

  let wonA = 0;
  let wonB = 0;
  for (const { rallies, complete } of included) {
    if (!complete) continue;
    const last = rallies[rallies.length - 1];
    if (last.scoreA > last.scoreB) wonA++;
    else if (last.scoreB > last.scoreA) wonB++;
  }

  const rallyCount = included.reduce((n, s) => n + s.rallies.length, 0);
  const itemCount = included.reduce((n, s) => n + s.items.length, 0);
  // Monotonic while the replay advances, stable while nothing happens, and
  // never repeating across loops — which is what the Version handshake needs.
  const version = frame.cycleIndex * 1_000_000 + itemCount;

  const matchAttrs: Record<string, string | number | null> = {
    ...cap.matchAttrs,
    NbRallies: rallyCount || null,
    MatchPointsA: wonA || null,
    MatchPointsB: wonB || null,
    BeginDateTime: ISO(frame.beginAtMs),
    EndDateTime:
      frame.phase === "FINISHED"
        ? ISO(frame.beginAtMs + playWallMs(Math.max(1, speed)))
        : null,
    // `Match@Status` is only read for match-LIST rows, but a match in progress
    // should not be carrying the capture's "finished" code.
    Status: frame.phase === "FINISHED" ? (cap.matchAttrs.Status ?? null) : null,
  };

  return (
    '<?xml version="1.0" encoding="utf-8" standalone="yes"?><Responses>' +
    `<VolleyLive PollDelay="${cap.pollDelay}" Version="${version}">` +
    `<Match${attrsToXml(matchAttrs)}>${cap.matchInner}${statistics(included, cap)}</Match>` +
    cap.context +
    included.map((s) => renderSet(s, cap, opts.chaos === true, t)).join("") +
    "</VolleyLive></Responses>"
  );
}

/**
 * The statistics the board renders, recomputed from what has been played.
 *
 * Exact against VIS's own aggregates for per-player `TotalPoints`,
 * `BlockPoint`, `ServePoint` and team `OpponentErrors` (verified on 27550 and
 * 27547). Attack points are the one figure the action stream cannot reproduce
 * exactly — VIS credits a handful more than it carries as `Skill="6" Note="3"`
 * — so the set-break attack bar reads slightly low against the real match. A
 * known gap, recorded here so it is not hunted as a bug.
 */
function statistics(included: IncludedSet[], cap: Capture): string {
  const perPlayer = new Map<
    string,
    { total: number; block: number; serve: number; spike: number }
  >();
  const opponentErrors = new Map<string, number>();

  for (const { rallies } of included) {
    for (const rally of rallies) {
      for (const p of rally.points) {
        const row = perPlayer.get(p.player) ?? { total: 0, block: 0, serve: 0, spike: 0 };
        row.total++;
        if (p.skill === "1") row.block++;
        else if (p.skill === "4") row.serve++;
        else if (p.skill === "6") row.spike++;
        perPlayer.set(p.player, row);
      }
      for (const tp of rally.teamPoints) {
        // Note 3 is a point the opponent gave away: VIS's `OpponentErrors`.
        if (tp.note === "3") {
          opponentErrors.set(tp.noTeam, (opponentErrors.get(tp.noTeam) ?? 0) + 1);
        }
      }
    }
  }

  const players = [...perPlayer.entries()]
    .map(([no, row]) =>
      `<PlayerStatistics${attrsToXml({
        NoPlayer: no,
        NoTeam: cap.playerTeam.get(no) ?? null,
        TotalPoints: row.total || null,
        BlockPoint: row.block || null,
        ServePoint: row.serve || null,
        SpikePoint: row.spike || null,
      })} />`,
    )
    .join("");

  const teams = [cap.noTeamA, cap.noTeamB]
    .map(
      (no) =>
        `<TeamStatistics${attrsToXml({
          NoTeam: no,
          OpponentErrors: opponentErrors.get(no) || null,
        })} />`,
    )
    .join("");

  return players + teams;
}

function renderSet(
  { set, items, rallies }: IncludedSet,
  cap: Capture,
  chaos: boolean,
  t: number,
): string {
  const last = rallies[rallies.length - 1] ?? null;

  // `NoServingTeam` means two different things and both are reproduced here:
  // before a set has any rallies it IS the first server, which is the one
  // moment the store can observe it (spec/42); afterwards it is whoever won the
  // last rally that moved the score.
  let servingTeam = set.firstServingTeam;
  let prevA = 0;
  let prevB = 0;
  for (const rally of rallies) {
    if (rally.scoreA > prevA) servingTeam = cap.noTeamA;
    else if (rally.scoreB > prevB) servingTeam = cap.noTeamB;
    prevA = rally.scoreA;
    prevB = rally.scoreB;
  }

  const counters: Record<string, number> = {};
  const bump = (prefix: string, noTeam: string | null) => {
    const side = noTeam === cap.noTeamA ? "A" : noTeam === cap.noTeamB ? "B" : null;
    if (side) counters[`${prefix}Team${side}`] = (counters[`${prefix}Team${side}`] ?? 0) + 1;
  };
  // A challenge result carries no team of its own; it belongs to the request
  // that preceded it. Outcome 2 is upheld — anything else spends the allowance.
  let pendingChallenge: string | null = null;
  for (const item of items) {
    if (item.kind === "rally") {
      for (const team of item.subTeams) bump("NbSubstitution", team);
      continue;
    }
    if (item.tag === "Timeout" || item.tag === "TechnicalTimeout") bump("NbTimeout", item.noTeam);
    if (item.tag === "Substitution" && item.countsAsSubstitution)
      bump("NbSubstitution", item.noTeam);
    if (item.tag === "ChallengeRequest") {
      bump("NbChallengeRequested", item.noTeam);
      pendingChallenge = item.noTeam;
    }
    if (item.tag === "ChallengeResult") {
      bump(item.outcome === "2" ? "NbChallengeAccepted" : "NbChallengeRefused", pendingChallenge);
      pendingChallenge = null;
    }
  }

  const attrs: Record<string, string | number | null> = {
    ...set.attrs,
    PointsTeamA: last?.scoreA ?? null,
    PointsTeamB: last?.scoreB ?? null,
    NbRallies: rallies.length || null,
    NoServingTeam: servingTeam,
    // Restated from what has been played, so a board counting allowances down
    // starts them full rather than spent.
    NbTimeoutTeamA: counters.NbTimeoutTeamA ?? null,
    NbTimeoutTeamB: counters.NbTimeoutTeamB ?? null,
    NbSubstitutionTeamA: counters.NbSubstitutionTeamA ?? null,
    NbSubstitutionTeamB: counters.NbSubstitutionTeamB ?? null,
    NbChallengeRequestedTeamA: counters.NbChallengeRequestedTeamA ?? null,
    NbChallengeRequestedTeamB: counters.NbChallengeRequestedTeamB ?? null,
    NbChallengeRefusedTeamA: counters.NbChallengeRefusedTeamA ?? null,
    NbChallengeRefusedTeamB: counters.NbChallengeRefusedTeamB ?? null,
    NbChallengeAcceptedTeamA: counters.NbChallengeAcceptedTeamA ?? null,
    NbChallengeAcceptedTeamB: counters.NbChallengeAcceptedTeamB ?? null,
    // The board takes the feed's remaining-substitution figure verbatim when it
    // is present; recomputing it would mean inventing this event's allowance,
    // so it is dropped and the FIVB fallback applies.
    NbRemainingSubstitutionTeamA: null,
    NbRemainingSubstitutionTeamB: null,
  };

  const lastRally = last;
  const body = items
    .map((item) => {
      if (item.kind === "event") return item.xml;
      // Chaos: for a moment after a rally, republish the PREVIOUS rally's
      // line-ups on it — the rewrite window spec/42 measured live.
      const staleWindow =
        chaos && item === lastRally && t - item.at < CHAOS_WINDOW_MS;
      const previous = rallies[rallies.indexOf(item) - 1];
      const lineups = staleWindow && previous ? previous.lineups : item.lineups;
      return `${item.open}${item.body}${lineups}</Rally>`;
    })
    .join("");

  return `<Set${attrsToXml(attrs)}>${set.head}<Events>${body}</Events></Set>`;
}

/** Test seam: drop the parsed capture. */
export function __resetReplayCache(): void {
  cached = null;
}
