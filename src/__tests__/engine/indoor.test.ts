import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS, resolveConfig } from "@/engine/config";
import {
  appendIndoorEvent,
  computeAutoEmits,
  reduce,
  replayEvents,
  setWinner,
} from "@/engine/indoor/reducer";
import { validateIndoorEvent } from "@/engine/indoor/validator";
import {
  type IndoorEvent,
  type IndoorEventPayload,
  type IndoorMatchState,
  type Side,
  type TeamId,
  activeSet,
  initialIndoorState,
} from "@/engine/indoor/types";

const INDOOR = DISCIPLINE_DEFAULTS.INDOOR;
const TS = "2026-06-26T10:00:00.000Z";

const A6 = ["a1", "a2", "a3", "a4", "a5", "a6"];
const B6 = ["b1", "b2", "b3", "b4", "b5", "b6"];

class TestMatch {
  events: IndoorEvent[] = [];
  state: IndoorMatchState;
  private seq = 0;

  constructor(
    matchId = "m1",
    private config = INDOOR,
  ) {
    this.state = initialIndoorState(matchId);
  }

  apply(payload: IndoorEventPayload): IndoorEvent {
    const event: IndoorEvent = {
      id: `e${++this.seq}`,
      sequence: this.seq,
      timestamp: TS,
      payload,
    };
    this.events.push(event);
    this.state = reduce(this.state, event, this.config);
    return event;
  }

  dispatch(payload: IndoorEventPayload): IndoorEventPayload["type"][] {
    this.apply(payload);
    const emits = computeAutoEmits(this.state, this.config);
    for (const e of emits) this.apply(e);
    return emits.map((e) => e.type);
  }

  /** Coin toss → match start → set 1 start (leaves phase = LINEUP_PENDING). */
  begin(firstServer: TeamId = "A", side: Side = "LEFT") {
    this.apply({ type: "MATCH_CREATED", matchId: "m1" });
    this.apply({ type: "COIN_TOSS", firstServer, teamAStartSide: side });
    this.apply({ type: "MATCH_START" });
    this.apply({ type: "SET_START", setNumber: 1, firstServer, teamAStartSide: side });
  }

  confirmLineups(
    setNumber = this.state.currentSetNumber,
    liberoA: string | null = "a7",
    liberoB: string | null = "b7",
  ) {
    this.apply({
      type: "LINEUP_CONFIRMED",
      team: "A",
      setNumber,
      playerIds: A6,
      liberoId: liberoA,
      secondLiberoId: null,
    });
    this.apply({
      type: "LINEUP_CONFIRMED",
      team: "B",
      setNumber,
      playerIds: B6,
      liberoId: liberoB,
      secondLiberoId: null,
    });
  }

  /** begin + confirm lineups → ready to score. */
  ready(firstServer: TeamId = "A", side: Side = "LEFT") {
    this.begin(firstServer, side);
    this.confirmLineups(1);
  }

  startSet(setNumber: number, firstServer: TeamId = "A", side: Side = "LEFT") {
    this.apply({ type: "SET_START", setNumber, firstServer, teamAStartSide: side });
    this.confirmLineups(setNumber);
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

describe("indoor reducer — scoring & sets", () => {
  it("increments the correct team's score", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 4);
    m.score("B", 2);
    expect(m.set.scoreA).toBe(4);
    expect(m.set.scoreB).toBe(2);
  });

  it("set won at 25 with a two-point lead", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 24);
    m.score("B", 24); // 24-24
    m.dispatch({ type: "RALLY_WON_A" }); // 25-24 — not enough
    expect(m.state.setsWonA).toBe(0);
    const types = m.dispatch({ type: "RALLY_WON_A" }); // 26-24 → set won
    expect(types).toContain("SET_END");
    expect(m.state.setsWonA).toBe(1);
  });

  it("deciding set target is 15", () => {
    const m = new TestMatch();
    m.begin();
    m.confirmLineups(1);
    m.startSet(5, "A", "LEFT");
    m.score("A", 14);
    expect(setWinner(m.set, INDOOR)).toBeNull();
    const types = m.dispatch({ type: "RALLY_WON_A" }); // 15-0
    expect(types).toContain("SET_END");
  });

  it("match won after 3 sets (best of 5)", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 25); // set 1
    m.startSet(2, "B");
    m.score("A", 25); // set 2
    m.startSet(3, "A");
    m.score("A", 25); // set 3 → match
    expect(m.state.setsWonA).toBe(3);
    expect(m.state.winner).toBe("A");
    expect(m.state.status).toBe("FINISHED");
  });

  it("best-of-3 config wins after 2 sets", () => {
    const cfg = resolveConfig("INDOOR", { bestOf: 3 });
    const m = new TestMatch("m1", cfg);
    m.ready();
    m.score("A", 25);
    m.startSet(2, "B");
    m.score("A", 25);
    expect(m.state.winner).toBe("A");
  });

  it("auto-emits SET_END then MATCH_END in order on the clinching point", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 25);
    m.startSet(2, "B");
    m.score("A", 25);
    m.startSet(3, "A");
    m.score("A", 24);
    const types = m.dispatch({ type: "RALLY_WON_A" });
    expect(types).toEqual(["SET_END", "MATCH_END"]);
  });
});

