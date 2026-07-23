import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS } from "@/engine/config";
import {
  appendBeachEvent,
  replayEvents as beachReplay,
} from "@/engine/beach/reducer";
import {
  type BeachEvent,
  type BeachEventPayload,
  type BeachMatchState,
  initialBeachState,
} from "@/engine/beach/types";
import { appendIndoorEvent } from "@/engine/indoor/reducer";
import {
  type IndoorEventPayload,
  type IndoorMatchState,
  initialIndoorState,
} from "@/engine/indoor/types";
import { validateBeachEvent } from "@/engine/beach/validator";
import { selectUndoTargets } from "@/lib/match-engine";
import type { EngineEvent } from "@/engine/registry";

const BEACH = DISCIPLINE_DEFAULTS.BEACH;
const INDOOR = DISCIPLINE_DEFAULTS.INDOOR;
const TS = "2026-07-01T10:00:00.000Z";

// FORFEIT {team, reason}: `team` forfeits/retires, the opponent wins (FIVB
// 6.4). Points and sets already scored are kept; the open set closes with the
// opponent raised to what they needed to win it; the winner's sets tally jumps
// to the match-winning count. Scorer-submitted, undoable like any action.

function beachHarness() {
  let seq = 0;
  let state: BeachMatchState = initialBeachState("m1");
  const log: BeachEvent[] = [];
  const send = (payload: BeachEventPayload) => {
    const r = appendBeachEvent(state, payload, BEACH, {
      nextSequence: seq + 1,
      timestamp: TS,
      makeId: (s) => `e${s}`,
    });
    if (!r.ok) throw new Error(`rejected ${payload.type}: ${r.reason}`);
    log.push(...r.newEvents);
    seq = r.newEvents[r.newEvents.length - 1].sequence;
    state = r.state;
  };
  return { send, getState: () => state, log, seq: () => seq };
}

/** Score a rally, ending the auto-fired TTO when the points sum triggers it. */
function rally(h: ReturnType<typeof beachHarness>, type: "RALLY_WON_A" | "RALLY_WON_B") {
  h.send({ type });
  if (h.getState().rallyPhase === "TTO_ACTIVE") h.send({ type: "TTO_END" });
}

function playBeachSet1(h: ReturnType<typeof beachHarness>) {
  h.send({ type: "MATCH_CREATED", matchId: "m1" });
  h.send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
  h.send({ type: "MATCH_START" });
  h.send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
  for (let i = 0; i < 19; i++) {
    rally(h, "RALLY_WON_A");
    rally(h, "RALLY_WON_B");
  }
  rally(h, "RALLY_WON_A"); // 20-19
  rally(h, "RALLY_WON_A"); // 21-19 → SET_END, set break
}

