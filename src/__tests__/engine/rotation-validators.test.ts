/**
 * Grass and light validator parity (spec/31 backlog item 2).
 *
 * Indoor and beach validators sat around 70% covered; grass and light at ~30%.
 * The uncovered branches were almost all REFUSALS — and a refusal is what
 * stands between a mis-tap and the official record. A validator that silently
 * stops refusing does not fail loudly; it accepts an illegal event and the
 * scoresheet prints it as fact.
 *
 * The two engines share a validator shape (they differ in payload key —
 * `isEmergency` — and in light's extra fault events), so the cases are written
 * once and run against both. Where they legitimately differ, the case says so.
 */
import { describe, expect, it } from "vitest";
import { DISCIPLINE_DEFAULTS } from "@/engine/config";
import { validateGrassEvent } from "@/engine/grass/validator";
import { validateLightEvent } from "@/engine/light/validator";
import { initialGrassState } from "@/engine/grass/types";
import { initialLightState } from "@/engine/light/types";
import { appendGrassEvent } from "@/engine/grass/reducer";
import { appendLightEvent } from "@/engine/light/reducer";

const TS = "2026-08-17T10:00:00.000Z";

/** One harness per discipline, driven by the same script. */
const ENGINES = [
  {
    name: "grass",
    config: DISCIPLINE_DEFAULTS.GRASS,
    initial: initialGrassState,
    append: appendGrassEvent,
    validate: validateGrassEvent,
  },
  {
    name: "light",
    config: DISCIPLINE_DEFAULTS.LIGHT,
    initial: initialLightState,
    append: appendLightEvent,
    validate: validateLightEvent,
  },
] as const;

type Payload = Record<string, unknown> & { type: string };

function harness(e: (typeof ENGINES)[number]) {
  let seq = 0;
  let state = e.initial("m1") as never;
  const send = (payload: Payload) => {
    const r = (e.append as CallableFunction)(state, payload, e.config, {
      nextSequence: seq + 1,
      timestamp: TS,
      makeId: (s: number) => `e${s}`,
    }) as { ok: boolean; reason?: string; newEvents: { sequence: number }[]; state: never };
    if (!r.ok) throw new Error(`rejected ${payload.type}: ${r.reason}`);
    seq = r.newEvents[r.newEvents.length - 1].sequence;
    state = r.state;
  };
  const check = (payload: Payload) =>
    (e.validate as CallableFunction)(payload, state, e.config) as {
      ok: boolean;
      reason?: string;
    };
  const lineup = (team: "A" | "B") =>
    Array.from({ length: e.config.playersPerSide }, (_, i) => `${team}${i + 1}`);

  return {
    send,
    check,
    lineup,
    get state() {
      return state;
    },
    /** Drive to a live set with both lineups confirmed. */
    toLiveSet() {
      send({ type: "MATCH_CREATED", matchId: "m1" });
      send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
      send({ type: "MATCH_START" });
      send({
        type: "SET_START",
        setNumber: 1,
        firstServer: "A",
        teamAStartSide: "LEFT",
      });
      send({
        type: "LINEUP_CONFIRMED",
        setNumber: 1,
        teamAPlayerIds: lineup("A"),
        teamBPlayerIds: lineup("B"),
      });
    },
  };
}

