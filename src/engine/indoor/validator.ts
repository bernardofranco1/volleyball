/**
 * Indoor event validation. Enforces FIVB rules before an event enters the log.
 * Pure: `validateIndoorEvent(payload, state, config) => {ok, reason?}`. The
 * reducer assumes validated input but stays defensive.
 */

import { type TournamentConfig, timeoutCapForSet } from "../config";
import {
  type IndoorEventPayload,
  type IndoorMatchState,
  type IndoorSetState,
  activeSet,
} from "./types";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const OK: ValidationResult = { ok: true };
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

/** Find the starter slot whose substitute is currently `playerId` (or null). */
function slotForSub(
  slots: Record<string, string | null>,
  subId: string,
): string | null {
  for (const [starter, sub] of Object.entries(slots)) {
    if (sub === subId) return starter;
  }
  return null;
}

function liberoIdsFor(set: IndoorSetState, team: "A" | "B"): (string | null)[] {
  return team === "A"
    ? [set.libero.liberoIdA, set.libero.secondLiberoIdA]
    : [set.libero.liberoIdB, set.libero.secondLiberoIdB];
}

export function validateIndoorEvent(
  payload: IndoorEventPayload,
  state: IndoorMatchState,
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

    case "LINEUP_CONFIRMED": {
      if (state.rallyPhase !== "LINEUP_PENDING")
        return fail("Lineups are not being collected right now");
      if (!set) return fail("No active set");
      const already =
        payload.team === "A" ? set.lineupConfirmedA : set.lineupConfirmedB;
      if (already) return fail("Lineup already confirmed for this team");
      if (payload.playerIds.length !== config.playersPerSide)
        return fail(`Lineup must list ${config.playersPerSide} players`);
      if (new Set(payload.playerIds).size !== payload.playerIds.length)
        return fail("Lineup has duplicate players");
      if (config.liberoEnabled && payload.liberoId) {
        if (payload.playerIds.includes(payload.liberoId))
          return fail("Libero must not be in the starting six");
      }
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

    case "SUBSTITUTION": {
      if (!set) return fail("No active set");
      if (state.rallyPhase !== "BETWEEN_RALLIES")
        return fail("Substitutions are made between rallies");
      const court = payload.team === "A" ? set.courtPositionsA : set.courtPositionsB;
      const slots = payload.team === "A" ? set.subSlotsA : set.subSlotsB;
      const lineup = payload.team === "A" ? set.lineupA : set.lineupB;
      const used = payload.team === "A" ? set.subsUsedA : set.subsUsedB;
      const liberoIds = liberoIdsFor(set, payload.team).filter(Boolean);

      if (!payload.isExceptional && used >= config.maxSubsPerSet)
        return fail("Substitution limit reached for this set");
      if (!court.includes(payload.outPlayerId))
        return fail("Outgoing player is not on court");
      if (court.includes(payload.inPlayerId))
        return fail("Incoming player is already on court");
      if (
        liberoIds.includes(payload.outPlayerId) ||
        liberoIds.includes(payload.inPlayerId)
      )
        return fail("Use a libero replacement, not a substitution, for the libero");

      const outIsStarter = lineup.includes(payload.outPlayerId);
      const slotOpenedFor = outIsStarter ? slots[payload.outPlayerId] : undefined;
      // Case A: a starter (with no open slot) leaves for a fresh substitute.
      if (outIsStarter && slotOpenedFor === undefined) {
        if (lineup.includes(payload.inPlayerId))
          return fail("Incoming player is a starter — not a legal substitute");
        if (slotForSub(slots, payload.inPlayerId) !== null)
          return fail("That substitute has already been used in another slot");
        return OK;
      }
      // Case B: the original starter returns for their own substitute.
      const starterOfOut = slotForSub(slots, payload.outPlayerId);
      if (starterOfOut && payload.inPlayerId === starterOfOut) return OK;

      return fail("Illegal substitution (slot rules, Rule 15.6)");
    }

    case "LIBERO_REPLACEMENT": {
      if (!config.liberoEnabled) return fail("Libero is disabled");
      if (!set) return fail("No active set");
      const liberoIds = liberoIdsFor(set, payload.team);
      if (!liberoIds.includes(payload.liberoId))
        return fail("Not a designated libero for this team");
      const onCourt =
        payload.team === "A"
          ? set.libero.liberoOnCourtA
          : set.libero.liberoOnCourtB;
      const lastRally =
        payload.team === "A"
          ? set.libero.lastLiberoRallyA
          : set.libero.lastLiberoRallyB;
      if (set.ralliesPlayed <= lastRally)
        return fail("A rally must be completed between libero replacements");

      const court = payload.team === "A" ? set.courtPositionsA : set.courtPositionsB;
      if (payload.direction === "IN") {
        if (onCourt) return fail("Libero is already on court");
        const idx = court.indexOf(payload.outPlayerId);
        if (idx < 0) return fail("Player being replaced is not on court");
        // Back-row, non-server only (indices 4,5). Index 0 is back-row but is the
        // server — the libero can't serve (Rule 19), so it can't replace there.
        if (idx !== 4 && idx !== 5)
          return fail("Libero may only replace a back-row player (not the server)");
        return OK;
      }
      // OUT: the replaced back-row player returns.
      if (!onCourt) return fail("Libero is not on court");
      const replacing =
        payload.team === "A"
          ? set.libero.liberoReplacingA
          : set.libero.liberoReplacingB;
      if (replacing && payload.outPlayerId !== replacing)
        return fail("Returning player must be the one the libero replaced");
      return OK;
    }

    case "VCS_CHALLENGE": {
      if (!config.vcsEnabled) return fail("Video Challenge System is disabled");
      if (state.rallyPhase !== "BETWEEN_RALLIES")
        return fail("Challenges can only be used between rallies");
      if (!set) return fail("No active set");
      const remaining =
        payload.team === "A"
          ? set.vcs.challengesRemainingA
          : set.vcs.challengesRemainingB;
      if (remaining <= 0) return fail("No challenges remaining");
      return OK;
    }

    case "VCS_RESULT":
      if (state.rallyPhase !== "VCS_ACTIVE")
        return fail("No challenge under review");
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

    case "FORFEIT":
      // Allowed from COIN_TOSS onward — a no-show default (6.4.2) is recorded
      // before any toss or start; only unset-up or finished matches reject.
      if (state.status === "SETUP")
        return fail("Match must be set up before a forfeit can be recorded");
      if (state.status === "FINISHED")
        return fail("Match is already finished");
      return OK;

    default:
      return OK;
  }
}