describe("indoor reducer — rotation & serving", () => {
  it("side-out triggers rotation and the right player serves", () => {
    const m = new TestMatch();
    m.ready("A", "LEFT");
    expect(m.set.currentServer).toBe("A");
    expect(m.set.courtPositionsA[0]).toBe("a1"); // pos 1 serves

    m.score("B", 1); // side-out to B → B rotates once
    expect(m.set.currentServer).toBe("B");
    expect(m.set.rotationIndexB).toBe(1);
    expect(m.set.courtPositionsB[0]).toBe("b2"); // old pos2 now serves

    m.score("A", 1); // side-out back to A → A rotates once
    expect(m.set.currentServer).toBe("A");
    expect(m.set.rotationIndexA).toBe(1);
    expect(m.set.courtPositionsA[0]).toBe("a2");
  });

  it("server keeps serving (no rotation) while holding serve", () => {
    const m = new TestMatch();
    m.ready("A", "LEFT");
    m.score("A", 5);
    expect(m.set.rotationIndexA).toBe(0);
    expect(m.set.courtPositionsA[0]).toBe("a1");
  });
});

describe("indoor reducer — deciding-set court change", () => {
  it("auto-emits SIDE_SWITCH when the leading team reaches 8 in set 5", () => {
    const m = new TestMatch();
    m.begin();
    m.confirmLineups(1);
    m.startSet(5, "A", "LEFT");
    m.score("A", 7); // 7-0, no switch yet
    expect(
      m.events.filter((e) => e.payload.type === "SIDE_SWITCH").length,
    ).toBe(0);
    const types = m.dispatch({ type: "RALLY_WON_A" }); // 8-0
    expect(types).toContain("SIDE_SWITCH");
    expect(m.set.decidingSwitchDone).toBe(true);
    // does not fire again
    const more = m.dispatch({ type: "RALLY_WON_A" }); // 9-0
    expect(more).not.toContain("SIDE_SWITCH");
  });

  it("does not switch mid-set in non-deciding sets", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 8);
    expect(
      m.events.filter((e) => e.payload.type === "SIDE_SWITCH").length,
    ).toBe(0);
  });
});

