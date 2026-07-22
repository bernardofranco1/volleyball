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
import { appendGrassEvent, replayEvents as grassReplay } from "@/engine/grass/reducer";
import {
  type GrassEvent,
  type GrassEventPayload,
  type GrassMatchState,
  initialGrassState,
} from "@/engine/grass/types";
import { selectUndoTargets } from "@/lib/match-engine";
import type { EngineEvent } from "@/engine/registry";

const BEACH = DISCIPLINE_DEFAULTS.BEACH;
const GRASS = DISCIPLINE_DEFAULTS.GRASS;
const TS = "2026-07-01T10:00:00.000Z";

// ── scope "point": the scorer's Undo button sweeps set-start bookkeeping ─────
// (SET_START / SERVICE_ORDER / LINEUP_CONFIRMED) and the last real action in
// ONE atomic batch, so "undo the set-winning point" is a single press even
// after the next set auto-started. scope "single" (default; CancelSetStart's
// counted loop) keeps the strict one-event-per-undo behaviour.

function beachHarness() {
  let seq = 0;
  let state: BeachMatchState = initialBeachState("m1");
  const log: BeachEvent[] = [];
  const apply = (payload: BeachEventPayload) => {
    seq += 1;
    const e: BeachEvent = { id: `e${seq}`, sequence: seq, timestamp: TS, payload };
    log.push(e);
    state = beachReduce(state, e, BEACH);
  };
  const dispatch = (payload: BeachEventPayload) => {
    apply(payload);
    for (const em of computeAutoEmits(state, BEACH)) apply(em);
  };
  const undo = (scope?: "single" | "point") => {
    const targets = selectUndoTargets(log as unknown as EngineEvent[], scope);
    for (const t of targets) {
      seq += 1;
      log.push({
        id: `u${seq}`,
        sequence: seq,
        timestamp: TS,
        payload: { type: "UNDO", targetEventId: t.id },
      });
    }
    return {
      types: targets.map((t) => t.payload.type),
      state: beachReplay("m1", log, BEACH),
    };
  };
  return { apply, dispatch, undo, getState: () => state, log };
}

