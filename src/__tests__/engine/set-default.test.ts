/**
 * SET_DEFAULT — one set awarded to the opponent (spec/29 F14).
 *
 * An expulsion can leave a team unable to field a complete line-up for the rest
 * of the set (FIVB 7.3.1). The set goes to the opponent and the MATCH CONTINUES
 * — which is what separates this from FORFEIT, and why it could not simply
 * reuse the forfeit machinery as spec/29 originally assumed (§Revalidation §4).
 *
 * The implementation deliberately does NOT close the set itself: it awards the
 * score the rulebook awards and lets the ordinary auto-emit pass produce
 * SET_END (and MATCH_END when that was the deciding set). These tests pin that
 * — if the set ever stopped closing through the normal path, tallies, phases
 * and snapshots would drift apart from a set won on court.
 */
import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS } from "@/engine/config";
import { appendBeachEvent } from "@/engine/beach/reducer";
import {
  type BeachEvent,
  type BeachEventPayload,
  type BeachMatchState,
  initialBeachState,
} from "@/engine/beach/types";
import { validateBeachEvent } from "@/engine/beach/validator";
import { appendIndoorEvent } from "@/engine/indoor/reducer";
import {
  type IndoorEventPayload,
  type IndoorMatchState,
  initialIndoorState,
} from "@/engine/indoor/types";
import { selectUndoTargets } from "@/lib/match-engine";
import type { EngineEvent } from "@/engine/registry";

const BEACH = DISCIPLINE_DEFAULTS.BEACH;
const INDOOR = DISCIPLINE_DEFAULTS.INDOOR;
const TS = "2026-08-17T10:00:00.000Z";

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
  return { send, getState: () => state, log };
}

function rally(h: ReturnType<typeof beachHarness>, type: "RALLY_WON_A" | "RALLY_WON_B") {
  h.send({ type });
  if (h.getState().rallyPhase === "TTO_ACTIVE") h.send({ type: "TTO_END" });
}

function startBeach(h: ReturnType<typeof beachHarness>) {
  h.send({ type: "MATCH_CREATED", matchId: "m1" });
  h.send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
  h.send({ type: "MATCH_START" });
  h.send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
}

describe("SET_DEFAULT — the set only", () => {
  it("awards the open set to the opponent and leaves the match live", () => {
    const h = beachHarness();
    startBeach(h);
    for (let i = 0; i < 8; i++) rally(h, "RALLY_WON_B"); // 0-8

    h.send({ type: "SET_DEFAULT", team: "B", reason: "INCOMPLETE_TEAM" });
    const s = h.getState();

    // A takes the set at exactly the score they needed; B keeps their points —
    // the rulebook's convention, same as a retirement's open set.
    expect(s.sets[0].winner).toBe("A");
    expect(s.sets[0].scoreA).toBe(21);
    expect(s.sets[0].scoreB).toBe(8);
    expect(s.setsWonA).toBe(1);
    expect(s.setsWonB).toBe(0);

    // THE POINT OF THE EVENT: the match is not over.
    expect(s.status).toBe("LIVE");
    expect(s.winner).toBeNull();
    expect(s.rallyPhase).toBe("SET_BREAK");
  });

  it("closes through the normal SET_END path, not a bespoke one", () => {
    const h = beachHarness();
    startBeach(h);
    h.send({ type: "SET_DEFAULT", team: "A", reason: "INCOMPLETE_TEAM" });
    // The auto-emit pass must have produced the same event a set won on court
    // produces — that is what keeps tallies, phases and snapshots consistent.
    expect(h.log.map((e) => e.payload.type)).toContain("SET_END");
    expect(h.log.map((e) => e.payload.type)).not.toContain("MATCH_END");
  });

  it("ends the match when it was the deciding set", () => {
    const h = beachHarness();
    startBeach(h);
    h.send({ type: "SET_DEFAULT", team: "B", reason: "INCOMPLETE_TEAM" }); // A 1-0
    h.send({ type: "SET_START", setNumber: 2, firstServer: "B", teamAStartSide: "RIGHT" });
    h.send({ type: "SET_DEFAULT", team: "B", reason: "INCOMPLETE_TEAM" }); // A 2-0

    const s = h.getState();
    expect(s.setsWonA).toBe(2);
    expect(s.status).toBe("FINISHED");
    expect(s.winner).toBe("A");
    expect(h.log.map((e) => e.payload.type)).toContain("MATCH_END");
  });

  it("keeps points already scored by the defaulting team", () => {
    const h = beachHarness();
    startBeach(h);
    for (let i = 0; i < 15; i++) rally(h, "RALLY_WON_A");
    for (let i = 0; i < 3; i++) rally(h, "RALLY_WON_B"); // 15-3
    // A defaults: B wins the set, but must still clear A's 15 by two.
    h.send({ type: "SET_DEFAULT", team: "A", reason: "INCOMPLETE_TEAM" });
    const s = h.getState();
    expect(s.sets[0].scoreA).toBe(15);
    expect(s.sets[0].scoreB).toBe(21);
    expect(s.sets[0].winner).toBe("B");
  });

  it("clears any interruption it lands in", () => {
    const h = beachHarness();
    startBeach(h);
    h.send({ type: "TIMEOUT_REQUEST", team: "A" });
    h.send({ type: "SET_DEFAULT", team: "A", reason: "INCOMPLETE_TEAM" });
    const s = h.getState();
    expect(s.activeTimeoutTeam).toBeNull();
    expect(s.medicalTimeoutTeam).toBeNull();
  });
});

