import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS, resolveConfig } from "@/engine/config";
import {
  appendLightEvent,
  computeAutoEmits,
  reduce,
  replayEvents,
  setWinner,
} from "@/engine/light/reducer";
import { validateLightEvent } from "@/engine/light/validator";
import {
  type LightEvent,
  type LightEventPayload,
  type LightMatchState,
  type Side,
  type TeamId,
  activeSet,
  initialLightState,
} from "@/engine/light/types";

const LIGHT = DISCIPLINE_DEFAULTS.LIGHT; // 4-player
const LIGHT5 = resolveConfig("LIGHT", { playersPerSide: 5, maxSubsPerSet: 5 });
const TS = "2026-06-26T10:00:00.000Z";

const A4 = ["a1", "a2", "a3", "a4"];
const B4 = ["b1", "b2", "b3", "b4"];
const A5 = ["a1", "a2", "a3", "a4", "a5"];
const B5 = ["b1", "b2", "b3", "b4", "b5"];

class TestMatch {
  events: LightEvent[] = [];
  state: LightMatchState;
  private seq = 0;

  constructor(
    matchId = "m1",
    private config = LIGHT,
  ) {
    this.state = initialLightState(matchId);
  }

  apply(payload: LightEventPayload): LightEvent {
    const event: LightEvent = {
      id: `e${++this.seq}`,
      sequence: this.seq,
      timestamp: TS,
      payload,
    };
    this.events.push(event);
    this.state = reduce(this.state, event, this.config);
    return event;
  }

  dispatch(payload: LightEventPayload): LightEventPayload["type"][] {
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
    const five = this.config.playersPerSide === 5;
    this.apply({
      type: "LINEUP_CONFIRMED",
      setNumber,
      teamAPlayerIds: five ? A5 : A4,
      teamBPlayerIds: five ? B5 : B4,
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

describe("light reducer — scoring & sets", () => {
  it("set won at 21 with two-point lead; decider at 15", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 20);
    m.score("B", 20);
    m.dispatch({ type: "RALLY_WON_A" }); // 21-20
    expect(m.state.setsWonA).toBe(0);
    m.dispatch({ type: "RALLY_WON_A" }); // 22-20 → set
    expect(m.state.setsWonA).toBe(1);

    m.startSet(2, "B");
    m.score("B", 21);
    m.startSet(3, "A");
    m.score("A", 14);
    expect(setWinner(m.set, LIGHT)).toBeNull();
    const types = m.dispatch({ type: "RALLY_WON_A" }); // 15-0
    expect(types).toContain("SET_END");
    expect(types).toContain("MATCH_END");
  });
});

describe("light reducer — rotation", () => {
  it("4-player: rotation index advances 0→1→2→3→0", () => {
    const m = new TestMatch();
    m.ready("A", "LEFT");
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      m.score("B", 1); // give serve
      m.score("A", 1); // regain → advance
      seen.push(m.set.lastRotA!);
    }
    expect(seen).toEqual([1, 2, 3, 0]);
  });

  it("5-player: rotation index advances 0→1→2→3→4→0", () => {
    const m = new TestMatch("m1", LIGHT5);
    m.ready("A", "LEFT");
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      m.score("B", 1);
      m.score("A", 1);
      seen.push(m.set.lastRotA!);
    }
    expect(seen).toEqual([1, 2, 3, 4, 0]);
    expect(m.set.courtPositionsA.length).toBe(5);
  });
});

describe("light reducer — side switches", () => {
  it("no mid-set switch in non-deciding sets", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 8);
    expect(m.events.filter((e) => e.payload.type === "SIDE_SWITCH").length).toBe(0);
  });

  it("deciding set: SIDE_SWITCH auto-emitted at 8, only once", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 21);
    m.startSet(2, "B");
    m.score("B", 21);
    m.startSet(3, "A");
    m.score("A", 7); // 7-0
    expect(m.events.filter((e) => e.payload.type === "SIDE_SWITCH").length).toBe(0);
    const types = m.dispatch({ type: "RALLY_WON_A" }); // 8-0
    expect(types).toContain("SIDE_SWITCH");
    expect(m.set.decidingSwitchDone).toBe(true);
    const more = m.dispatch({ type: "RALLY_WON_A" }); // 9-0
    expect(more).not.toContain("SIDE_SWITCH");
  });
});