describe("indoor lineup-pending flow", () => {
  it("blocks rallies until both teams confirm their lineup", () => {
    const m = new TestMatch();
    m.begin();
    expect(m.state.rallyPhase).toBe("LINEUP_PENDING");
    expect(
      validateIndoorEvent({ type: "RALLY_WON_A" }, m.state, INDOOR).ok,
    ).toBe(false);

    m.apply({
      type: "LINEUP_CONFIRMED",
      team: "A",
      setNumber: 1,
      playerIds: A6,
      liberoId: "a7",
      secondLiberoId: null,
    });
    expect(m.state.rallyPhase).toBe("LINEUP_PENDING"); // B not yet
    m.apply({
      type: "LINEUP_CONFIRMED",
      team: "B",
      setNumber: 1,
      playerIds: B6,
      liberoId: "b7",
      secondLiberoId: null,
    });
    expect(m.state.rallyPhase).toBe("BETWEEN_RALLIES");
    expect(
      validateIndoorEvent({ type: "RALLY_WON_A" }, m.state, INDOOR).ok,
    ).toBe(true);
  });

  it("rejects a lineup that is the wrong size or includes the libero", () => {
    const m = new TestMatch();
    m.begin();
    expect(
      validateIndoorEvent(
        { type: "LINEUP_CONFIRMED", team: "A", setNumber: 1, playerIds: ["a1", "a2"], liberoId: null, secondLiberoId: null },
        m.state,
        INDOOR,
      ).ok,
    ).toBe(false);
    expect(
      validateIndoorEvent(
        { type: "LINEUP_CONFIRMED", team: "A", setNumber: 1, playerIds: A6, liberoId: "a1", secondLiberoId: null },
        m.state,
        INDOOR,
      ).reason,
    ).toMatch(/libero/i);
  });
});

describe("indoor validator — timeouts & subs", () => {
  it("enforces the timeout limit (2 per set)", () => {
    const m = new TestMatch();
    m.ready();
    m.dispatch({ type: "RALLY_WON_A" });
    m.apply({ type: "TIMEOUT_REQUEST", team: "A" });
    m.apply({ type: "TIMEOUT_END", team: "A" });
    m.apply({ type: "TIMEOUT_REQUEST", team: "A" });
    m.apply({ type: "TIMEOUT_END", team: "A" });
    const third = validateIndoorEvent({ type: "TIMEOUT_REQUEST", team: "A" }, m.state, INDOOR);
    expect(third.ok).toBe(false);
    expect(third.reason).toMatch(/limit/i);
  });

  it("enforces the substitution limit (6 per set)", () => {
    const m = new TestMatch();
    m.ready();
    for (let i = 0; i < 6; i++) {
      m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: A6[i], inPlayerId: `as${i}` });
    }
    expect(m.set.subsUsedA).toBe(6);
    const seventh = validateIndoorEvent(
      { type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "as0" },
      m.state,
      INDOOR,
    );
    expect(seventh.ok).toBe(false);
    expect(seventh.reason).toMatch(/limit/i);
  });

  it("exhausts a sub slot after both directions are used", () => {
    const m = new TestMatch();
    m.ready();
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "as1" }); // open
    expect(m.set.courtPositionsA[0]).toBe("as1");
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "as1", inPlayerId: "a1" }); // return → exhaust
    expect(m.set.courtPositionsA[0]).toBe("a1");
    const reuse = validateIndoorEvent(
      { type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "as2" },
      m.state,
      INDOOR,
    );
    expect(reuse.ok).toBe(false);
    expect(reuse.reason).toMatch(/slot|illegal/i);
  });

  it("rejects subbing a substitute already used in another slot", () => {
    const m = new TestMatch();
    m.ready();
    m.apply({ type: "SUBSTITUTION", team: "A", outPlayerId: "a1", inPlayerId: "as1" });
    const reused = validateIndoorEvent(
      { type: "SUBSTITUTION", team: "A", outPlayerId: "a2", inPlayerId: "as1" },
      m.state,
      INDOOR,
    );
    expect(reused.ok).toBe(false);
  });
});