describe("SET_DEFAULT — validation", () => {
  const live = (): BeachMatchState => {
    const h = beachHarness();
    startBeach(h);
    return h.getState();
  };

  it("is accepted while a set is in progress", () => {
    expect(
      validateBeachEvent(
        { type: "SET_DEFAULT", team: "A", reason: "INCOMPLETE_TEAM" },
        live(),
        BEACH,
      ).ok,
    ).toBe(true);
  });

  it("is rejected before the match is live — there is no set to award", () => {
    expect(
      validateBeachEvent(
        { type: "SET_DEFAULT", team: "A", reason: "INCOMPLETE_TEAM" },
        initialBeachState("m1"),
        BEACH,
      ).ok,
    ).toBe(false);
  });

  it("is rejected once the set is already decided", () => {
    const h = beachHarness();
    startBeach(h);
    h.send({ type: "SET_DEFAULT", team: "B", reason: "INCOMPLETE_TEAM" });
    // Set closed, match in the break: nothing left to default.
    expect(
      validateBeachEvent(
        { type: "SET_DEFAULT", team: "B", reason: "INCOMPLETE_TEAM" },
        h.getState(),
        BEACH,
      ).ok,
    ).toBe(false);
  });
});

describe("SET_DEFAULT — undo", () => {
  it("is undone together with the SET_END it caused", () => {
    const h = beachHarness();
    startBeach(h);
    for (let i = 0; i < 5; i++) rally(h, "RALLY_WON_A");
    h.send({ type: "SET_DEFAULT", team: "B", reason: "INCOMPLETE_TEAM" });

    const targets = selectUndoTargets(
      h.log as unknown as EngineEvent<{ type: string }>[],
    );
    const types = targets.map((t) => t.payload.type);
    // The scorer targets the default; its auto-emitted consequence goes with
    // it, exactly like undoing the set-winning rally.
    expect(types).toContain("SET_DEFAULT");
    expect(types).toContain("SET_END");
  });
});

describe("SET_DEFAULT — indoor", () => {
  it("behaves identically on the six-a-side engine", () => {
    let seq = 0;
    let state: IndoorMatchState = initialIndoorState("m2");
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
    send({ type: "MATCH_CREATED", matchId: "m2" });
    send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "MATCH_START" });
    send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "SET_DEFAULT", team: "A", reason: "INCOMPLETE_TEAM" });

    // Indoor sets are to 25 — the target comes from config, not a constant.
    expect(state.sets[0].scoreB).toBe(25);
    expect(state.sets[0].winner).toBe("B");
    expect(state.setsWonB).toBe(1);
    expect(state.status).toBe("LIVE");
  });
});

describe("causedBy on a rally", () => {
  it("is carried without changing how the point scores", () => {
    // The penalty point is an ORDINARY rally event (spec/29 §Revalidation §4):
    // that is what keeps set/match ends, side switches and undo working. The
    // extra field is informational, and old logs without it replay the same.
    const h = beachHarness();
    startBeach(h);
    h.send({ type: "RALLY_WON_A", causedBy: "evt_sanction_1" } as BeachEventPayload);
    const s = h.getState();
    expect(s.sets[0].scoreA).toBe(1);
    const scored = h.log.find((e) => e.payload.type === "RALLY_WON_A");
    expect((scored?.payload as { causedBy?: string }).causedBy).toBe(
      "evt_sanction_1",
    );
  });
});

// ── positional fault markers (spec/29 F13) ──────────────────────────────────
//
// Both faults are MARKERS: they record what was whistled and score nothing.
// That is what makes late-discovery cancellation a plain batch of undos over
// ordinary rallies, with no bespoke state to unwind.

