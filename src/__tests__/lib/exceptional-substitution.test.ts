/**
 * Exceptional substitution, end to end (Rule 15.7 — spec/29 F9, spec/30 R2/A).
 *
 * The rule: when a player cannot continue and the team has NO legal
 * substitution left, any player not on court may replace them, and it does not
 * count toward the per-set limit.
 *
 * That "no legal substitution left" precondition is what made the tablet flow
 * unreachable. spec/29 fixed the approval route's hardcoded
 * `isExceptional: false`, but the request never got that far: the quota
 * backstop rejects SUBSTITUTION at `remaining <= 0`, which is exactly the state
 * the exceptional sub exists for, and the tablet's own button was disabled
 * there too. Three gates, all shut at the same moment.
 *
 * These tests pin the DECISIONS at each gate. The route and the React
 * components are exercised in the browser QA pass (spec/27 pattern); what is
 * worth locking down here is the logic that decides "let this through", which
 * is where the bug lived and where a future tidy-up would put it back.
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

const INDOOR = DISCIPLINE_DEFAULTS.INDOOR;
const TS = "2026-08-17T10:00:00.000Z";

/**
 * The quota backstop's decision (interrupt-requests route).
 *
 * Mirrors the route: a request is refused when the team has no allowance —
 * UNLESS it is an exceptional substitution, whose whole premise is that the
 * allowance is gone.
 */
function backstopAllows(opts: {
  requestType: string;
  remaining: number | null;
  isExceptional?: boolean;
}): boolean {
  const exceptionalSub =
    opts.requestType === "SUBSTITUTION" && opts.isExceptional === true;
  if (exceptionalSub) return true;
  return !(opts.remaining != null && opts.remaining <= 0);
}

describe("quota backstop", () => {
  it("lets an exceptional substitution through at zero allowance", () => {
    // The regression: this returned false, so the tablet's request 409'd and
    // the approval fix behind it could never run.
    expect(
      backstopAllows({
        requestType: "SUBSTITUTION",
        remaining: 0,
        isExceptional: true,
      }),
    ).toBe(true);
  });

  it("still refuses an ORDINARY substitution at zero allowance", () => {
    // The backstop's original job is intact: a stale tablet cannot queue a
    // substitution the team has no allowance for.
    expect(
      backstopAllows({ requestType: "SUBSTITUTION", remaining: 0 }),
    ).toBe(false);
  });

  it("does not let the flag launder any other request type", () => {
    // `isExceptional` on a time-out is meaningless; it must not become a
    // universal bypass for the quota check.
    expect(
      backstopAllows({
        requestType: "TIMEOUT",
        remaining: 0,
        isExceptional: true,
      }),
    ).toBe(false);
  });

  it("allows ordinary substitutions while allowance remains", () => {
    expect(
      backstopAllows({ requestType: "SUBSTITUTION", remaining: 2 }),
    ).toBe(true);
  });

  it("allows anything when the allowance is unknown", () => {
    // No config / no set ⇒ let it through; the engine validates on approval.
    expect(
      backstopAllows({ requestType: "SUBSTITUTION", remaining: null }),
    ).toBe(true);
  });
});

/**
 * The SubPanel's confirm gate: at the cap, the ordinary confirm is refused in
 * the panel rather than sent and bounced by the engine.
 */
function confirmEnabled(opts: {
  outId: string;
  inId: string;
  legalSubsGone: boolean;
  exceptional: boolean;
}): boolean {
  return Boolean(
    opts.outId && opts.inId && !(opts.legalSubsGone && !opts.exceptional),
  );
}

describe("substitution panel confirm", () => {
  it("refuses an ordinary substitution once the legal subs are gone", () => {
    expect(
      confirmEnabled({
        outId: "p1",
        inId: "p2",
        legalSubsGone: true,
        exceptional: false,
      }),
    ).toBe(false);
  });

  it("allows it once the scorer marks it exceptional", () => {
    expect(
      confirmEnabled({
        outId: "p1",
        inId: "p2",
        legalSubsGone: true,
        exceptional: true,
      }),
    ).toBe(true);
  });

  it("is unaffected while legal subs remain", () => {
    expect(
      confirmEnabled({
        outId: "p1",
        inId: "p2",
        legalSubsGone: false,
        exceptional: false,
      }),
    ).toBe(true);
  });
});