/** Beach match played to a finished set 1 (21-19 A) with set 2 started. */
function beachAtSet2Start(withServiceOrders: boolean) {
  const h = beachHarness();
  h.apply({ type: "MATCH_CREATED", matchId: "m1" });
  h.apply({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
  h.apply({ type: "MATCH_START" });
  h.apply({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
  for (let i = 0; i < 19; i++) {
    h.dispatch({ type: "RALLY_WON_A" });
    h.dispatch({ type: "RALLY_WON_B" });
  }
  h.dispatch({ type: "RALLY_WON_A" }); // 20-19
  h.dispatch({ type: "RALLY_WON_A" }); // 21-19 → SET_END
  h.dispatch({ type: "SET_START", setNumber: 2, firstServer: "B", teamAStartSide: "RIGHT" });
  if (withServiceOrders) {
    h.dispatch({ type: "SERVICE_ORDER", team: "B", firstServerPlayerId: "pb1" });
    h.dispatch({ type: "SERVICE_ORDER", team: "A", firstServerPlayerId: "pa2" });
  }
  return h;
}

describe("scope 'point': one press undoes the set-winning point across the boundary", () => {
  it("sweeps SERVICE_ORDERs + SET_START + the winning rally (+SET_END) in one batch", () => {
    const h = beachAtSet2Start(true);
    const { types, state } = h.undo("point");
    expect(types).toContain("SERVICE_ORDER");
    expect(types).toContain("SET_START");
    expect(types).toContain("RALLY_WON_A");
    expect(types).toContain("SET_END");
    expect(types.filter((t) => t === "SERVICE_ORDER")).toHaveLength(2);
    // Set 1 reopened at 20-19, set 2 gone.
    expect(state.currentSetNumber).toBe(1);
    expect(state.sets).toHaveLength(1);
    expect(state.sets[0].winner).toBeNull();
    expect(state.sets[0].scoreA).toBe(20);
    expect(state.sets[0].scoreB).toBe(19);
    expect(state.setsWonA).toBe(0);
    expect(state.rallyPhase).toBe("BETWEEN_RALLIES");
  });

  it("sweeps a bare SET_START the auto-advance dispatched", () => {
    const h = beachAtSet2Start(false);
    const { types, state } = h.undo("point");
    expect(types).toContain("SET_START");
    expect(types).toContain("RALLY_WON_A");
    expect(state.sets[0].scoreA).toBe(20);
    expect(state.sets[0].winner).toBeNull();
  });

  it("mid-set it behaves exactly like a single undo (one rally)", () => {
    const h = beachAtSet2Start(true);
    h.dispatch({ type: "RALLY_WON_B" });
    h.dispatch({ type: "RALLY_WON_A" }); // set 2: 1-1
    const { types, state } = h.undo("point");
    expect(types).toEqual(["RALLY_WON_A"]);
    expect(state.sets[1].scoreA).toBe(0);
    expect(state.sets[1].scoreB).toBe(1);
    expect(state.sets[0].winner).toBe("A"); // set 1 untouched
  });

  it("never crosses match-lifecycle events: at a fresh set 1 it only cancels the set start", () => {
    const h = beachHarness();
    h.apply({ type: "MATCH_CREATED", matchId: "m1" });
    h.apply({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    h.apply({ type: "MATCH_START" });
    h.apply({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    h.dispatch({ type: "SERVICE_ORDER", team: "A", firstServerPlayerId: "pa1" });
    const { types, state } = h.undo("point");
    expect(types.sort()).toEqual(["SERVICE_ORDER", "SET_START"]);
    expect(state.status).toBe("LIVE"); // MATCH_START survived
    expect(state.sets).toHaveLength(0);
  });

  it("still undoes a completed time-out as one unit when it is the last real action", () => {
    const h = beachHarness();
    h.apply({ type: "MATCH_CREATED", matchId: "m1" });
    h.apply({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    h.apply({ type: "MATCH_START" });
    h.apply({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    h.dispatch({ type: "RALLY_WON_A" });
    h.dispatch({ type: "TIMEOUT_REQUEST", team: "B" });
    h.dispatch({ type: "TIMEOUT_END", team: "B" });
    const { types, state } = h.undo("point");
    expect(types.sort()).toEqual(["TIMEOUT_END", "TIMEOUT_REQUEST"]);
    expect(state.sets[0].timeoutsUsedB).toBe(0);
    expect(state.sets[0].scoreA).toBe(1);
  });

  it("returns [] on an empty log", () => {
    expect(selectUndoTargets([], "point")).toEqual([]);
  });

  it("default scope stays single-step (CancelSetStart contract)", () => {
    const h = beachAtSet2Start(true);
    // No scope argument → one scorer event per undo, bookkeeping first.
    expect(h.undo().types).toEqual(["SERVICE_ORDER"]);
    expect(h.undo().types).toEqual(["SERVICE_ORDER"]);
    expect(h.undo().types).toEqual(["SET_START"]);
    const step = h.undo();
    expect(step.types).toContain("RALLY_WON_A");
    expect(step.state.sets[0].scoreA).toBe(20);
  });
});

describe("scope 'point' on a rotation discipline (grass): lineups are swept too", () => {
  it("undoes LINEUP_CONFIRMED + SET_START + the set-winning rally in one batch", () => {
    let state: GrassMatchState = initialGrassState("g1");
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
    const target = GRASS.setScore;
    for (let i = 0; i < target; i++) send({ type: "RALLY_WON_A" }); // win set 1
    expect(state.sets[0].winner).toBe("A");
    send({ type: "SET_START", setNumber: 2, firstServer: "B", teamAStartSide: "RIGHT" });
    send({
      type: "LINEUP_CONFIRMED",
      setNumber: 2,
      teamAPlayerIds: ["a1", "a2", "a3"],
      teamBPlayerIds: ["b1", "b2", "b3"],
    });

    const targets = selectUndoTargets(log as unknown as EngineEvent[], "point");
    const types = targets.map((t) => t.payload.type);
    expect(types).toContain("LINEUP_CONFIRMED");
    expect(types).toContain("SET_START");
    expect(types).toContain("RALLY_WON_A");
    expect(types).toContain("SET_END");
    // Exactly ONE rally is removed — the sweep must not eat the set.
    expect(types.filter((t) => t === "RALLY_WON_A")).toHaveLength(1);

    let s = seq;
    const undos = targets.map((t) => ({
      id: `u${++s}`,
      sequence: s,
      timestamp: TS,
      payload: { type: "UNDO", targetEventId: t.id },
    })) as unknown as GrassEvent[];
    const replayed = grassReplay("g1", [...log, ...undos], GRASS);
    expect(replayed.currentSetNumber).toBe(1);
    expect(replayed.sets[0].winner).toBeNull();
    expect(replayed.sets[0].scoreA).toBe(target - 1);
    expect(replayed.setsWonA).toBe(0);
  });
});
