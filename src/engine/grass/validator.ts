/**
 * Grass event validation. Pure: `validateGrassEvent(payload, state, config)`.
 * Beach-style gating plus lineup confirmation and indoor-style substitution slot
 * rules (Rule 15.6 analogue).
 */

import { type TournamentConfig, timeoutCapForSet } from "../config";
import {
  type GrassEventPayload,
  type GrassMatchState,
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

export function validateGrassEvent(
  payload: GrassEventPayload,
  state: GrassMatchState,
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
      // Accepted while lineups are being collected (after SET_START, the old
      // flow) AND before the set exists — pre-match (READY) or during the set
      // break — matching the paper flow of lineups-first (spec/21 flow fix).
      const collecting = state.rallyPhase === "LINEUP_PENDING";
      const preSet =
        state.status !== "SETUP" &&
        state.status !== "FINISHED" &&
        (!set || !!set.winner);
      if (!collecting && !preSet)
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

      if (!payload.isEmergency && used >= config.maxSubsPerSet)
        return fail("Substitution limit reached for this set");
      if (!court.includes(payload.outPlayerId))
        return fail("Outgoing player is not on court");
      if (court.includes(payload.inPlayerId))
        return fail("Incoming player is already on court");

      // Emergency substitution waives the slot rules as well as the count —
      // same reasoning as indoor's Rule 15.7 (spec/30 R4).
      if (payload.isEmergency) return OK;

      const outIsStarter = lineup.includes(payload.outPlayerId);
      if (outIsStarter && slots[payload.outPlayerId] === undefined) {
        if (lineup.includes(payload.inPlayerId))
          return fail("Incoming player is a starter — not a legal substitute");
        // Rule 15.6.2 — a substitute enters "only once per set". The slot map
        // forgets them once their starter returns, so the entry list is what
        // makes the second entry refusable (spec/33 F2). Absent on old
        // snapshots ⇒ empty, and the slot check below still covers open slots.
        const alreadyEntered =
          payload.team === "A" ? (set.usedSubsA ?? []) : (set.usedSubsB ?? []);
        if (alreadyEntered.includes(payload.inPlayerId))
          return fail("That substitute has already entered this set (Rule 15.6.2)");
        if (slotForSub(slots, payload.inPlayerId) !== null)
          return fail("That substitute has already been used in another slot");
        return OK;
      }
      const starterOfOut = slotForSub(slots, payload.outPlayerId);
      if (starterOfOut && payload.inPlayerId === starterOfOut) return OK;
      return fail("Illegal substitution (slot rules)");
    }

    case "MEDICAL_TIMEOUT": {
      // Rule 17.1.2 (Official Volleyball Rules 2025-2028): a player gets a
      // 3-minute recovery "but not more than once for the same player in the
      // match". Enforced only where the limit is sourced — see
      // `recoveriesPerPlayerPerMatch` in engine/config.ts; null means record
      // without capping, which is what beach/grass/light do until their own
      // rulebooks are supplied (spec/30 Phase F).
      //
      // A recovery with NO playerId stays accepted: the referee may stop play
      // before the player is identified, and refusing would lose the record of
      // an interruption that really happened. Old logs replay unchanged —
      // validation runs only at append.
      const cap = config.recoveriesPerPlayerPerMatch;
      if (cap != null && payload.playerId) {
        const used = state.recoveriesByPlayer?.[payload.playerId] ?? 0;
        if (used >= cap)
          return fail(
            `That player has already taken their recovery this match (Rule 17.1.2). If they cannot continue, use an exceptional substitution — or the team is incomplete.`,
          );
      }
      return OK;
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

    case "SET_DEFAULT": {
      // Unlike a forfeit this awards ONE set, so it needs a set to award: it
      // is meaningless before play and after the match is over (spec/29 F14).
      if (state.status !== "LIVE")
        return fail("A set can only be defaulted while the match is live");
      const open = state.sets[state.currentSetNumber - 1];
      if (!open || open.winner)
        return fail("No set in progress to default");
      return OK;
    }

    // Positional faults (spec/29 F13). Gated on the CONFIG, not the discipline
    // name: a rotation fault is meaningless where there is no rotation, and a
    // service-order fault is meaningless where there is one.
    case "ROTATION_FAULT":
      if (!config.rotationEnabled)
        return fail("This discipline has no rotation order");
      if (state.status !== "LIVE") return fail("Match is not live");
      return OK;

    case "SERVICE_ORDER_FAULT":
      if (config.rotationEnabled)
        return fail("Rotation disciplines record a rotation fault instead");
      if (state.status !== "LIVE") return fail("Match is not live");
      return OK;

    case "RALLY_START":
      // Timing anchor (spec/22): only meaningful while play can start.
      if (state.status !== "LIVE") return fail("Match is not live");
      if (state.rallyPhase !== "BETWEEN_RALLIES")
        return fail("A rally is not about to start");
      return OK;

    default:
      return OK;
  }
}
