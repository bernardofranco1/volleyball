/**
 * The per-set event stream (spec/43).
 *
 * `GetVolleyLive` Options bit 1 nests, inside each `<Set><Events>`, the rallies
 * with their own children — and the first `<Action>` of a rally is its SERVE:
 *
 *     <Rally No="1" PointsTeamA="0" PointsTeamB="1" …>
 *       <Action NoPlayer="232500" Skill="4" />   ← the serve, and who took it
 *       <Action NoPlayer="237036" Skill="3" />
 *       …
 *       <LineUp NoTeam="8682" NoPlayer1="…" … />
 *     </Rally>
 *
 * That first action is the ground truth this whole spec turns on: measured over
 * four full matches, 540 of 540 rallies open with `Skill="4"`, and its
 * `NoPlayer` is the player who ACTUALLY served — even on the one rally where
 * that was against the rules (27550 set 1 rally 15, a wrong-server fault).
 *
 * `<Substitution>` appears in BOTH placements, and real data contains both:
 * between two rallies as a direct child of `<Events>`, and inside a `<Rally>`.
 * Either way it belongs to the rally that follows or contains it, so both are
 * collected into that rally's `subsBefore`.
 *
 * Deliberately dependency-free like parse.ts: VIS puts everything in
 * attributes, and a document-order scan is the whole grammar we need.
 */

import { allTagAttrs, num, parseAttrs, str, tagBlocks, type Attrs } from "./parse";
import { sixOf, type Side, type Six } from "./rotation";

/** A substitution, as the feed states it: one player out, one in. */
export interface SubstitutionEvent {
  out: string;
  in: string;
  /** Which side it belongs to, from the roster. Null when neither is rostered. */
  side: Side | null;
}

export interface RallyEvent {
  /** 1-based index within the set — NOT the feed's match-wide `Rally@No`. */
  index: number;
  scoreA: number;
  scoreB: number;
  /** Who won it, or null when the feed moved neither score. */
  winner: Side | null;
  /** `NoPlayer` of the rally's first `<Action>` — the server. */
  server: string | null;
  /** The rally's own published lineups, per side. */
  lineup: { A: Six | null; B: Six | null };
  /** Substitutions since the previous rally, plus this rally's own. */
  subsBefore: SubstitutionEvent[];
}

export interface SetEvents {
  rallies: RallyEvent[];
  /** Substitutions recorded AFTER the last rally — they affect the six on court. */
  trailingSubs: SubstitutionEvent[];
}

/**
 * The liberos DESIGNATED for this set, from the set's own `LineUp` rows
 * (`NoLibero1`, `NoLibero2`).
 *
 * NOT the roster's `VolleyballPlayer@IsLibero` flag, which is a player's listed
 * POSITION and says nothing about this set. The difference is not academic:
 * match 27547 registers three players flagged `IsLibero`, designates one per
 * set, and in set 1 the undesignated 228092 came on as an ordinary substitute
 * (`NoSubstitute2`), rotated to position 1 and SERVED rally 41 — which the feed
 * records and which a roster-flag reading calls impossible. Measured across the
 * four reference matches: 3-4 flagged, 1-2 designated per set.
 *
 * Only the designated liberos are bound by FIVB 19.3.2.1, so only they may
 * refuse a serving position.
 */
export function designatedLiberos(setInner: string): Set<string> {
  const out = new Set<string>();
  for (const lineup of allTagAttrs(setInner, "LineUp")) {
    for (const [key, value] of Object.entries(lineup)) {
      if (key.startsWith("NoLibero") && value.trim() !== "") out.add(value);
    }
  }
  return out;
}