describe("light reducer — faults", () => {
  it("JUMP_SERVE_FOOT_FAULT scores for the opponent and gives them serve", () => {
    const m = new TestMatch();
    m.ready("A", "LEFT"); // A serving
    m.dispatch({ type: "JUMP_SERVE_FOOT_FAULT", team: "A" });
    expect(m.set.scoreB).toBe(1);
    expect(m.set.scoreA).toBe(0);
    expect(m.set.currentServer).toBe("B");
  });

  it("ATTACK_ARC_FAULT scores for the opponent", () => {
    const m = new TestMatch();
    m.ready("A", "LEFT");
    m.dispatch({ type: "ATTACK_ARC_FAULT", team: "B" });
    expect(m.set.scoreA).toBe(1);
    expect(m.set.currentServer).toBe("A");
  });
});

describe("light validator — limits & lineup", () => {
  it("requires lineup confirmation before the first rally", () => {
    const m = new TestMatch();
    m.begin();
    expect(m.state.rallyPhase).toBe("LINEUP_PENDING");
    expect(validateLightEvent({ type: "RALLY_WON_A" }, m.state, LIGHT).ok).toBe(false);
    m.confirm(1);
    expect(validateLightEvent({ type: "RALLY_WON_A" }, m.state, LIGHT).ok).toBe(true);
  });

  it("substitution limit: 4 for 4-player, 5 for 5-player", () => {
    const m4 = new TestMatch();
    m4.ready();
    m4.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "x1" });
    m4.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a2", inPlayerId: "x2" });
    m4.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a3", inPlayerId: "x3" });
    m4.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a4", inPlayerId: "x4" });
    expect(m4.set.subsUsedA).toBe(4);
    expect(
      validateLightEvent({ type: "SUBSTITUTION", team: "A", outPlayerId: "x1", inPlayerId: "a1" }, m4.state, LIGHT).ok,
    ).toBe(false);

    const m5 = new TestMatch("m1", LIGHT5);
    m5.ready();
    for (let i = 0; i < 5; i++)
      m5.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: A5[i], inPlayerId: `x${i}` });
    expect(m5.set.subsUsedA).toBe(5);
    expect(
      validateLightEvent({ type: "SUBSTITUTION", team: "A", outPlayerId: "x0", inPlayerId: "a1" }, m5.state, LIGHT5).ok,
    ).toBe(false);
  });

  it("emergency sub is not counted; timeout limit is 2", () => {
    const m = new TestMatch();
    m.ready();
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "x1", isEmergency: true });
    expect(m.set.subsUsedA).toBe(0);
    m.apply({ type: "TIMEOUT_REQUEST", team: "B" });
    m.apply({ type: "TIMEOUT_END", team: "B" });
    m.apply({ type: "TIMEOUT_REQUEST", team: "B" });
    m.apply({ type: "TIMEOUT_END", team: "B" });
    expect(
      validateLightEvent({ type: "TIMEOUT_REQUEST", team: "B" }, m.state, LIGHT).ok,
    ).toBe(false);
  });
});

describe("light — UNDO & replay", () => {
  it("UNDO removes the targeted event and recomputes", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 3);
    m.score("B", 2);
    const lastB = m.events.filter((e) => e.payload.type === "RALLY_WON_B").pop()!;
    m.apply({ type: "UNDO", targetEventId: lastB.id });
    const state = replayEvents("m1", m.events, LIGHT);
    expect(activeSet(state)!.scoreB).toBe(1);
  });

  it("replayEvents reproduces the incrementally reduced state", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 5);
    m.dispatch({ type: "ATTACK_ARC_FAULT", team: "B" });
    m.score("B", 7);
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "x1" });
    const replayed = replayEvents("m1", m.events, LIGHT);
    expect(replayed).toEqual(m.state);
  });
});

describe("light append orchestrator", () => {
  const opts = (nextSequence: number) => ({
    nextSequence,
    timestamp: TS,
    makeId: (seq: number) => `e${seq}`,
  });

  it("a fault appends as a scoring event (can trigger SET_END)", () => {
    const m = new TestMatch();
    m.ready();
    m.score("B", 20);
    m.score("A", 20); // 20-20, B serving last? ensure A can win via fault by B
    const res = appendLightEvent(m.state, { type: "ATTACK_ARC_FAULT", team: "B" }, LIGHT, opts(m.state.lastSequence + 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 21-20 — not yet a set (needs 2-point lead), so just the fault event.
    expect(res.newEvents.map((e) => e.payload.type)).toEqual(["ATTACK_ARC_FAULT"]);
  });
});