describe("positional fault markers", () => {
  it("records a service order fault on beach without touching the score", () => {
    const h = beachHarness();
    startBeach(h);
    rally(h, "RALLY_WON_A"); // 1-0
    h.send({ type: "SERVICE_ORDER_FAULT", team: "B" });
    const s = h.getState();
    expect(s.sets[0].scoreA).toBe(1);
    expect(s.sets[0].scoreB).toBe(0);
    // The point comes separately, as an ordinary rally.
    rally(h, "RALLY_WON_A");
    expect(h.getState().sets[0].scoreA).toBe(2);
  });

  it("refuses a rotation fault where there is no rotation", () => {
    const h = beachHarness();
    startBeach(h);
    const r = validateBeachEvent(
      { type: "ROTATION_FAULT", team: "A" },
      h.getState(),
      BEACH,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses a service order fault on a rotation discipline", () => {
    let seq = 0;
    let state: IndoorMatchState = initialIndoorState("m3");
    const send = (payload: IndoorEventPayload) => {
      const r = appendIndoorEvent(state, payload, INDOOR, {
        nextSequence: seq + 1,
        timestamp: TS,
        makeId: (s) => `x${s}`,
      });
      if (!r.ok) throw new Error(r.reason);
      seq = r.newEvents[r.newEvents.length - 1].sequence;
      state = r.state;
    };
    send({ type: "MATCH_CREATED", matchId: "m3" });
    send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "MATCH_START" });
    send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    // Indoor rotates, so the rotation fault is the applicable one…
    expect(() => send({ type: "ROTATION_FAULT", team: "A" })).not.toThrow();
    // …and the beach one is refused.
    expect(() => send({ type: "SERVICE_ORDER_FAULT", team: "A" })).toThrow();
  });
});

// ── libero at position 1 (spec/29 F10) ──────────────────────────────────────
//
// Rule 19.3.2.1 lets the libero replace ANY back-row player — positions 1, 5
// and 6 — but Rule 19.3.2.2 forbids the libero from serving. The old validator
// enforced the second rule by banning position 1 outright, which also banned
// the legal case: replacing there while the OPPONENT holds the serve.

describe("libero at position 1", () => {
  function indoorInSet() {
    let seq = 0;
    let state: IndoorMatchState = initialIndoorState("m4");
    const send = (payload: IndoorEventPayload) => {
      const r = appendIndoorEvent(state, payload, INDOOR, {
        nextSequence: seq + 1,
        timestamp: TS,
        makeId: (s) => `l${s}`,
      });
      if (!r.ok) throw new Error(`rejected ${payload.type}: ${r.reason}`);
      seq = r.newEvents[r.newEvents.length - 1].sequence;
      state = r.state;
    };
    send({ type: "MATCH_CREATED", matchId: "m4" });
    send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "MATCH_START" });
    send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    for (const team of ["A", "B"] as const) {
      send({
        type: "LINEUP_CONFIRMED",
        team,
        setNumber: 1,
        playerIds: [`${team}1`, `${team}2`, `${team}3`, `${team}4`, `${team}5`, `${team}6`],
        liberoId: `${team}L`,
        secondLiberoId: null,
      });
    }
    return { send, get: () => state };
  }

  it("allows the replacement at position 1 while the opponent serves", () => {
    const h = indoorInSet();
    // A serves first, so B is the receiving team: B's position-1 player may be
    // replaced by their libero.
    expect(() =>
      h.send({
        type: "LIBERO_REPLACEMENT",
        team: "B",
        liberoId: "BL",
        direction: "IN",
        outPlayerId: "B1",
      }),
    ).not.toThrow();
  });

  it("refuses it for the serving team — the libero may never serve", () => {
    const h = indoorInSet();
    expect(() =>
      h.send({
        type: "LIBERO_REPLACEMENT",
        team: "A",
        liberoId: "AL",
        direction: "IN",
        outPlayerId: "A1",
      }),
    ).toThrow(/cannot serve/);
  });

  it("still allows positions 5 and 6 for either team", () => {
    const h = indoorInSet();
    expect(() =>
      h.send({
        type: "LIBERO_REPLACEMENT",
        team: "A",
        liberoId: "AL",
        direction: "IN",
        outPlayerId: "A5",
      }),
    ).not.toThrow();
  });

  it("still refuses a front-row player", () => {
    const h = indoorInSet();
    expect(() =>
      h.send({
        type: "LIBERO_REPLACEMENT",
        team: "B",
        liberoId: "BL",
        direction: "IN",
        outPlayerId: "B3",
      }),
    ).toThrow(/back-row/);
  });
});