/** Roster number → side, so a substitution can be attributed to a team. */
export function playerSides(
  xml: string,
  noTeamA: number,
  noTeamB: number,
): Map<string, Side> {
  const out = new Map<string, Side>();
  for (const team of tagBlocks(xml, "Team")) {
    const no = num(team.attrs, "No", -99);
    const side: Side | null = no === noTeamA ? "A" : no === noTeamB ? "B" : null;
    if (!side) continue;
    for (const player of allTagAttrs(team.inner, "Player")) {
      const id = str(player, "No");
      if (id) out.set(id, side);
    }
  }
  return out;
}

/** The lineup a `<LineUp>`-carrying blob publishes for one side, or null. */
function lineupOf(blob: string, noTeam: number): Six | null {
  const rows = allTagAttrs(blob, "LineUp").filter(
    (l) => num(l, "NoTeam", -99) === noTeam,
  );
  const last = rows[rows.length - 1];
  return last ? sixOf(last) : null;
}

function subsIn(blob: string, sides: Map<string, Side>): SubstitutionEvent[] {
  return allTagAttrs(blob, "Substitution").flatMap((s) => {
    const out = str(s, "NoPlayerOut");
    const incoming = str(s, "NoPlayerIn");
    if (!out || !incoming) return [];
    return [{ out, in: incoming, side: sides.get(out) ?? sides.get(incoming) ?? null }];
  });
}

/** Where each `<Rally>` of a blob starts and ends, in document order. */
function rallySlices(inner: string): { attrs: Attrs; inner: string; from: number; to: number }[] {
  const out: { attrs: Attrs; inner: string; from: number; to: number }[] = [];
  const open = /<Rally\b([^>]*?)(\/?)>/g;
  for (const m of inner.matchAll(open)) {
    const from = m.index ?? 0;
    const bodyAt = from + m[0].length;
    if (m[2] === "/") {
      out.push({ attrs: parseAttrs(m[1]), inner: "", from, to: bodyAt });
      continue;
    }
    const close = inner.indexOf("</Rally>", bodyAt);
    const bodyEnd = close < 0 ? inner.length : close;
    out.push({
      attrs: parseAttrs(m[1]),
      inner: inner.slice(bodyAt, bodyEnd),
      from,
      to: close < 0 ? inner.length : close + "</Rally>".length,
    });
  }
  return out;
}

/**
 * One set's events, in document order.
 *
 * `setInner` is the inner XML of a `<Set>` block; the `<Events>` child is found
 * within it. A set with no `<Events>` (a payload without Options bit 1, or a
 * set that has not started) yields no rallies, which every caller treats as
 * "nothing to enforce" rather than as an error.
 */
export function parseSetEvents(
  setInner: string,
  opts: { noTeamA: number; noTeamB: number; sides: Map<string, Side> },
): SetEvents {
  const events = tagBlocks(setInner, "Events")[0]?.inner ?? "";
  if (!events) return { rallies: [], trailingSubs: [] };

  const slices = rallySlices(events);
  const rallies: RallyEvent[] = [];
  let prevA = 0;
  let prevB = 0;
  let cursor = 0;

  slices.forEach((slice, i) => {
    // Substitutions in the gap since the previous rally, then this rally's own.
    const gap = events.slice(cursor, slice.from);
    cursor = slice.to;
    const subsBefore = [
      ...subsIn(gap, opts.sides),
      ...subsIn(slice.inner, opts.sides),
    ];

    const scoreA = num(slice.attrs, "PointsTeamA");
    const scoreB = num(slice.attrs, "PointsTeamB");
    const firstAction = allTagAttrs(slice.inner, "Action")[0] ?? null;
    rallies.push({
      index: i + 1,
      scoreA,
      scoreB,
      winner: scoreA > prevA ? "A" : scoreB > prevB ? "B" : null,
      server: str(firstAction, "NoPlayer"),
      lineup: {
        A: lineupOf(slice.inner, opts.noTeamA),
        B: lineupOf(slice.inner, opts.noTeamB),
      },
      subsBefore,
    });
    prevA = scoreA;
    prevB = scoreB;
  });

  return { rallies, trailingSubs: subsIn(events.slice(cursor), opts.sides) };
}
