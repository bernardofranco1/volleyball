import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS, resolveConfig } from "@/engine/config";
import {
  appendBeachEvent,
  computeAutoEmits,
  reduce,
  replayEvents,
  setWinner,
} from "@/engine/beach/reducer";
import { validateBeachEvent } from "@/engine/beach/validator";
import {
  type BeachEvent,
  type BeachEventPayload,
  type BeachMatchState,
  type Side,
  type TeamId,
  activeSet,
  initialBeachState,
} from "@/engine/beach/types";

const BEACH = DISCIPLINE_DEFAULTS.BEACH;
const TS = "2026-06-26T10:00:00.000Z";

/**
 * Test harness mirroring the API layer: each dispatched payload is reduced,
 * then the engine's auto-emitted events are appended once (priority order).
 */
class TestMatch {
  events: BeachEvent[] = [];
  state: BeachMatchState;
  private seq = 0;

  constructor(
    matchId = "m1",
    private config = BEACH,
  ) {
    this.state = initialBeachState(matchId);
  }

  apply(payload: BeachEventPayload): BeachEvent {
    const event: BeachEvent = {
      id: `e${++this.seq}`,
      sequence: this.seq,
      timestamp: TS,
      payload,
    };
    this.events.push(event);
    this.state = reduce(this.state, event, this.config);
    return event;
  }

  /** Apply a primary event then append its auto-emitted consequences. */
  dispatch(payload: BeachEventPayload): BeachEventPayload["type"][] {
    this.apply(payload);
    const emits = computeAutoEmits(this.state, this.config);
    for (const e of emits) this.apply(e);
    return emits.map((e) => e.type);
  }

  begin(firstServer: TeamId = "A", side: Side = "LEFT") {
    this.apply({ type: "MATCH_CREATED", matchId: "m1" });
    this.apply({ type: "COIN_TOSS", firstServer, teamAStartSide: side });
    this.apply({ type: "MATCH_START" });
    this.apply({ type: "SET_START", setNumber: 1, firstServer, teamAStartSide: side });
  }

  startSet(setNumber: number, firstServer: TeamId = "A", side: Side = "LEFT") {
    this.apply({ type: "SET_START", setNumber, firstServer, teamAStartSide: side });
  }

  /** Win `n` rallies for a team (collecting any auto-emits each time). */
  score(team: TeamId, n: number) {
    for (let i = 0; i < n; i++) {
      this.dispatch(team === "A" ? { type: "RALLY_WON_A" } : { type: "RALLY_WON_B" });
    }
  }

  get set() {
    return activeSet(this.state)!;
  }
}

describe("beach reducer — scoring", () => {
  it("increments the correct team's score", () => {
    const m = new TestMatch();
    m.begin();
    m.score("A", 3);
    m.score("B", 2);
    expect(m.set.scoreA).toBe(3);
    expect(m.set.scoreB).toBe(2);
  });

  it("set won at 21 with a two-point lead", () => {
    const m = new TestMatch();
    m.begin();
    m.score("A", 19);
    m.score("B", 19); // 19-19
    m.dispatch({ type: "RALLY_WON_A" }); // 20-19
    expect(m.state.setsWonA).toBe(0);
    const types = m.dispatch({ type: "RALLY_WON_A" }); // 21-19 → set won
    expect(types).toContain("SET_END");
    expect(m.state.setsWonA).toBe(1);
  });

  it("set continues at 20-20 until a two-point lead", () => {
    const m = new TestMatch();
    m.begin();
    // bring both to 20
    for (let i = 0; i < 20; i++) {
      m.dispatch({ type: "RALLY_WON_A" });
      m.dispatch({ type: "RALLY_WON_B" });
    }
    expect(m.set.scoreA).toBe(20);
    expect(m.set.scoreB).toBe(20);
    expect(setWinner(m.set, BEACH)).toBeNull();

    m.dispatch({ type: "RALLY_WON_A" }); // 21-20 — not enough
    expect(setWinner({ ...m.set }, BEACH)).toBeNull();

    m.dispatch({ type: "RALLY_WON_A" }); // 22-20 — set won
    expect(m.state.setsWonA).toBe(1);
  });
});

describe("beach reducer — serving", () => {
  it("side-out gives the receiving team its first server (player 1)", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT"); // A serves first with player 1
    expect(m.set.currentServer).toBe("A");
    expect(m.set.serverPlayerA).toBe(1);

    m.score("B", 1); // side-out to B — B's first serve = player 1
    expect(m.set.currentServer).toBe("B");
    expect(m.set.serverPlayerB).toBe(1);
  });

  it("server player alternates across multiple side-outs", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    m.score("B", 1); // side-out → B player 1
    expect([m.set.currentServer, m.set.serverPlayerB]).toEqual(["B", 1]);
    m.score("A", 1); // side-out → A regains, alternates 1→2
    expect([m.set.currentServer, m.set.serverPlayerA]).toEqual(["A", 2]);
    m.score("B", 1); // side-out → B regains, alternates 1→2
    expect([m.set.currentServer, m.set.serverPlayerB]).toEqual(["B", 2]);
    m.score("A", 1); // side-out → A regains, alternates 2→1
    expect([m.set.currentServer, m.set.serverPlayerA]).toEqual(["A", 1]);
  });

  it("keeps the same server while a team holds serve", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    m.score("A", 4); // A serving throughout
    expect(m.set.currentServer).toBe("A");
    expect(m.set.serverPlayerA).toBe(1);
  });
});

