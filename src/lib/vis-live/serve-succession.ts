/**
 * Serve succession: the rotation the RULES give, not the one the feed drew
 * (spec/43).
 *
 * The rule, which has no exceptions:
 *
 *   R1 — the serving team wins the rally: the SAME player serves the next one,
 *        unless a substitution replaced them in between.
 *   R2 — the receiving team wins the rally (a side-out): that team rotates one
 *        place and the player who stood at POSITION 2 during that rally serves
 *        the next one, unless a substitution replaced them in between.
 *   R3 — a libero never serves (FIVB 19.3.2.1). A libero at position 1 of the
 *        SERVING side is always wrong; at position 1 of the RECEIVING side it
 *        is legal and does happen, and must be left alone.
 *
 * A libero exchange arrives as an ordinary `<Substitution>` event, so "unless
 * substituted" already covers it and no special case is needed.
 *
 * Measured over four full matches (27550, 27547, 27549, 26959 — 540 rallies) on
 * 2026-08-20, this model predicts the player who actually served in **539 of
 * 540** rallies, with zero membership drift and zero substitutions whose
 * outgoing player was not on court. The one miss is 27550 set 1 rally 15, where
 * a player served out of turn on court, the fault was called, and the opponent
 * took the point — a real event no model can predict.
 *
 * WHY THIS OVERRIDES THE FEED (the spec/42 decision, reversed on evidence).
 * The feed's per-rally `LineUp` is stale or wrong often enough to matter: match
 * 27550 never applied nine rotations. But the feed's own serve actions agree
 * with this model through all nine, so the model — not the feed — is what
 * belongs on an arena screen. The feed remains the source of MEMBERSHIP (who is
 * on court, via substitution events) and of everything else on the board.
 *
 * THE ARBITRATION POLICY, and why it is not "reality always wins".
 * Following an observed server unconditionally was measured and rejected: on
 * 27550 rally 15 it rotates the model two places and then mispredicts that
 * team's next serve (rally 17) and beyond. The rule is therefore **the observed
 * server wins only when the model stands alone**:
 *
 *   - the feed's rally lineup has the OBSERVED server at P1 → the model is out
 *     of sync, re-anchor on reality;
 *   - all three disagree → the serve is still the best evidence, re-anchor;
 *   - the feed's rally lineup has the PREDICTED server at P1 (model and feed
 *     agree, only the serve differs) → an on-court wrong-server fault or a
 *     scouting slip. Change nothing, log it.
 *
 * Two independent sources agreeing beat one anomalous observation; one source
 * standing alone loses to an observation.
 *
 * Pure and recomputed from the whole set stream on every poll, so a corrected
 * score or an overturned challenge self-corrects with no cross-poll drift.
 */

import type { SetEvents, SubstitutionEvent } from "./events";
import {
  inferFirstServer,
  rotateOnce,
  type RallyFacts,
  type Side,
  type Six,
} from "./rotation";

export type EnforcementKind =
  /** The model was out of sync; rotated onto the observed server. */
  | "reanchor-rotation"
  /** The observed server was not on court in the model; membership reseeded. */
  | "reanchor-reseed"
  /** A serve the rules forbid, which the feed's own lineup also contradicts. */
  | "serve-anomaly"
  /** A substitution whose outgoing player the model did not have on court. */
  | "sub-target-missing"
  /** The feed's published order for a recorded rally, judged by its serve. */
  | "feed-wrong-confirmed"
  | "model-wrong-confirmed"
  /** Refused to seat a libero in the serving position. */
  | "libero-serving-refused";

export interface EnforcementNote {
  kind: EnforcementKind;
  side: Side;
  /** Rally index within the set; 0 for the rally in progress. */
  rallyNo: number;
  observedServer: string | null;
  predictedServer: string | null;
  feedSix: string | null;
  modelSix: string | null;
  scoreA: number;
  scoreB: number;
}

export type FirstServerConfidence = "observed" | "action" | "inferred" | "unknown";

export interface EnforcedLineups {
  /** The six for the rally IN PROGRESS, position 1 first; null = use fallback. */
  A: Six | null;
  B: Six | null;
  basis: "enforced" | "fallback";
  firstServer: Side | null;
  confidence: FirstServerConfidence;
  notes: EnforcementNote[];
}

const NOTHING: EnforcedLineups = {
  A: null,
  B: null,
  basis: "fallback",
  firstServer: null,
  confidence: "unknown",
  notes: [],
};

