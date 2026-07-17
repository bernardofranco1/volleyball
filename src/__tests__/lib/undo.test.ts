import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS } from "@/engine/config";
import {
  computeAutoEmits,
  reduce as beachReduce,
  replayEvents as beachReplay,
} from "@/engine/beach/reducer";
import {
  type BeachEvent,
  type BeachEventPayload,
  type BeachMatchState,
  initialBeachState,
} from "@/engine/beach/types";
import { selectUndoTargets } from "@/lib/match-engine";
import type { EngineEvent } from "@/engine/registry";

const BEACH = DISCIPLINE_DEFAULTS.BEACH;
const TS = "2026-07-01T10:00:00.000Z";

/** Build a beach log up to the TTO trigger (10-10 → A point → sum 21). */
function buildLogIntoTto(): { events: BeachEvent[]; state: BeachMatchState } {
  const events: BeachEvent[] = [];
  let seq = 0;
  let state: BeachMatchState = initialBeachState("m1");
  const apply = (payload: BeachEventPayload) => {
    seq += 1;
    const e: BeachEvent = { id: `e${seq}`, sequence: seq, timestamp: TS, payload };
    events.push(e);
    state = beachReduce(state, e, BEACH);
  };
  const dispatch = (payload: BeachEventPayload) => {
    apply(payload);
    for (const em of computeAutoEmits(state, BEACH)) apply(em);
  };
  apply({ type: "MATCH_CREATED", matchId: "m1" });
  apply({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
  apply({ type: "MATCH_START" });
  apply({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
  for (let i = 0; i < 10; i++) {
    dispatch({ type: "RALLY_WON_A" });
    dispatch({ type: "RALLY_WON_B" });
  }
  dispatch({ type: "RALLY_WON_A" }); // sum 21 → auto TTO_START
  return { events, state };
}

// Regression: undoing during a TTO used to target the auto-emitted TTO_START
// only (mis-tapped point survived), and undoing only the rally left the
// surviving TTO_START replaying the match straight back into TTO_ACTIVE.
describe("undo during a TTO removes the rally AND its auto-emitted TTO_START", () => {
  it("selectUndoTargets picks the last scorer event plus trailing auto-emits", () => {
    const { events, state } = buildLogIntoTto();
    expect(state.rallyPhase).toBe("TTO_ACTIVE");

    // Sum 21 triggers BOTH the side switch (every 7) and the TTO — the undo
    // batch must remove the rally and all of its consequences.
    const targets = selectUndoTargets(events as unknown as EngineEvent[]);
    expect(targets.map((t) => t.payload.type)).toEqual([
      "RALLY_WON_A",
      "SIDE_SWITCH",
      "TTO_START",
    ]);
  });

  it("replaying with both tombstoned exits the TTO and restores the score", () => {
    const { events } = buildLogIntoTto();
    const targets = selectUndoTargets(events as unknown as EngineEvent[]);
    let seq = events[events.length - 1].sequence;
    const undos: BeachEvent[] = targets.map((t) => ({
      id: `u${++seq}`,
      sequence: seq,
      timestamp: TS,
      payload: { type: "UNDO", targetEventId: t.id },
    }));

    const state = beachReplay("m1", [...events, ...undos], BEACH);
    expect(state.rallyPhase).toBe("BETWEEN_RALLIES");
    expect(state.ttoActive).toBe(false);
    const set = state.sets[0];
    expect(set.scoreA).toBe(10);
    expect(set.scoreB).toBe(10);
    // The TTO has NOT been consumed — the next trigger point re-fires it.
    expect(set.ttoFired).toBe(false);
  });

  it("a second undo then removes the previous rally (not the TTO bookkeeping)", () => {
    const { events } = buildLogIntoTto();
    let log = [...events] as unknown as EngineEvent[];
    let seq = events[events.length - 1].sequence;
    const undoOnce = () => {
      const targets = selectUndoTargets(log);
      log = [
        ...log,
        ...targets.map((t) => ({
          id: `u${++seq}`,
          sequence: seq,
          timestamp: TS,
          payload: { type: "UNDO", targetEventId: t.id },
        })),
      ] as EngineEvent[];
    };
    undoOnce(); // removes RALLY_WON_A + TTO_START
    const second = selectUndoTargets(log);
    expect(second.map((t) => t.payload.type)).toEqual(["RALLY_WON_B"]);
  });

  it("returns [] when only system/undone events remain", () => {
    expect(selectUndoTargets([])).toEqual([]);
    const onlySystem = [
      {
        id: "s1",
        sequence: 1,
        timestamp: TS,
        payload: { type: "SET_END", setNumber: 1, winner: "A", scoreA: 21, scoreB: 10 },
      },
    ] as unknown as EngineEvent[];
    expect(selectUndoTargets(onlySystem)).toEqual([]);
  });
});

import { shouldSnapshot } from "@/lib/match-engine";

describe("shouldSnapshot (snapshot cache write policy)", () => {
  const live = (seq: number) => ({ lastSequence: seq, status: "LIVE" as const });
  const ev = (type: string): EngineEvent =>
    ({ id: "x", sequence: 1, timestamp: TS, payload: { type } }) as EngineEvent;

  it("always snapshots when none exists", () => {
    expect(shouldSnapshot(false, 0, live(1), [ev("RALLY_WON_A")])).toBe(true);
  });
  it("skips within the interval, writes at the boundary", () => {
    expect(shouldSnapshot(true, 10, live(12), [ev("RALLY_WON_A")])).toBe(false);
    expect(shouldSnapshot(true, 10, live(15), [ev("RALLY_WON_A")])).toBe(true);
  });
  it("writes when the match leaves LIVE or on system auto-emits", () => {
    expect(
      shouldSnapshot(true, 10, { lastSequence: 11, status: "FINISHED" }, [ev("RALLY_WON_A")]),
    ).toBe(true);
    expect(shouldSnapshot(true, 10, live(11), [ev("RALLY_WON_A"), ev("SET_END")])).toBe(true);
  });
});

import { appendGrassEvent, replayEvents as grassReplay } from "@/engine/grass/reducer";
import {
  type GrassEvent,
  type GrassEventPayload,
  type GrassMatchState,
  initialGrassState,
} from "@/engine/grass/types";

// Regression: the lineup-confirmation step used to trap scorers — no undo was
// reachable, and cancelling needed to unwind LINEUP_CONFIRMED(s) AND SET_START.
describe("cancel set start: repeated undo unwinds lineups then SET_START", () => {
  const GRASS = DISCIPLINE_DEFAULTS.GRASS;

  function build(): { log: GrassEvent[]; state: GrassMatchState } {
    let state = initialGrassState("g1");
    let seq = 0;
    const log: GrassEvent[] = [];
    const send = (payload: GrassEventPayload) => {
      const r = appendGrassEvent(state, payload, GRASS, {
        nextSequence: seq + 1,
        timestamp: TS,
        makeId: (s) => `g${s}`,
      });
      if (!r.ok) throw new Error(`rejected ${payload.type}: ${r.reason}`);
      log.push(...r.newEvents);
      seq = r.newEvents[r.newEvents.length - 1].sequence;
      state = r.state;
    };
    send({ type: "MATCH_CREATED", matchId: "g1" });
    send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "MATCH_START" });
    send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    send({
      type: "LINEUP_CONFIRMED",
      setNumber: 1,
      teamAPlayerIds: ["a1", "a2", "a3"],
      teamBPlayerIds: ["b1", "b2", "b3"],
    });
    return { log, state };
  }

  it("peels LINEUP_CONFIRMED first, then SET_START, restoring the pre-set state", () => {
    const { log, state } = build();
    expect(state.rallyPhase).toBe("BETWEEN_RALLIES"); // lineups in → ready to play

    let full = [...log] as unknown as EngineEvent[];
    let seq = log[log.length - 1].sequence;
    const undoOnce = (expected: string) => {
      const targets = selectUndoTargets(full);
      expect(targets.map((t) => t.payload.type)).toEqual([expected]);
      full = [
        ...full,
        ...targets.map((t) => ({
          id: `u${++seq}`,
          sequence: seq,
          timestamp: TS,
          payload: { type: "UNDO", targetEventId: t.id },
        })),
      ] as EngineEvent[];
    };

    undoOnce("LINEUP_CONFIRMED");
    undoOnce("SET_START");

    const replayed = grassReplay("g1", full as unknown as GrassEvent[], GRASS);
    // Back to "match live, set not started" — the Start set 1 banner state.
    expect(replayed.status).toBe("LIVE");
    expect(replayed.sets.length).toBe(0);
    expect(replayed.currentSetNumber).toBe(1);
  });
});

// ── REWIND (admin re-score from a point, spec/17) ────────────────────────────
// REWIND{toSequence:N} keeps events with sequence <= N and tombstones the rest
// on replay; re-scored events appended after it survive. Resolved by the shared
// createReplayFn, so exercising one discipline covers all four.
describe("rewind: replay truncates to the cutoff and re-scoring survives", () => {
  const GRASS = DISCIPLINE_DEFAULTS.GRASS;
  const rewindEv = (seq: number, toSequence: number) =>
    ({ id: `r${seq}`, sequence: seq, timestamp: TS, payload: { type: "REWIND", toSequence } }) as unknown as GrassEvent;

  function playedSet(): { log: GrassEvent[]; state: GrassMatchState } {
    let state = initialGrassState("gr");
    let seq = 0;
    const log: GrassEvent[] = [];
    const send = (payload: GrassEventPayload) => {
      const r = appendGrassEvent(state, payload, GRASS, {
        nextSequence: seq + 1, timestamp: TS, makeId: (n) => `g${n}`,
      });
      if (!r.ok) throw new Error(`rejected ${payload.type}: ${r.reason}`);
      log.push(...r.newEvents);
      seq = r.newEvents[r.newEvents.length - 1].sequence;
      state = r.state;
    };
    send({ type: "MATCH_CREATED", matchId: "gr" });
    send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "MATCH_START" });
    send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "LINEUP_CONFIRMED", setNumber: 1, teamAPlayerIds: ["a1","a2","a3"], teamBPlayerIds: ["b1","b2","b3"] });
    for (let i = 0; i < 5; i++) send({ type: "RALLY_WON_A" });
    return { log, state };
  }

  it("erases points after the cutoff (5-0 rewound to keep 3 points -> 3-0)", () => {
    const { log, state } = playedSet();
    expect(state.sets[0].scoreA).toBe(5);
    // Keep through the sequence of the 3rd rally point; erase the rest.
    const rallies = log.filter((e) => e.payload.type === "RALLY_WON_A");
    const keepThrough = rallies[2].sequence;
    const rewound = grassReplay(
      "gr",
      [...log, rewindEv(log[log.length - 1].sequence + 1, keepThrough)],
      GRASS,
    );
    expect(rewound.sets[0].scoreA).toBe(3);
  });

  it("re-scoring after a rewind survives, and a deeper rewind supersedes", () => {
    const { log } = playedSet();
    const rallies = log.filter((e) => e.payload.type === "RALLY_WON_A");
    let seq = log[log.length - 1].sequence;
    // Rewind to keep 2 points, then re-score 4 more (new sequences after REWIND).
    let full = [...log, rewindEv(++seq, rallies[1].sequence)] as unknown as GrassEvent[];
    let state = grassReplay("gr", full, GRASS);
    const send = (payload: GrassEventPayload) => {
      const r = appendGrassEvent(state, payload, GRASS, {
        nextSequence: seq + 1, timestamp: TS, makeId: (n) => `x${n}`,
      });
      if (!r.ok) throw new Error(r.reason);
      full = [...full, ...r.newEvents] as GrassEvent[];
      seq = r.newEvents[r.newEvents.length - 1].sequence;
      state = r.state;
    };
    send({ type: "RALLY_WON_B" });
    send({ type: "RALLY_WON_B" });
    expect(grassReplay("gr", full, GRASS).sets[0].scoreA).toBe(2);
    expect(grassReplay("gr", full, GRASS).sets[0].scoreB).toBe(2);
    // A second, deeper rewind (keep only 1 A point) supersedes both.
    full = [...full, rewindEv(++seq, rallies[0].sequence)] as GrassEvent[];
    const finalState = grassReplay("gr", full, GRASS);
    expect(finalState.sets[0].scoreA).toBe(1);
    expect(finalState.sets[0].scoreB).toBe(0);
  });

  it("keeps replay contiguous/without gaps (integrity holds after rewind)", () => {
    const { log } = playedSet();
    const withRewind = [...log, rewindEv(log[log.length - 1].sequence + 1, log[3].sequence)];
    // Every stored event (incl. REWIND) has a contiguous sequence.
    const seqs = withRewind.map((e) => e.sequence);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });
});