describe("beach reducer — side switches", () => {
  it("fires every 7 points in sets 1 & 2", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    for (let i = 0; i < 6; i++) m.dispatch({ type: "RALLY_WON_A" }); // 6-0
    const types = m.dispatch({ type: "RALLY_WON_B" }); // 6-1 → sum 7
    expect(types).toContain("SIDE_SWITCH");
    expect(
      m.events.filter((e) => e.payload.type === "SIDE_SWITCH").length,
    ).toBe(1);
  });

  it("fires every 5 points in the deciding set", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    // win set 1 (A) and set 2 (B) to reach the decider
    m.score("A", 21);
    m.startSet(2, "B", "RIGHT");
    m.score("B", 21);
    expect(m.state.currentSetNumber).toBe(2);
    m.startSet(3, "A", "LEFT");
    expect(m.set.setNumber).toBe(3);
    for (let i = 0; i < 4; i++) m.dispatch({ type: "RALLY_WON_A" }); // 4-0
    const types = m.dispatch({ type: "RALLY_WON_A" }); // 5-0 → sum 5
    expect(types).toContain("SIDE_SWITCH");
  });

  it("does not fire twice for the same point sum", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    for (let i = 0; i < 7; i++) m.dispatch({ type: "RALLY_WON_A" }); // sum 7 at 7-0
    const switches = m.events.filter((e) => e.payload.type === "SIDE_SWITCH");
    expect(switches.length).toBe(1);
  });
});

describe("beach reducer — TTO", () => {
  function bringToSum21(m: TestMatch): BeachEventPayload["type"][] {
    // reach 10-10 (sum 20) then one more → 11-10 (sum 21), set still live
    for (let i = 0; i < 10; i++) {
      m.dispatch({ type: "RALLY_WON_A" });
      m.dispatch({ type: "RALLY_WON_B" });
    }
    return m.dispatch({ type: "RALLY_WON_A" });
  }

  it("TTO fires at sum 21 in set 1", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    const types = bringToSum21(m);
    expect(types).toContain("TTO_START");
    expect(m.set.ttoFired).toBe(true);
  });

  it("TTO does not fire in the deciding set", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    m.score("A", 21); // set 1 to A
    m.startSet(2, "B", "RIGHT");
    m.score("B", 21); // set 2 to B
    m.startSet(3, "A", "LEFT");
    const types = bringToSum21(m); // 11-10 in the decider
    expect(types).not.toContain("TTO_START");
    expect(m.set.ttoFired).toBe(false);
  });

  it("TTO survives UNDO of an unrelated later rally (does not re-fire)", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    bringToSum21(m); // TTO fired at 11-10
    m.apply({ type: "TTO_END" });
    const lastRally = m.dispatch({ type: "RALLY_WON_B" }); // 11-11 (sum 22)
    void lastRally;
    const rallyEvent = m.events.filter(
      (e) => e.payload.type === "RALLY_WON_B",
    ).pop()!;
    // undo that last rally → back to 11-10 (sum 21 again)
    m.apply({ type: "UNDO", targetEventId: rallyEvent.id });
    const state = replayEvents("m1", m.events, BEACH);
    const set = activeSet(state)!;
    expect(set.scoreA + set.scoreB).toBe(21);
    expect(set.ttoFired).toBe(true); // still fired — no second TTO event
    expect(
      m.events.filter((e) => e.payload.type === "TTO_START").length,
    ).toBe(1);
  });
});

describe("beach reducer — match completion", () => {
  it("match won after two sets (best of 3)", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    m.score("A", 21); // set 1
    expect(m.state.setsWonA).toBe(1);
    m.startSet(2, "B", "RIGHT");
    m.score("A", 21); // set 2 → match
    expect(m.state.setsWonA).toBe(2);
    expect(m.state.winner).toBe("A");
    expect(m.state.status).toBe("FINISHED");
  });

  it("auto-emits SET_END then MATCH_END in order on the clinching point", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    m.score("A", 21); // set 1
    m.startSet(2, "B", "RIGHT");
    m.score("A", 20);
    const types = m.dispatch({ type: "RALLY_WON_A" }); // 21st point of set 2
    expect(types).toEqual(["SET_END", "MATCH_END"]);
  });

  it("emits SIDE_SWITCH before TTO_START when both are due at sum 21", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    // 11-10 → sum 21, which is both a side-switch multiple (21%7==0) and the TTO trigger
    for (let i = 0; i < 10; i++) {
      m.dispatch({ type: "RALLY_WON_A" });
      m.dispatch({ type: "RALLY_WON_B" });
    }
    const types = m.dispatch({ type: "RALLY_WON_A" });
    expect(types).toEqual(["SIDE_SWITCH", "TTO_START"]);
  });
});

