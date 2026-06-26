/**
 * Light VB event validation. Pure: `validateLightEvent(payload, state, config)`.
 * Grass-style gating + the two scorer-called faults (always valid when live).
 */

import type { TournamentConfig } from "../config";
import {
  type LightEventPayload,
  type LightMatchState,
  activeSet,
} from "./types";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const OK: ValidationResult = { ok: true };
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

function slotForSub(
  slots: Record<string, string | null>,
  subId: string,
): string | null {
  for (const [starter, sub] of Object.entries(slots)) {
    if (sub === subId) return starter;
  }
  return null;
}

export function validateLightEvent(
  payload: LightEventPayload,
  state: LightMatchState,
  config: TournamentConfig,
): ValidationResult {
  const set = activeSet(state);
  const liveRally =
    state.rallyPhase === "BETWEEN_RALLIES" || state.rallyPhase === "RALLY_LIVE";

  switch (payload.type) {
    case "RALLY_WON_A":
    case "RALLY_WON_B":
    case "REPLAY_POINT":
    case "JUMP_SERVE_FOOT_FAULT": // referee judgment — valid whenever a rally is live
    case "ATTACK_ARC_FAULT": {
      if (state.status !== "LIVE") return fail("Match is not live");
      if (!set || set.winner) return fail("No active set");
      if (!liveRally) return fail("Not in a rally");
      return OK;
    }

    case "LINEUP_CONFIRMED": {
      if (state.rallyPhase !== "LINEUP_PENDING")
        return fail("Lineups are not being collected right now");
      const n = config.playersPerSide;
      for (const ids of [payload.teamAPlayerIds, payload.teamBPlayerIds]) {
        if (ids.length !== n) return fail(`Each lineup must list ${n} players`);
        if (new Set(ids).size !== ids.length)
          return fail("A lineup has duplicate players");
      }
      return OK;
    }

    case "TIMEOUT_REQUEST": {
      if (state.rallyPhase !== "BETWEEN_RALLIES")
        return fail("Timeouts can only be taken between rallies");
      if (!set) return fail("No active set");
      const used =
        payload.team === "A" ? set.timeoutsUsedA : set.timeoutsUsedB;
      if (used >= config.timeoutsPerSet)
        return fail("Timeout limit reached for this set");
      return OK;
    }

    case "TIMEOUT_END":
      if (state.rallyPhase !== "TIMEOUT_ACTIVE")
        return fail("No timeout is active");
      return OK;

    case "SUBSTITUTION": {
      if (!set) return fail("No active set");
      if (state.rallyPhase !== "BETWEEN_RALLIES")
        return fail("Substitutions are made between rallies");
      const court = payload.team === "A" ? set.courtPositionsA : set.courtPositionsB;
      const slots = payload.team === "A" ? set.subSlotsA : set.subSlotsB;
      const lineup = payload.team === "A" ? set.lineupA : set.lineupB;
      const used = payload.team === "A" ? set.subsUsedA : set.subsUsedB;

      if (!payload.isEmergency && used >= config.maxSubsPerSet)
        return fail("Substitution limit reached for this set");
      if (!court.includes(payload.outPlayerId))
        return fail("Outgoing player is not on court");
      if (court.includes(payload.inPlayerId))
        return fail("Incoming player is already on court");

      const outIsStarter = lineup.includes(payload.outPlayerId);
      if (outIsStarter && slots[payload.outPlayerId] === undefined) {
        if (lineup.includes(payload.inPlayerId))
          return fail("Incoming player is a starter — not a legal substitute");
        if (slotForSub(slots, payload.inPlayerId) !== null)
          return fail("That substitute has already been used in another slot");
        return OK;
      }
      const starterOfOut = slotForSub(slots, payload.outPlayerId);
      if (starterOfOut && payload.inPlayerId === starterOfOut) return OK;
      return fail("Illegal substitution (slot rules)");
    }

    case "MEDICAL_TIMEOUT_END":
      if (state.rallyPhase !== "MEDICAL_TIMEOUT_ACTIVE")
        return fail("No medical timeout is active");
      return OK;

    case "COIN_TOSS":
      if (state.status !== "SETUP" && state.status !== "COIN_TOSS")
        return fail("Coin toss already done");
      return OK;

    case "MATCH_START":
      if (state.status !== "READY")
        return fail("Match is not ready to start (coin toss required)");
      return OK;

    case "SET_START": {
      if (state.status !== "LIVE" && state.status !== "READY")
        return fail("Match must be started before a set begins");
      if (set && !set.winner && state.sets.length >= payload.setNumber)
        return fail("Current set is still in progress");
      return OK;
    }

    default:
      return OK;
  }
}
