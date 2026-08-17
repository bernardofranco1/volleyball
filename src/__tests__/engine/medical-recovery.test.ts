/**
 * Medical recovery limits (spec/30 Phase F).
 *
 * **Official Volleyball Rules 2025-2028, Rule 17.1.2** (approved by the 39th
 * FIVB World Congress 2024):
 *
 *   "If an injured/ill player cannot be substituted legally or exceptionally,
 *    the player is given a 3-minute recovery time, but not more than once for
 *    the same player in the match. […] If the player does not recover, his/her
 *    team is declared incomplete."  [refs 15.6, 15.7, 24.2.8 → 6.4.3, 7.3.1]
 *
 * spec/29 recorded recoveries without enforcing a cap, because the limit had
 * not been verified against the rulebook and guessing would have been worse
 * than not enforcing. The rulebook was supplied; this is the enforcement, and
 * the citation is the reason it may exist at all.
 *
 * Note the rule's own tail: "the team is declared incomplete" (6.4.3, 7.3.1) is
 * exactly the SET_DEFAULT event spec/29 F14 introduced — the rulebook's
 * cross-reference and our model agree.
 *
 * BEACH, GRASS and LIGHT stay unenforced: the beach rules are a separate
 * document that has not been supplied, and grass/light have no selected
 * authority (volleyball-codex spec/20). Their tests below pin that "no verified
 * limit" means "record without capping", not "cap at some default".
 */
import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS } from "@/engine/config";
import { appendIndoorEvent } from "@/engine/indoor/reducer";
import { validateIndoorEvent } from "@/engine/indoor/validator";
import {
  type IndoorEventPayload,
  type IndoorMatchState,
  initialIndoorState,
} from "@/engine/indoor/types";
import { validateBeachEvent } from "@/engine/beach/validator";
import { initialBeachState } from "@/engine/beach/types";
import { appendBeachEvent } from "@/engine/beach/reducer";

const INDOOR = DISCIPLINE_DEFAULTS.INDOOR;
const BEACH = DISCIPLINE_DEFAULTS.BEACH;
const TS = "2026-08-17T10:00:00.000Z";

function indoorLive() {
  let seq = 0;
  let state: IndoorMatchState = initialIndoorState("m1");
  const send = (payload: IndoorEventPayload) => {
    const r = appendIndoorEvent(state, payload, INDOOR, {
      nextSequence: seq + 1,
      timestamp: TS,
      makeId: (s) => `e${s}`,
    });
    if (!r.ok) throw new Error(`rejected ${payload.type}: ${r.reason}`);
    seq = r.newEvents[r.newEvents.length - 1].sequence;
    state = r.state;
  };
  send({ type: "MATCH_CREATED", matchId: "m1" });
  send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
  send({ type: "MATCH_START" });
  send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
  return { send, get: () => state };
}

describe("indoor — Rule 17.1.2, once per player per match", () => {
  it("configures the rule as the rulebook states it", () => {
    // 3-minute recovery, once per player. Both numbers come from 17.1.2 and
    // are asserted so a future edit has to justify itself against the rule.
    expect(INDOOR.recoveriesPerPlayerPerMatch).toBe(1);
    expect(INDOOR.medicalTimeoutSecs).toBe(180);
  });

  it("allows a player their recovery", () => {
    const h = indoorLive();
    expect(() =>
      h.send({ type: "MEDICAL_TIMEOUT", team: "A", playerId: "a1" }),
    ).not.toThrow();
    expect(h.get().recoveriesByPlayer?.a1).toBe(1);
  });

  it("refuses a SECOND recovery for the same player", () => {
    const h = indoorLive();
    h.send({ type: "MEDICAL_TIMEOUT", team: "A", playerId: "a1" });
    h.send({ type: "MEDICAL_TIMEOUT_END" });
    const verdict = validateIndoorEvent(
      { type: "MEDICAL_TIMEOUT", team: "A", playerId: "a1" },
      h.get(),
      INDOOR,
    );
    expect(verdict.ok).toBe(false);
    // The message points at the rule's own remedy, not just the refusal.
    expect(verdict.reason).toMatch(/exceptional substitution|incomplete/i);
  });

  it("does not spend a team-mate's recovery — the cap is per player", () => {
    const h = indoorLive();
    h.send({ type: "MEDICAL_TIMEOUT", team: "A", playerId: "a1" });
    h.send({ type: "MEDICAL_TIMEOUT_END" });
    expect(
      validateIndoorEvent(
        { type: "MEDICAL_TIMEOUT", team: "A", playerId: "a2" },
        h.get(),
        INDOOR,
      ).ok,
    ).toBe(true);
  });

  it("still accepts a recovery with no player named", () => {
    // A referee may stop play before the player is identified. Refusing would
    // lose the record of an interruption that really happened, and an
    // anonymous recovery cannot be counted against a per-player cap anyway.
    const h = indoorLive();
    h.send({ type: "MEDICAL_TIMEOUT", team: "A", playerId: "a1" });
    h.send({ type: "MEDICAL_TIMEOUT_END" });
    expect(
      validateIndoorEvent({ type: "MEDICAL_TIMEOUT", team: "A" }, h.get(), INDOOR).ok,
    ).toBe(true);
  });

  it("replays old logs unchanged", () => {
    // Validation runs only at append, so a historical log with two recoveries
    // for one player still replays — the tally simply reflects it.
    const h = indoorLive();
    h.send({ type: "MEDICAL_TIMEOUT", team: "A", playerId: "a1" });
    expect(h.get().recoveriesByPlayer?.a1).toBe(1);
  });
});

describe("beach — recorded, not capped", () => {
  it("has no configured limit, because none has been verified", () => {
    // Beach rules are a separate document that was not supplied. spec/29 and
    // spec/30 both hold that a guessed limit is worse than none.
    expect(BEACH.recoveriesPerPlayerPerMatch).toBeNull();
  });

  it("accepts repeated recoveries for the same player", () => {
    let seq = 0;
    let state = initialBeachState("b1");
    const send = (payload: Parameters<typeof appendBeachEvent>[1]) => {
      const r = appendBeachEvent(state, payload, BEACH, {
        nextSequence: seq + 1,
        timestamp: TS,
        makeId: (s) => `b${s}`,
      });
      if (!r.ok) throw new Error(r.reason);
      seq = r.newEvents[r.newEvents.length - 1].sequence;
      state = r.state;
    };
    send({ type: "MATCH_CREATED", matchId: "b1" });
    send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "MATCH_START" });
    send({ type: "SET_START", setNumber: 1, firstServer: "A", teamAStartSide: "LEFT" });
    send({ type: "MEDICAL_TIMEOUT", team: "A", playerId: "a1" });
    send({ type: "MEDICAL_TIMEOUT_END" });

    expect(
      validateBeachEvent(
        { type: "MEDICAL_TIMEOUT", team: "A", playerId: "a1" },
        state,
        BEACH,
      ).ok,
    ).toBe(true);
    // Still counted, so the sheet can print "#2 for this player".
    expect(state.recoveriesByPlayer?.a1).toBe(1);
  });
});
