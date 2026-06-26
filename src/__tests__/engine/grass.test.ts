import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS, resolveConfig } from "@/engine/config";
import {
  appendGrassEvent,
  computeAutoEmits,
  reduce,
  replayEvents,
  setWinner,
} from "@/engine/grass/reducer";
import { validateGrassEvent } from "@/engine/grass/validator";
import {
  type GrassEvent,
  type GrassEventPayload,
  type GrassMatchState,
  type Side,
  type TeamId,
  activeSet,
  initialGrassState,
} from "@/engine/grass/types";

const GRASS = DISCIPLINE_DEFAULTS.GRASS; // 3-player
const GRASS4 = resolveConfig("GRASS", { playersPerSide: 4 });
const TS = "2026-06-26T10:00:00.000Z";

const A3 = ["a1", "a2", "a3"];
const B3 = ["b1", "b2", "b3"];
const A4 = ["a1", "a2", "a3", "a4"];
const B4 = ["b1", "b2", "b3", "b4"];

class TestMatch {
  events: GrassEvent[] = [];
  state: GrassMatchState;
  private seq = 0;

  constructor(
    matchId = "m1",
    private config = GRASS,
  ) {
    this.state = initialGrassState(matchId);
  }

  apply(payload: GrassEventPayload): GrassEvent {
    const event: GrassEvent = {
      id: `e${++this.seq}`,
      sequence: this.seq,
      timestamp: TS,
      payload,
    };
    this.events.push(event);
    this.state = reduce(this.state, event, this.config);
    return event;
  }

  dispatch(payload: GrassEventPayload): GrassEventPayload["type"][] {
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

  confirm(setNumber = this.state.currentSetNumber) {
    const four = this.config.playersPerSide === 4;
    this.apply({
      type: "LINEUP_CONFIRMED",
      setNumber,
      teamAPlayerIds: four ? A4 : A3,
      teamBPlayerIds: four ? B4 : B3,
    });
  }

  ready(firstServer: TeamId = "A", side: Side = "LEFT") {
    this.begin(firstServer, side);
    this.confirm(1);
  }

  startSet(setNumber: number, firstServer: TeamId = "A", side: Side = "LEFT") {
    this.apply({ type: "SET_START", setNumber, firstServer, teamAStartSide: side });
    this.confirm(setNumber);
  }

  score(team: TeamId, n: number) {
    for (let i = 0; i < n; i++) {
      this.dispatch(team === "A" ? { type: "RALLY_WON_A" } : { type: "RALLY_WON_B" });
    }
  }

  get set() {
    return activeSet(this.state)!;
  }
}

describe("grass reducer — scoring & sets", () => {
  it("increments the correct team's score", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 4);
    m.score("B", 2);
    expect(m.set.scoreA).toBe(4);
    expect(m.set.scoreB).toBe(2);
  });

  it("set won at 21 with a two-point lead; decider target 15", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 20);
    m.score("B", 20); // 20-20
    m.dispatch({ type: "RALLY_WON_A" }); // 21-20 — not enough
    expect(m.state.setsWonA).toBe(0);
    m.dispatch({ type: "RALLY_WON_A" }); // 22-20 → set
    expect(m.state.setsWonA).toBe(1);

    m.startSet(2, "B");
    m.score("B", 21); // 1-1 sets
    m.startSet(3, "A");
    m.score("A", 14);
    expect(setWinner(m.set, GRASS)).toBeNull();
    const types = m.dispatch({ type: "RALLY_WON_A" }); // 15-0 → decider won
    expect(types).toContain("SET_END");
    expect(types).toContain("MATCH_END");
  });
});

describe("grass reducer — rotation", () => {
  it("3-player: side-out gains serve at rotation 0, then advances", () => {
    const m = new TestMatch();
    m.ready("A", "LEFT");
    expect(m.set.lastRotA).toBe(0);
    expect(m.set.courtPositionsA[m.set.lastRotA!]).toBe("a1");

    m.score("B", 1); // side-out B (first serve → rotation 0)
    expect(m.set.currentServer).toBe("B");
    expect(m.set.lastRotB).toBe(0);
    expect(m.set.courtPositionsB[0]).toBe("b1");

    m.score("A", 1); // side-out A → A advances 0→1
    expect(m.set.lastRotA).toBe(1);
    expect(m.set.courtPositionsA[1]).toBe("a2");
  });

  it("3-player: rotation wraps 2 → 0", () => {
    const m = new TestMatch();
    m.ready("A", "LEFT"); // lastRotA 0
    for (const r of [1, 2, 0]) {
      m.score("B", 1); // give serve away
      m.score("A", 1); // regain → advance
      expect(m.set.lastRotA).toBe(r);
    }
  });

  it("4-player: rotation advances mod 4", () => {
    const m = new TestMatch("m1", GRASS4);
    m.ready("A", "LEFT");
    m.score("B", 1);
    m.score("A", 1); // lastRotA 1
    expect(m.set.lastRotA).toBe(1);
    expect(m.set.courtPositionsA[1]).toBe("a2");
    expect(m.set.courtPositionsA.length).toBe(4);
  });
});

