/**
 * Beach event validation. Enforces FIVB rules before an event is accepted into
 * the log. Pure: `validateBeachEvent(payload, state, config) => {ok, reason?}`.
 */

import { type TournamentConfig, timeoutCapForSet } from "../config";
import {
  type BeachEventPayload,
  type BeachMatchState,
  activeSet,
} from "./types";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const OK: ValidationResult = { ok: true };
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

export function validateBeachEvent(
  payload: BeachEventPayload,
  state: BeachMatchState,
  config: TournamentConfig,
): ValidationResult {
  const set = activeSet(state);

  switch (payload.type) {
    case "RALLY_WON_A":
    case "RALLY_WON_B":
    case "REPLAY_POINT": {
      if (state.status !== "LIVE") return fail("Match is not live");
      if (!set || set.winner) return fail("No active set");
      const live =
        state.rallyPhase === "BETWEEN_RALLIES" ||
        state.rallyPhase === "RALLY_LIVE";
      if (!live) return fail("Not in a rally");
      return OK;
    }

    case "TIMEOUT_REQUEST": {
      if (state.rallyPhase !== "BETWEEN_RALLIES")
        return fail("Timeouts can only be taken between rallies");
      if (!set) return fail("No active set");
      const used =
        payload.team === "A" ? set.timeoutsUsedA : set.timeoutsUsedB;
      if (used >= timeoutCapForSet(config, set.setNumber))
        return fail("Timeout limit reached for this set");
      return OK;
    }

    case "TIMEOUT_END":
      if (state.rallyPhase !== "TIMEOUT_ACTIVE")
        return fail("No timeout is active");
      return OK;

    case "VCS_CHALLENGE": {
      if (!config.vcsEnabled) return fail("Video Challenge System is disabled");
      if (!set) return fail("No active set");
      const remaining =
        payload.team === "A"
          ? set.challengesRemainingA
          : set.challengesRemainingB;
      if (remaining <= 0) return fail("No challenges remaining");
      return OK;
    }

    case "TTO_END":
      if (state.rallyPhase !== "TTO_ACTIVE")
        return fail("No technical timeout is active");
      return OK;

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
      if (payload.setNumber > config.bestOf)
        return fail("Match has no set beyond the deciding set");
      return OK;
    }

    default:
      return OK;
  }
}