/** `RallyFacts` for the rotation helpers, from the richer event rows. */
function factsOf(events: SetEvents): RallyFacts[] {
  return events.rallies.map((r) => ({
    index: r.index,
    scoreA: r.scoreA,
    scoreB: r.scoreB,
    winner: r.winner,
  }));
}

/** Apply one substitution in place: the incoming player takes the outgoing
 * player's position. Rotation and substitution commute — a substitution
 * relabels one slot, a rotation permutes slots — so their order never
 * matters, which is why this can be applied whenever the feed states it. */
function substitute(six: Six, sub: SubstitutionEvent): Six | null {
  const at = six.indexOf(sub.out);
  if (at < 0) return null;
  const next = [...six];
  next[at] = sub.in;
  return next;
}

export function enforceLineups(opts: {
  events: SetEvents;
  /** The set's own `LineUp` rows, before its `Events` — the starting six. */
  startingLineups: { A: Six | null; B: Six | null };
  liberos: ReadonlySet<string>;
  /** Roster number → side, for attributing serves. */
  sides: Map<string, Side>;
  /** The set's first server when the store observed it (spec/42). */
  remembered: Side | null;
}): EnforcedLineups {
  const { events, startingLineups, liberos, sides, remembered } = opts;
  if (!startingLineups.A || !startingLineups.B) return NOTHING;
  const start: Record<Side, Six> = { A: startingLineups.A, B: startingLineups.B };

  const facts = factsOf(events);

  // Nothing has been played: nobody has rotated, so the starting six IS the six
  // on court once the substitutions already recorded are applied. That is not a
  // hypothetical case — EVERY set begins with one, because a libero taking the
  // court is delivered as a substitution against the registered six (measured:
  // 21 of the 24 set-sides in the four reference matches). Enforced rather than
  // fallback even when the first server is not yet known, since without a rally
  // there is no rotation to get wrong.
  if (facts.length === 0) {
    const six: Record<Side, Six> = { A: [...start.A], B: [...start.B] };
    for (const sub of events.trailingSubs) {
      if (!sub.side) continue;
      six[sub.side] = substitute(six[sub.side], sub) ?? six[sub.side];
    }
    return {
      A: six.A,
      B: six.B,
      basis: "enforced",
      firstServer: remembered,
      confidence: remembered ? "observed" : "unknown",
      notes: [],
    };
  }

  // 1. Who served the set's first rally.
  const { firstServer, confidence } = resolveFirstServer(
    { events, liberos, sides, remembered },
    start,
    facts,
  );
  if (!firstServer) return NOTHING;

  // 2. Seed, then walk the set forward one rally at a time.
  const six: Record<Side, Six> = { A: [...start.A], B: [...start.B] };
  const notes: EnforcementNote[] = [];
  let serving: Side = firstServer;

  for (const rally of events.rallies) {
    for (const sub of rally.subsBefore) {
      if (!sub.side) continue;
      const next = substitute(six[sub.side], sub);
      if (next) {
        six[sub.side] = next;
        continue;
      }
      // Never seen in four matches, but if the model has lost track of who is
      // on court the feed's own lineup is the only way back.
      const feed = rally.lineup[sub.side];
      notes.push(
        note("sub-target-missing", sub.side, rally, {
          model: six[sub.side],
          feed,
          predicted: six[sub.side][0] ?? null,
        }),
      );
      if (feed) six[sub.side] = [...feed];
    }

    // `six` is now the model's lineup FOR this rally. Judge it against the two
    // things that can be known about it: the recorded serve, and the feed's own
    // published order.
    arbitrate(rally, six, notes, sides, liberos);

    // 3. Advance to the next rally: the winner of a side-out rotates to serve.
    if (rally.winner && rally.winner !== serving) {
      six[rally.winner] = rotateOnce(six[rally.winner]);
      serving = rally.winner;
    }
  }

  // 4. Substitutions recorded after the last rally are already on court.
  for (const sub of events.trailingSubs) {
    if (!sub.side) continue;
    const next = substitute(six[sub.side], sub);
    if (next) six[sub.side] = next;
  }

  // 5. R3, belt and braces. The walk above should make this unreachable; a row
  // of it in the log is therefore a defect signal, not a routine event.
  const out: EnforcedLineups = {
    A: six.A,
    B: six.B,
    basis: "enforced",
    firstServer,
    confidence,
    notes,
  };
  const last = events.rallies[events.rallies.length - 1];
  if (liberos.has(six[serving][0])) {
    notes.push({
      kind: "libero-serving-refused",
      side: serving,
      rallyNo: 0,
      observedServer: null,
      predictedServer: six[serving][0],
      feedSix: last.lineup[serving]?.join(",") ?? null,
      modelSix: six[serving].join(","),
      scoreA: last.scoreA,
      scoreB: last.scoreB,
    });
    out[serving] = null;
    if (!out.A && !out.B) out.basis = "fallback";
  }
  return out;
}