describe("grass reducer — side switches (beach thresholds)", () => {
  it("fires at sum 7 and 14 in sets 1 & 2", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 7); // 7-0 sum 7
    m.score("B", 7); // 7-7 sum 14
    expect(
      m.events.filter((e) => e.payload.type === "SIDE_SWITCH").length,
    ).toBe(2);
  });

  it("fires at sum 5 and 10 in the deciding set", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 21);
    m.startSet(2, "B");
    m.score("B", 21);
    m.startSet(3, "A");
    const before = m.events.filter((e) => e.payload.type === "SIDE_SWITCH").length;
    m.score("A", 5); // sum 5
    m.score("B", 5); // sum 10
    const after = m.events.filter((e) => e.payload.type === "SIDE_SWITCH").length;
    expect(after - before).toBe(2); // two switches within the decider
  });
});

describe("grass lineup & substitutions", () => {
  it("requires lineup confirmation before the first rally", () => {
    const m = new TestMatch();
    m.begin();
    expect(m.state.rallyPhase).toBe("LINEUP_PENDING");
    expect(validateGrassEvent({ type: "RALLY_WON_A" }, m.state, GRASS).ok).toBe(false);
    m.confirm(1);
    expect(m.state.rallyPhase).toBe("BETWEEN_RALLIES");
    expect(validateGrassEvent({ type: "RALLY_WON_A" }, m.state, GRASS).ok).toBe(true);
  });

  it("enforces the substitution limit (4 per set)", () => {
    const m = new TestMatch();
    m.ready();
    // Four valid subs: open all three starter slots, then return a1.
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "as1" });
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a2", inPlayerId: "as2" });
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a3", inPlayerId: "as3" });
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "as1", inPlayerId: "a1" });
    expect(m.set.subsUsedA).toBe(4);
    // A fifth sub is slot-legal (return a2) but blocked by the per-set limit.
    const fifth = validateGrassEvent(
      { type: "SUBSTITUTION", team: "A", outPlayerId: "as2", inPlayerId: "a2" },
      m.state,
      GRASS,
    );
    expect(fifth.ok).toBe(false);
    expect(fifth.reason).toMatch(/limit/i);
  });

  it("emergency substitution is not counted toward the limit", () => {
    const m = new TestMatch();
    m.ready();
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "as1", isEmergency: true });
    expect(m.set.subsUsedA).toBe(0);
    expect(m.set.courtPositionsA.includes("as1")).toBe(true);
  });
});

describe("grass — UNDO & replay", () => {
  it("UNDO removes the targeted event and recomputes", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 3);
    m.score("B", 2);
    const lastB = m.events.filter((e) => e.payload.type === "RALLY_WON_B").pop()!;
    m.apply({ type: "UNDO", targetEventId: lastB.id });
    const state = replayEvents("m1", m.events, GRASS);
    const set = activeSet(state)!;
    expect(set.scoreA).toBe(3);
    expect(set.scoreB).toBe(1);
  });

  it("replayEvents reproduces the incrementally reduced state", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 5);
    m.score("B", 7);
    m.score("A", 2);
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "as1" });
    const replayed = replayEvents("m1", m.events, GRASS);
    expect(replayed).toEqual(m.state);
  });
});

describe("grass append orchestrator", () => {
  const opts = (nextSequence: number) => ({
    nextSequence,
    timestamp: TS,
    makeId: (seq: number) => `e${seq}`,
  });

  it("appends a scoring event plus a side switch at sum 7", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 6); // 6-0
    const res = appendGrassEvent(m.state, { type: "RALLY_WON_A" }, GRASS, opts(m.state.lastSequence + 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.newEvents.map((e) => e.payload.type)).toEqual(["RALLY_WON_A", "SIDE_SWITCH"]);
  });
});
