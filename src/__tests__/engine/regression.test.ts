import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS } from "@/engine/config";
import {
  computeAutoEmits,
  reduce as beachReduce,
  replayEvents as beachReplay,
} from "@/engine/beach/reducer";
import { validateBeachEvent } from "@/engine/beach/validator";
import {
  type BeachEvent,
  type BeachEventPayload,
  type BeachMatchState,
  initialBeachState,
} from "@/engine/beach/types";
import { reduce as indoorReduce } from "@/engine/indoor/reducer";
import {
  type IndoorEvent,
  type IndoorEventPayload,
  initialIndoorState,
} from "@/engine/indoor/types";

const BEACH = DISCIPLINE_DEFAULTS.BEACH;
const INDOOR = DISCIPLINE_DEFAULTS.INDOOR;
const TS = "2026-06-26T10:00:00.000Z";

// ── Regression: mid-set TTO leaves an interstitial phase (the Phase-10 bug) ───
//
// A rally that brings the point-sum to the TTO trigger auto-emits TTO_START,
// which moves rallyPhase to TTO_ACTIVE. Until TTO_END, further rallies must be
// rejected — appending one previously threw uncaught (spec/14 §A2 / §C2 root).

describe("beach: mid-set TTO blocks the next rally until TTO_END", () => {
  it("auto-emits TTO_START at the trigger sum and rejects the next rally", () => {
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
    // 10-10 → next A point makes sum 21 (the TTO trigger).
    dispatch({ type: "RALLY_WON_A" });
    expect(state.rallyPhase).toBe("TTO_ACTIVE");
    expect(events.some((e) => e.payload.type === "TTO_START")).toBe(true);

    const blocked = validateBeachEvent({ type: "RALLY_WON_A" }, state, BEACH);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/not in a rally/i);

    apply({ type: "TTO_END" });
    expect(validateBeachEvent({ type: "RALLY_WON_A" }, state, BEACH).ok).toBe(true);
  });
});

// ── Regression: snapshot + tail replay === full replay (spec/14 §C1) ──────────

describe("snapshot equivalence (pure)", () => {
  it("reducing from a mid-log snapshot + tail equals a full replay", () => {
    const events: BeachEvent[] = [];
    let seq = 0;
    let s: BeachMatchState = initialBeachState("m1");
    const apply = (payload: BeachEventPayload) => {
      seq += 1;
      const e: BeachEvent = { id: `e${seq}`, sequence: seq, timestamp: TS, payload };
      events.push(e);
      s = beachReduce(s, e, BEACH);
    };
    const dispatch = (payload: BeachEventPayload) => {
      apply(payload);
      for (const em of computeAutoEmits(s, BEACH)) apply(em);
    };
    apply({ type: "MATCH_CREATED", matchId: "m1" });
    apply({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    apply({ type: "MATCH_START" });
    apply({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    for (let i = 0; i < 7; i++) dispatch({ type: "RALLY_WON_A" });
    for (let i = 0; i < 5; i++) dispatch({ type: "RALLY_WON_B" });

    const full = beachReplay("m1", events, BEACH);
    // Snapshot at an arbitrary mid-point, then replay only the tail onto it.
    const k = 6;
    const snapshot = beachReplay("m1", events.slice(0, k), BEACH);
    let tailState = snapshot;
    for (const e of events.slice(k)) tailState = beachReduce(tailState, e, BEACH);
    expect(tailState).toEqual(full);
  });
});

// ── Regression: indoor libero may not rotate into the front row (spec/14 §E3) ─

describe("indoor: libero is replaced out when it rotates to the front row", () => {
  it("auto-removes the libero and returns the replaced player", () => {
    let seq = 0;
    let s = initialIndoorState("m1");
    const apply = (payload: IndoorEventPayload) => {
      seq += 1;
      const e: IndoorEvent = { id: `e${seq}`, sequence: seq, timestamp: TS, payload };
      s = indoorReduce(s, e, INDOOR);
    };
    apply({ type: "MATCH_CREATED", matchId: "m1" });
    apply({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    apply({ type: "MATCH_START" });
    apply({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    apply({ type: "LINEUP_CONFIRMED", team: "A", setNumber: 1, playerIds: ["a1", "a2", "a3", "a4", "a5", "a6"], liberoId: "a7", secondLiberoId: null });
    apply({ type: "LINEUP_CONFIRMED", team: "B", setNumber: 1, playerIds: ["b1", "b2", "b3", "b4", "b5", "b6"], liberoId: "b7", secondLiberoId: null });
    // Libero in for a6 (back-row, index 5).
    apply({ type: "LIBERO_REPLACEMENT", team: "A", liberoId: "a7", direction: "IN", outPlayerId: "a6" });
    const set0 = s.sets[0];
    expect(set0.libero.liberoOnCourtA).toBe(true);
    expect(set0.courtPositionsA[5]).toBe("a7");

    // Two A side-outs rotate the libero 5 → 4 → 3 (front row).
    apply({ type: "RALLY_WON_B" }); // A serving → side-out to B (A doesn't rotate)
    apply({ type: "RALLY_WON_A" }); // side-out to A (rotate: libero 5 → 4, legal)
    expect(s.sets[0].libero.liberoOnCourtA).toBe(true);
    apply({ type: "RALLY_WON_B" }); // side-out to B
    apply({ type: "RALLY_WON_A" }); // side-out to A (rotate: libero 4 → 3, front row)

    const set = s.sets[0];
    expect(set.libero.liberoOnCourtA).toBe(false);
    expect(set.courtPositionsA.includes("a7")).toBe(false);
    expect(set.courtPositionsA.includes("a6")).toBe(true);
  });
});