// A completed time-out must be undone as one unit (END + REQUEST): peeling
// only the END dropped the scorer back into an expired time-out whose auto-end
// timer re-fired instantly, so Undo could never reach the point before it.
describe("undo beyond a completed time-out", () => {
  function buildLogWithTimeout(alsoMedical = false) {
    const events: BeachEvent[] = [];
    let seq = 0;
    let state: BeachMatchState = initialBeachState("m1");
    const apply = (payload: BeachEventPayload) => {
      seq += 1;
      const e: BeachEvent = { id: `e${seq}`, sequence: seq, timestamp: TS, payload };
      events.push(e);
      state = beachReduce(state, e, BEACH);
    };
    apply({ type: "MATCH_CREATED", matchId: "m1" });
    apply({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    apply({ type: "MATCH_START" });
    apply({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    apply({ type: "RALLY_WON_A" });
    apply({ type: "TIMEOUT_REQUEST", team: "B" });
    apply({ type: "TIMEOUT_END", team: "B" });
    if (alsoMedical) {
      apply({ type: "MEDICAL_TIMEOUT", team: "A" });
      apply({ type: "MEDICAL_TIMEOUT_END" });
    }
    return { events, state };
  }

  it("targets TIMEOUT_END together with its TIMEOUT_REQUEST", () => {
    const { events, state } = buildLogWithTimeout();
    expect(state.rallyPhase).toBe("BETWEEN_RALLIES");
    const targets = selectUndoTargets(events as unknown as EngineEvent[]);
    expect(targets.map((t) => t.payload.type).sort()).toEqual([
      "TIMEOUT_END",
      "TIMEOUT_REQUEST",
    ]);
  });

  it("replaying with the pair tombstoned removes the time-out entirely", () => {
    const { events } = buildLogWithTimeout();
    const targets = selectUndoTargets(events as unknown as EngineEvent[]);
    let seq = events[events.length - 1].sequence;
    const undos: BeachEvent[] = targets.map((t) => ({
      id: `u${++seq}`,
      sequence: seq,
      timestamp: TS,
      payload: { type: "UNDO", targetEventId: t.id },
    }));
    const state = beachReplay("m1", [...events, ...undos], BEACH);
    expect(state.rallyPhase).toBe("BETWEEN_RALLIES");
    expect(state.sets[0].timeoutsUsedB).toBe(0);
    expect(state.sets[0].scoreA).toBe(1); // the point before survives...
    // ...and the NEXT undo reaches it.
    const next = selectUndoTargets([...events, ...undos] as unknown as EngineEvent[]);
    expect(next.map((t) => t.payload.type)).toEqual(["RALLY_WON_A"]);
  });

  it("pairs MEDICAL_TIMEOUT_END with MEDICAL_TIMEOUT the same way", () => {
    const { events } = buildLogWithTimeout(true);
    const targets = selectUndoTargets(events as unknown as EngineEvent[]);
    expect(targets.map((t) => t.payload.type).sort()).toEqual([
      "MEDICAL_TIMEOUT",
      "MEDICAL_TIMEOUT_END",
    ]);
  });

  it("undo DURING a time-out still targets only the TIMEOUT_REQUEST", () => {
    const { events } = buildLogWithTimeout();
    const during = events.filter((e) => e.payload.type !== "TIMEOUT_END");
    const targets = selectUndoTargets(during as unknown as EngineEvent[]);
    expect(targets.map((t) => t.payload.type)).toEqual(["TIMEOUT_REQUEST"]);
  });
});