for (const engine of ENGINES) {
  describe(`${engine.name} validator`, () => {
    describe("scoring", () => {
      it("refuses a rally before the match is live", () => {
        const h = harness(engine);
        expect(h.check({ type: "RALLY_WON_A" }).ok).toBe(false);
      });

      it("accepts a rally in a live set", () => {
        const h = harness(engine);
        h.toLiveSet();
        expect(h.check({ type: "RALLY_WON_A" }).ok).toBe(true);
      });

      it("refuses a rally once the set has a winner", () => {
        const h = harness(engine);
        h.toLiveSet();
        // Play the set out; the engine auto-emits SET_END.
        for (let i = 0; i < engine.config.setScore; i++)
          h.send({ type: "RALLY_WON_A" });
        expect(h.check({ type: "RALLY_WON_A" }).ok).toBe(false);
      });
    });

    describe("lineups", () => {
      it("refuses a lineup of the wrong size", () => {
        const h = harness(engine);
        h.send({ type: "MATCH_CREATED", matchId: "m1" });
        h.send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
        h.send({ type: "MATCH_START" });
        const short = h.lineup("A").slice(0, -1);
        const v = h.check({
          type: "LINEUP_CONFIRMED",
          setNumber: 1,
          teamAPlayerIds: short,
          teamBPlayerIds: h.lineup("B"),
        });
        expect(v.ok).toBe(false);
        expect(v.reason).toContain(String(engine.config.playersPerSide));
      });

      it("refuses a lineup naming the same player twice", () => {
        // The classic mis-tap: two slots on one person leaves the court a
        // player short and the rotation order wrong for the whole set.
        const h = harness(engine);
        h.send({ type: "MATCH_CREATED", matchId: "m1" });
        h.send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
        h.send({ type: "MATCH_START" });
        const dup = h.lineup("A");
        dup[1] = dup[0];
        const v = h.check({
          type: "LINEUP_CONFIRMED",
          setNumber: 1,
          teamAPlayerIds: dup,
          teamBPlayerIds: h.lineup("B"),
        });
        expect(v.ok).toBe(false);
        expect(v.reason).toContain("duplicate");
      });

      it("refuses lineups before the match is set up", () => {
        const h = harness(engine);
        expect(
          h.check({
            type: "LINEUP_CONFIRMED",
            setNumber: 1,
            teamAPlayerIds: h.lineup("A"),
            teamBPlayerIds: h.lineup("B"),
          }).ok,
        ).toBe(false);
      });
    });

    describe("time-outs", () => {
      it("refuses one outside the gap between rallies", () => {
        const h = harness(engine);
        expect(h.check({ type: "TIMEOUT_REQUEST", team: "A" }).ok).toBe(false);
      });

      it("refuses one past the per-set cap", () => {
        const h = harness(engine);
        h.toLiveSet();
        for (let i = 0; i < engine.config.timeoutsPerSet; i++) {
          h.send({ type: "TIMEOUT_REQUEST", team: "A" });
          h.send({ type: "TIMEOUT_END", team: "A" });
        }
        const v = h.check({ type: "TIMEOUT_REQUEST", team: "A" });
        expect(v.ok).toBe(false);
        expect(v.reason).toContain("limit");
      });

      it("keeps each team's allowance separate", () => {
        const h = harness(engine);
        h.toLiveSet();
        for (let i = 0; i < engine.config.timeoutsPerSet; i++) {
          h.send({ type: "TIMEOUT_REQUEST", team: "A" });
          h.send({ type: "TIMEOUT_END", team: "A" });
        }
        expect(h.check({ type: "TIMEOUT_REQUEST", team: "B" }).ok).toBe(true);
      });

      it("refuses ending a time-out that is not running", () => {
        const h = harness(engine);
        h.toLiveSet();
        expect(h.check({ type: "TIMEOUT_END", team: "A" }).ok).toBe(false);
      });
    });

    describe("substitutions", () => {
      it("refuses one outside the gap between rallies", () => {
        const h = harness(engine);
        expect(
          h.check({
            type: "SUBSTITUTION",
            team: "A",
            outPlayerId: "A1",
            inPlayerId: "Asub",
          }).ok,
        ).toBe(false);
      });

      it("refuses taking off a player who is not on court", () => {
        const h = harness(engine);
        h.toLiveSet();
        expect(
          h.check({
            type: "SUBSTITUTION",
            team: "A",
            outPlayerId: "ghost",
            inPlayerId: "Asub",
          }).ok,
        ).toBe(false);
      });

      it("refuses bringing on a player already on court", () => {
        const h = harness(engine);
        h.toLiveSet();
        expect(
          h.check({
            type: "SUBSTITUTION",
            team: "A",
            outPlayerId: "A1",
            inPlayerId: "A2",
          }).ok,
        ).toBe(false);
      });

      it("refuses one past the per-set cap", () => {
        // Grass allows more substitutions (4) than it has players on court
        // (3), so the cap can only be reached the way a real team reaches it:
        // a starter leaves, then returns for their own substitute (Rule 15.6
        // slot), which spends two of the allowance each time.
        const h = harness(engine);
        h.toLiveSet();
        const cap = engine.config.maxSubsPerSet;
        for (let i = 0; i < cap; i++) {
          const starter = `A${Math.floor(i / 2) + 1}`;
          const sub = `Asub${Math.floor(i / 2) + 1}`;
          h.send(
            i % 2 === 0
              ? { type: "SUBSTITUTION", team: "A", outPlayerId: starter, inPlayerId: sub }
              : { type: "SUBSTITUTION", team: "A", outPlayerId: sub, inPlayerId: starter },
          );
        }
        // A player untouched so far, so only the CAP can refuse this.
        const untouched = `A${engine.config.playersPerSide}`;
        const v = h.check({
          type: "SUBSTITUTION",
          team: "A",
          outPlayerId: untouched,
          inPlayerId: "Aspare",
        });
        expect(v.ok).toBe(false);
        expect(v.reason).toMatch(/limit/i);
      });

      it("lets an EMERGENCY substitution through the same cap (Rule 15.7)", () => {
        const h = harness(engine);
        h.toLiveSet();
        const cap = engine.config.maxSubsPerSet;
        for (let i = 0; i < cap; i++) {
          const starter = `A${Math.floor(i / 2) + 1}`;
          const sub = `Asub${Math.floor(i / 2) + 1}`;
          h.send(
            i % 2 === 0
              ? { type: "SUBSTITUTION", team: "A", outPlayerId: starter, inPlayerId: sub }
              : { type: "SUBSTITUTION", team: "A", outPlayerId: sub, inPlayerId: starter },
          );
        }
        const untouched = `A${engine.config.playersPerSide}`;
        expect(
          h.check({
            type: "SUBSTITUTION",
            team: "A",
            outPlayerId: untouched,
            inPlayerId: "Aspare",
            isEmergency: true,
          }).ok,
        ).toBe(true);
      });
    });

    describe("match lifecycle", () => {
      it("refuses a second coin toss", () => {
        const h = harness(engine);
        h.send({ type: "MATCH_CREATED", matchId: "m1" });
        h.send({ type: "COIN_TOSS", firstServer: "A", teamAStartSide: "LEFT" });
        expect(
          h.check({
            type: "COIN_TOSS",
            firstServer: "B",
            teamAStartSide: "RIGHT",
          }).ok,
        ).toBe(false);
      });

      it("refuses starting the match before the toss", () => {
        const h = harness(engine);
        h.send({ type: "MATCH_CREATED", matchId: "m1" });
        expect(h.check({ type: "MATCH_START" }).ok).toBe(false);
      });

      it("refuses a forfeit before the match is set up", () => {
        const h = harness(engine);
        expect(
          h.check({ type: "FORFEIT", team: "A", reason: "FORFEIT" }).ok,
        ).toBe(false);
      });

      it("refuses ending a medical timeout that is not running", () => {
        const h = harness(engine);
        h.toLiveSet();
        expect(h.check({ type: "MEDICAL_TIMEOUT_END" }).ok).toBe(false);
      });
    });

    describe("positional faults (spec/29 F13)", () => {
      it("accepts the rotation fault — these disciplines rotate", () => {
        const h = harness(engine);
        h.toLiveSet();
        expect(h.check({ type: "ROTATION_FAULT", team: "A" }).ok).toBe(true);
      });

      it("refuses the beach-only service order fault", () => {
        const h = harness(engine);
        h.toLiveSet();
        expect(h.check({ type: "SERVICE_ORDER_FAULT", team: "A" }).ok).toBe(
          false,
        );
      });

      it("refuses a rotation fault before the match is live", () => {
        const h = harness(engine);
        expect(h.check({ type: "ROTATION_FAULT", team: "A" }).ok).toBe(false);
      });
    });
  });
}