describe("indoor libero", () => {
  it("requires a completed rally between libero replacements", () => {
    const m = new TestMatch();
    m.ready();
    // a6 sits at back-row position 6 (index 5)
    m.apply({ type: "LIBERO_REPLACEMENT", team: "A", liberoId: "a7", direction: "IN", outPlayerId: "a6" });
    expect(m.set.libero.liberoOnCourtA).toBe(true);
    expect(m.set.courtPositionsA[5]).toBe("a7");
    const tooSoon = validateIndoorEvent(
      { type: "LIBERO_REPLACEMENT", team: "A", liberoId: "a7", direction: "OUT", outPlayerId: "a6" },
      m.state,
      INDOOR,
    );
    expect(tooSoon.ok).toBe(false);
    expect(tooSoon.reason).toMatch(/rally/i);

    m.dispatch({ type: "RALLY_WON_A" }); // one rally completed
    const ok = validateIndoorEvent(
      { type: "LIBERO_REPLACEMENT", team: "A", liberoId: "a7", direction: "OUT", outPlayerId: "a6" },
      m.state,
      INDOOR,
    );
    expect(ok.ok).toBe(true);
  });

  it("rejects a libero replacing a front-row player", () => {
    const m = new TestMatch();
    m.ready();
    // a3 is front-row centre (position 3, index 2)
    const res = validateIndoorEvent(
      { type: "LIBERO_REPLACEMENT", team: "A", liberoId: "a7", direction: "IN", outPlayerId: "a3" },
      m.state,
      INDOOR,
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/back-row/i);
  });

  it("libero replacement does not count as a substitution", () => {
    const m = new TestMatch();
    m.ready();
    m.apply({ type: "LIBERO_REPLACEMENT", team: "A", liberoId: "a7", direction: "IN", outPlayerId: "a6" });
    expect(m.set.subsUsedA).toBe(0);
    expect(m.state.totalMatchSubsA).toBe(0);
  });
});

describe("indoor VCS", () => {
  const vcs = resolveConfig("INDOOR", { vcsEnabled: true });

  it("retains the challenge on success, deducts on failure", () => {
    const m = new TestMatch("m1", vcs);
    m.ready();
    expect(m.set.vcs.challengesRemainingA).toBe(2);

    m.apply({ type: "VCS_CHALLENGE", team: "A" });
    expect(m.state.rallyPhase).toBe("VCS_ACTIVE");
    m.apply({ type: "VCS_RESULT", upheld: true, team: "A" }); // success → retain
    expect(m.set.vcs.challengesRemainingA).toBe(2);
    expect(m.state.rallyPhase).toBe("BETWEEN_RALLIES");

    m.apply({ type: "VCS_CHALLENGE", team: "A" });
    m.apply({ type: "VCS_RESULT", upheld: false, team: "A" }); // fail → deduct
    expect(m.set.vcs.challengesRemainingA).toBe(1);
  });

  it("deciding set grants a single challenge per team", () => {
    const m = new TestMatch("m1", vcs);
    m.begin();
    m.confirmLineups(1);
    m.startSet(5, "A");
    expect(m.set.vcs.challengesRemainingA).toBe(1);
  });

  it("rejects a challenge when VCS is disabled (default)", () => {
    const m = new TestMatch();
    m.ready();
    expect(
      validateIndoorEvent({ type: "VCS_CHALLENGE", team: "A" }, m.state, INDOOR).ok,
    ).toBe(false);
  });
});

describe("indoor — UNDO & replay", () => {
  it("UNDO removes the targeted event and recomputes", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 3);
    m.score("B", 2); // 3-2
    const lastB = m.events.filter((e) => e.payload.type === "RALLY_WON_B").pop()!;
    m.apply({ type: "UNDO", targetEventId: lastB.id });
    const state = replayEvents("m1", m.events, INDOOR);
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
    const replayed = replayEvents("m1", m.events, INDOOR);
    expect(replayed).toEqual(m.state);
  });
});

describe("indoor append orchestrator", () => {
  const opts = (nextSequence: number) => ({
    nextSequence,
    timestamp: TS,
    makeId: (seq: number) => `e${seq}`,
  });

  it("appends a scoring event plus its SET_END / MATCH_END consequences", () => {
    const m = new TestMatch();
    m.ready();
    m.score("A", 24);
    const res = appendIndoorEvent(
      m.state,
      { type: "RALLY_WON_A" },
      INDOOR,
      opts(m.state.lastSequence + 1),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.newEvents.map((e) => e.payload.type)).toEqual(["RALLY_WON_A", "SET_END"]);
  });

  it("rejects an invalid event with a reason", () => {
    const m = new TestMatch();
    m.ready();
    const res = appendIndoorEvent(
      m.state,
      { type: "VCS_CHALLENGE", team: "A" }, // VCS disabled by default
      INDOOR,
      opts(m.state.lastSequence + 1),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/disabled/i);
  });
});