describe("beach validator", () => {
  it("enforces the timeout limit (1 per set for beach)", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    m.dispatch({ type: "RALLY_WON_A" }); // BETWEEN_RALLIES
    expect(
      validateBeachEvent({ type: "TIMEOUT_REQUEST", team: "A" }, m.state, BEACH).ok,
    ).toBe(true);
    m.apply({ type: "TIMEOUT_REQUEST", team: "A" });
    m.apply({ type: "TIMEOUT_END", team: "A" });
    const second = validateBeachEvent(
      { type: "TIMEOUT_REQUEST", team: "A" },
      m.state,
      BEACH,
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/limit/i);
  });

  it("rejects VCS when disabled and allows it when enabled", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    expect(
      validateBeachEvent({ type: "VCS_CHALLENGE", team: "A" }, m.state, BEACH).ok,
    ).toBe(false);

    const vcsConfig = resolveConfig("BEACH", { vcsEnabled: true });
    const m2 = new TestMatch("m2", vcsConfig);
    m2.begin("A", "LEFT");
    expect(
      validateBeachEvent({ type: "VCS_CHALLENGE", team: "A" }, m2.state, vcsConfig).ok,
    ).toBe(true);
  });
});

describe("beach reducer — VCS challenge accounting", () => {
  it("deducts a challenge on failure and retains it on success", () => {
    const vcsConfig = resolveConfig("BEACH", { vcsEnabled: true });
    const m = new TestMatch("m1", vcsConfig);
    m.begin("A", "LEFT");
    expect(m.set.challengesRemainingA).toBe(2);

    m.apply({ type: "VCS_CHALLENGE", team: "A" });
    m.apply({ type: "VCS_RESULT", upheld: false, team: "A" }); // failed → deduct
    expect(m.set.challengesRemainingA).toBe(1);

    m.apply({ type: "VCS_CHALLENGE", team: "A" });
    m.apply({ type: "VCS_RESULT", upheld: true, team: "A" }); // success → retain
    expect(m.set.challengesRemainingA).toBe(1);
  });
});

describe("beach append orchestrator", () => {
  const opts = (nextSequence: number) => ({
    nextSequence,
    timestamp: TS,
    makeId: (seq: number) => `e${seq}`,
  });

  function liveMatch() {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    return m;
  }

  it("appends a scoring event plus its auto-emitted consequences", () => {
    const m = liveMatch();
    // drive to 10-10 so the next A point makes sum 21 (side switch + TTO)
    for (let i = 0; i < 10; i++) {
      m.dispatch({ type: "RALLY_WON_A" });
      m.dispatch({ type: "RALLY_WON_B" });
    }
    const res = appendBeachEvent(
      m.state,
      { type: "RALLY_WON_A" },
      BEACH,
      opts(m.state.lastSequence + 1),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.newEvents.map((e) => e.payload.type)).toEqual([
      "RALLY_WON_A",
      "SIDE_SWITCH",
      "TTO_START",
    ]);
  });

  it("rejects an invalid event with a reason", () => {
    const m = liveMatch();
    const res = appendBeachEvent(
      m.state,
      { type: "VCS_CHALLENGE", team: "A" }, // VCS disabled for beach defaults
      BEACH,
      opts(m.state.lastSequence + 1),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/disabled/i);
  });

  it("does not re-emit a side switch on a non-scoring event at the same sum", () => {
    const m = liveMatch();
    for (let i = 0; i < 7; i++) m.dispatch({ type: "RALLY_WON_A" }); // 7-0, one side switch
    const res = appendBeachEvent(
      m.state,
      { type: "TIMEOUT_REQUEST", team: "A" },
      BEACH,
      opts(m.state.lastSequence + 1),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.newEvents.map((e) => e.payload.type)).toEqual([
      "TIMEOUT_REQUEST",
    ]);
  });
});

describe("beach reducer — UNDO & replay", () => {
  it("UNDO removes the targeted event and recalculates state", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    m.score("A", 3);
    m.score("B", 2); // 3-2
    const lastB = m.events.filter((e) => e.payload.type === "RALLY_WON_B").pop()!;
    m.apply({ type: "UNDO", targetEventId: lastB.id });
    const state = replayEvents("m1", m.events, BEACH);
    const set = activeSet(state)!;
    expect(set.scoreA).toBe(3);
    expect(set.scoreB).toBe(1);
  });

  it("replayEvents reproduces the incrementally reduced state", () => {
    const m = new TestMatch();
    m.begin("A", "LEFT");
    m.score("A", 5);
    m.score("B", 7);
    m.score("A", 2);
    const replayed = replayEvents("m1", m.events, BEACH);
    expect(replayed).toEqual(m.state);
  });
});