describe("FORFEIT — beach", () => {
  it("retirement mid-set: opponent gets the open set (points kept) and the match", () => {
    const h = beachHarness();
    playBeachSet1(h); // A leads 1-0
    h.send({ type: "SET_START", setNumber: 2, firstServer: "B", teamAStartSide: "RIGHT" });
    for (let i = 0; i < 12; i++) h.send({ type: "RALLY_WON_A" });
    for (let i = 0; i < 8; i++) h.send({ type: "RALLY_WON_B" }); // set 2: 12-8

    h.send({ type: "FORFEIT", team: "B", reason: "RETIREMENT" });
    const s = h.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.rallyPhase).toBe("MATCH_OVER");
    expect(s.winner).toBe("A");
    expect(s.setsWonA).toBe(2);
    expect(s.setsWonB).toBe(0);
    // Set 2 closed for A at the win target; B's points kept.
    expect(s.sets[1].winner).toBe("A");
    expect(s.sets[1].scoreA).toBe(21);
    expect(s.sets[1].scoreB).toBe(8);
    expect(s.sets[1].endedAt).toBe(TS);
  });

  it("two-point lead: at 20-20 the winner's score closes at 22", () => {
    const h = beachHarness();
    h.send({ type: "MATCH_CREATED", matchId: "m1" });
    h.send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    h.send({ type: "MATCH_START" });
    h.send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    for (let i = 0; i < 20; i++) {
      rally(h, "RALLY_WON_A");
      rally(h, "RALLY_WON_B");
    } // 20-20
    h.send({ type: "FORFEIT", team: "B", reason: "RETIREMENT" });
    const s = h.getState();
    expect(s.sets[0].scoreA).toBe(22);
    expect(s.sets[0].scoreB).toBe(20);
    expect(s.winner).toBe("A");
  });

  it("no-show default before the coin toss: opponent wins with no sets played", () => {
    const h = beachHarness();
    h.send({ type: "MATCH_CREATED", matchId: "m1" }); // status COIN_TOSS
    h.send({ type: "FORFEIT", team: "A", reason: "FORFEIT" });
    const s = h.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.winner).toBe("B");
    expect(s.setsWonB).toBe(2); // best-of-3 winning count
    expect(s.setsWonA).toBe(0);
    expect(s.sets).toHaveLength(0);
  });

  it("sets already won by the retiring team are kept (2-1 result)", () => {
    const h = beachHarness();
    h.send({ type: "MATCH_CREATED", matchId: "m1" });
    h.send({ type: "COIN_TOSS", firstServer: "B", teamAStartSide: "LEFT" });
    h.send({ type: "MATCH_START" });
    h.send({ type: "SET_START", setNumber: 1, firstServer: "B", teamAStartSide: "LEFT" });
    for (let i = 0; i < 21; i++) rally(h, "RALLY_WON_B"); // B wins set 1 21-0
    h.send({ type: "SET_START", setNumber: 2, firstServer: "A", teamAStartSide: "RIGHT" });
    h.send({ type: "RALLY_WON_A" });
    h.send({ type: "FORFEIT", team: "B", reason: "RETIREMENT" });
    const s = h.getState();
    expect(s.winner).toBe("A");
    expect(s.setsWonA).toBe(2);
    expect(s.setsWonB).toBe(1);
  });

  it("forfeit during a time-out clears the interruption", () => {
    const h = beachHarness();
    playBeachSet1(h);
    h.send({ type: "SET_START", setNumber: 2, firstServer: "B", teamAStartSide: "RIGHT" });
    h.send({ type: "RALLY_WON_A" });
    h.send({ type: "TIMEOUT_REQUEST", team: "B" });
    h.send({ type: "FORFEIT", team: "B", reason: "RETIREMENT" });
    const s = h.getState();
    expect(s.status).toBe("FINISHED");
    expect(s.activeTimeoutTeam).toBeNull();
  });

  it("is undoable: one undo restores the pre-forfeit state", () => {
    const h = beachHarness();
    playBeachSet1(h);
    h.send({ type: "SET_START", setNumber: 2, firstServer: "B", teamAStartSide: "RIGHT" });
    h.send({ type: "RALLY_WON_A" });
    h.send({ type: "FORFEIT", team: "B", reason: "RETIREMENT" });

    const targets = selectUndoTargets(h.log as unknown as EngineEvent[], "point");
    expect(targets.map((t) => t.payload.type)).toEqual(["FORFEIT"]);
    let seq = h.seq();
    const undos = targets.map((t) => ({
      id: `u${++seq}`,
      sequence: seq,
      timestamp: TS,
      payload: { type: "UNDO", targetEventId: t.id },
    })) as unknown as BeachEvent[];
    const s = beachReplay("m1", [...h.log, ...undos], BEACH);
    expect(s.status).toBe("LIVE");
    expect(s.winner).toBeNull();
    expect(s.setsWonA).toBe(1);
    expect(s.sets[1].winner).toBeNull();
    expect(s.sets[1].scoreA).toBe(1);
  });

  it("validator: rejects at SETUP and FINISHED, allows COIN_TOSS/LIVE", () => {
    const setup = initialBeachState("m1");
    expect(validateBeachEvent({ type: "FORFEIT", team: "A", reason: "FORFEIT" }, setup, BEACH).ok).toBe(false);

    const h = beachHarness();
    h.send({ type: "MATCH_CREATED", matchId: "m1" });
    expect(validateBeachEvent({ type: "FORFEIT", team: "A", reason: "FORFEIT" }, h.getState(), BEACH).ok).toBe(true);
    h.send({ type: "FORFEIT", team: "A", reason: "FORFEIT" });
    expect(validateBeachEvent({ type: "FORFEIT", team: "B", reason: "FORFEIT" }, h.getState(), BEACH).ok).toBe(false);
  });
});

describe("FORFEIT — indoor (best of 5)", () => {
  it("retirement at 1-1 in sets closes the open set and jumps the winner to 3", () => {
    let state: IndoorMatchState = initialIndoorState("i1");
    let seq = 0;
    const send = (payload: IndoorEventPayload) => {
      const r = appendIndoorEvent(state, payload, INDOOR, {
        nextSequence: seq + 1,
        timestamp: TS,
        makeId: (s) => `i${s}`,
      });
      if (!r.ok) throw new Error(`rejected ${payload.type}: ${r.reason}`);
      seq = r.newEvents[r.newEvents.length - 1].sequence;
      state = r.state;
    };
    const sixA = ["a1", "a2", "a3", "a4", "a5", "a6"];
    const sixB = ["b1", "b2", "b3", "b4", "b5", "b6"];
    const lineups = (setNumber: 1 | 2 | 3) => {
      send({ type: "LINEUP_CONFIRMED", team: "A", setNumber, playerIds: sixA, liberoId: null, secondLiberoId: null });
      send({ type: "LINEUP_CONFIRMED", team: "B", setNumber, playerIds: sixB, liberoId: null, secondLiberoId: null });
    };
    send({ type: "MATCH_CREATED", matchId: "i1" });
    send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "MATCH_START" });
    send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    lineups(1);
    for (let i = 0; i < 25; i++) send({ type: "RALLY_WON_A" }); // set 1: 25-0 A
    send({ type: "SET_START", setNumber: 2, firstServer: "B", teamAStartSide: "RIGHT" });
    lineups(2);
    for (let i = 0; i < 25; i++) send({ type: "RALLY_WON_B" }); // set 2: 0-25 B
    send({ type: "SET_START", setNumber: 3, firstServer: "A", teamAStartSide: "LEFT" });
    lineups(3);
    for (let i = 0; i < 10; i++) send({ type: "RALLY_WON_A" });
    for (let i = 0; i < 8; i++) send({ type: "RALLY_WON_B" }); // set 3: 10-8

    send({ type: "FORFEIT", team: "B", reason: "RETIREMENT" });
    expect(state.status).toBe("FINISHED");
    expect(state.winner).toBe("A");
    expect(state.setsWonA).toBe(3);
    expect(state.setsWonB).toBe(1);
    expect(state.sets[2].winner).toBe("A");
    expect(state.sets[2].scoreA).toBe(25);
    expect(state.sets[2].scoreB).toBe(8);
  });
});