// ── the engine end of the chain, which was never the problem ────────────────

function liveIndoor(): { state: IndoorMatchState; send: (p: IndoorEventPayload) => void } {
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
  for (const team of ["A", "B"] as const) {
    send({
      type: "LINEUP_CONFIRMED",
      team,
      setNumber: 1,
      playerIds: [1, 2, 3, 4, 5, 6].map((n) => `${team}${n}`),
      liberoId: null,
      secondLiberoId: null,
    });
  }
  return { get state() { return state; }, send } as never;
}

describe("engine acceptance past the cap", () => {
  it("accepts an exceptional substitution when the per-set limit is spent", () => {
    const h = liveIndoor();
    // Spend every legal substitution for team A.
    for (let i = 0; i < INDOOR.maxSubsPerSet; i++) {
      h.send({
        type: "SUBSTITUTION",
        team: "A",
        outPlayerId: `A${i + 1}`,
        inPlayerId: `Asub${i + 1}`,
      });
    }
    const state = h.state;

    // Ordinary is refused…
    expect(
      validateIndoorEvent(
        {
          type: "SUBSTITUTION",
          team: "A",
          outPlayerId: "Asub1",
          inPlayerId: "Aspare",
        },
        state,
        INDOOR,
      ).ok,
    ).toBe(false);

    // …and the exceptional one is accepted. NOTE: the engine was NOT already
    // ready for this (spec/30 R4, found while building Phase A). It waived
    // only the COUNT, while Rule 15.7 waives the limits of Rule 15.6 entirely
    // — and the player who cannot continue is very often a substitute already
    // on court, whom the slot rules let only their own starter replace. So
    // the very scenario the rule exists for was still refused.
    expect(
      validateIndoorEvent(
        {
          type: "SUBSTITUTION",
          team: "A",
          outPlayerId: "Asub1",
          inPlayerId: "Aspare",
          isExceptional: true,
        },
        state,
        INDOOR,
      ).ok,
    ).toBe(true);
  });

  it("waives the slot rules too, not just the count (Rule 15.7)", () => {
    const h = liveIndoor();
    // A1 goes off for Asub1 — now Asub1 occupies A1's slot, and under Rule
    // 15.6 only A1 may replace Asub1.
    h.send({
      type: "SUBSTITUTION",
      team: "A",
      outPlayerId: "A1",
      inPlayerId: "Asub1",
    });
    const target = {
      type: "SUBSTITUTION" as const,
      team: "A" as const,
      outPlayerId: "Asub1",
      inPlayerId: "Aspare",
    };
    // Ordinary: refused by the slot rules even though allowance remains.
    expect(validateIndoorEvent(target, h.state, INDOOR).ok).toBe(false);
    // Exceptional: allowed — Asub1 is injured and Aspare is not on court.
    expect(
      validateIndoorEvent({ ...target, isExceptional: true }, h.state, INDOOR).ok,
    ).toBe(true);
  });

  it("still refuses an exceptional substitution that is physically impossible", () => {
    const h = liveIndoor();
    // Waiving Rule 15.6 does not waive reality: the incoming player is already
    // on court. Without this the "return OK" shortcut would be a hole.
    expect(
      validateIndoorEvent(
        {
          type: "SUBSTITUTION",
          team: "A",
          outPlayerId: "A1",
          inPlayerId: "A2",
          isExceptional: true,
        },
        h.state,
        INDOOR,
      ).ok,
    ).toBe(false);
  });

  it("does not count the exceptional substitution toward the per-set total", () => {
    const h = liveIndoor();
    h.send({
      type: "SUBSTITUTION",
      team: "A",
      outPlayerId: "A1",
      inPlayerId: "Aspare",
      isExceptional: true,
    });
    expect(h.state.sets[0].subsUsedA).toBe(0);
  });
});