function resolveFirstServer(
  opts: {
    events: SetEvents;
    liberos: ReadonlySet<string>;
    sides: Map<string, Side>;
    remembered: Side | null;
  },
  starting: Record<Side, Six>,
  facts: RallyFacts[],
): { firstServer: Side | null; confidence: FirstServerConfidence } {
  const { events, liberos, sides, remembered } = opts;
  // (a) Observed in the moment before the set had any rallies (spec/42).
  if (remembered) return { firstServer: remembered, confidence: "observed" };
  // (b) The first rally's own serve action names the team outright — available
  //     on any instance, however cold, as soon as one rally exists.
  const opener = events.rallies[0]?.server;
  const openerSide = opener ? sides.get(opener) : undefined;
  if (openerSide) return { firstServer: openerSide, confidence: "action" };
  // (c) spec/42's dual-hypothesis inference, for a payload with no actions.
  const inferred = inferFirstServer(
    facts,
    starting,
    {
      A: events.rallies.map((r) => r.lineup.A),
      B: events.rallies.map((r) => r.lineup.B),
    },
    liberos,
    null,
  );
  return {
    firstServer: inferred.firstServer,
    confidence: inferred.firstServer ? "inferred" : "unknown",
  };
}

/**
 * Judge the model's lineup for one recorded rally, and correct it only when the
 * model stands alone (see the module comment). Mutates `six` for the serving
 * side when it re-anchors, and appends what it found.
 */
function arbitrate(
  rally: SetEvents["rallies"][number],
  six: Record<Side, Six>,
  notes: EnforcementNote[],
  sides: Map<string, Side>,
  liberos: ReadonlySet<string>,
): void {
  const observed = rally.server;
  if (!observed) return;
  const side = sides.get(observed);
  if (!side) return;

  const model = six[side];
  const feed = rally.lineup[side];
  const predicted = model[0] ?? null;
  const record = (kind: EnforcementKind) =>
    notes.push(note(kind, side, rally, { model, feed, predicted }));

  if (predicted === observed) {
    // The model is right about the server. If the feed drew a different order
    // for the same six, the serve has just adjudicated between them — which is
    // the evidence spec/42's shadow log was built to gather.
    if (feed && feed.join() !== model.join() && sameSquad(feed, model)) {
      record(feed[0] === observed ? "model-wrong-confirmed" : "feed-wrong-confirmed");
    }
    return;
  }

  // A libero cannot have served (FIVB 19.3.2.1), so a serve action naming one
  // is bad data whatever else agrees with it. Never re-anchor onto it.
  if (liberos.has(observed)) {
    record("libero-serving-refused");
    return;
  }

  if (feed?.[0] === predicted) {
    // Model and feed agree; only the serve differs. That is a wrong-server
    // fault on court or a scouting slip — one observation against two sources —
    // so the model stands. Following it here corrupts the rest of the set
    // (measured on 27550 rally 15; see the module comment).
    record("serve-anomaly");
    return;
  }

  // The model stands alone: follow reality.
  const at = model.indexOf(observed);
  if (at >= 0) {
    six[side] = [...model.slice(at), ...model.slice(0, at)];
    record("reanchor-rotation");
    return;
  }
  if (feed) {
    six[side] = [...feed];
    record("reanchor-reseed");
  }
}

function sameSquad(a: Six, b: Six): boolean {
  return [...a].sort().join(",") === [...b].sort().join(",");
}

function note(
  kind: EnforcementKind,
  side: Side,
  rally: SetEvents["rallies"][number],
  seen: { model: Six; feed: Six | null; predicted: string | null },
): EnforcementNote {
  return {
    kind,
    side,
    rallyNo: rally.index,
    observedServer: rally.server,
    predictedServer: seen.predicted,
    feedSix: seen.feed?.join(",") ?? null,
    modelSix: seen.model.join(","),
    scoreA: rally.scoreA,
    scoreB: rally.scoreB,
  };
}
