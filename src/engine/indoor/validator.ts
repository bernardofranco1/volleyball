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
  actingLibero,
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

/**
 * Why `playerId` may not enter play, or null if nothing bars them (spec/33 F3).
 *
 * Four bans the rulebook states and the console could not previously honour —
 * every one of them was enterable through a substitution or the next set's
 * line-up:
 *   21.3.3.1 disqualification — the rest of the MATCH
 *   21.3.2.1 expulsion        — the rest of THAT SET only, hence `forSetNumber`
 *   15.7     the player an exceptional substitution took out — the match
 *   19.4.2.2 a libero replaced by a re-designation — the match
 *
 * `forSetNumber` is null when the bar is being checked for a FUTURE set (a
 * line-up stashed during the break): expulsion never reaches a later set, so
 * that check is skipped rather than guessed.
 */
function participationBar(
  state: IndoorMatchState,
  team: "A" | "B",
  playerId: string,
  forSetNumber: number | null,
): string | null {
  const cards = team === "A" ? state.misconductA : state.misconductB;
  for (const c of cards) {
    if (c.playerId !== playerId) continue;
    if (c.type === "MISCONDUCT_DISQUALIFICATION")
      return "That member was disqualified and cannot play again in this match (Rule 21.3.3.1)";
    if (
      c.type === "MISCONDUCT_EXPULSION" &&
      forSetNumber != null &&
      c.setNumber === forSetNumber
    )
      return "That member was expelled and cannot play again in this set (Rule 21.3.2.1)";
  }
  if (state.exceptionallyReplaced?.includes(playerId))
    return "That player left via an exceptional substitution and cannot re-enter the match (Rule 15.7)";
  if (state.retiredLiberos?.includes(playerId))
    return "That libero was replaced by a re-designation and cannot play again in this match (Rule 19.4.2.2)";
  return null;
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
      // Accepted while lineups are being collected (after SET_START, the old
      // flow) AND before the set exists — pre-match (READY) or during the set
      // break — matching the paper flow of lineups-first (spec/21 flow fix).
      // A pre-declared lineup is re-submittable to correct a mistake.
      const collecting = state.rallyPhase === "LINEUP_PENDING";
      const preSet =
        state.status !== "SETUP" &&
        state.status !== "FINISHED" &&
        (!set || !!set.winner);
      if (!collecting && !preSet)
        return fail("Lineups are not being collected right now");
      if (collecting) {
        if (!set) return fail("No active set");
        const already =
          payload.team === "A" ? set.lineupConfirmedA : set.lineupConfirmedB;
        if (already) return fail("Lineup already confirmed for this team");
      }
      if (payload.playerIds.length !== config.playersPerSide)
        return fail(`Lineup must list ${config.playersPerSide} players`);
      if (new Set(payload.playerIds).size !== payload.playerIds.length)
        return fail("Lineup has duplicate players");
      // Participation bans (spec/33 F3). An expulsion bars only its own set,
      // so it counts here just while lineups are being collected FOR that set;
      // a lineup stashed for the next one passes `null`.
      for (const id of [
        ...payload.playerIds,
        payload.liberoId,
        payload.secondLiberoId,
      ]) {
        if (!id) continue;
        const barred = participationBar(
          state,
          payload.team,
          id,
          collecting ? state.currentSetNumber : null,
        );
        if (barred) return fail(barred);
      }
      if (config.liberoEnabled && payload.liberoId) {
        if (payload.playerIds.includes(payload.liberoId))
          return fail("Libero must not be in the starting six");
      }
      // Second libero (Rule 19.1.1, spec/33 F4) — same rules, plus it must be
      // a different player from the first.
      if (config.liberoEnabled && payload.secondLiberoId) {
        if (payload.playerIds.includes(payload.secondLiberoId))
          return fail("Second libero must not be in the starting six");
        if (payload.secondLiberoId === payload.liberoId)
          return fail("The two liberos must be different players");
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
      // A barred member may never come back on — not even through an
      // exceptional substitution, which waives Rule 15.6, not the bans
      // (spec/33 F3).
      const barredIn = participationBar(
        state,
        payload.team,
        payload.inPlayerId,
        set.setNumber,
      );
      if (barredIn) return fail(barredIn);
      if (!court.includes(payload.outPlayerId))
        return fail("Outgoing player is not on court");
      if (court.includes(payload.inPlayerId))
        return fail("Incoming player is already on court");
      if (
        liberoIds.includes(payload.outPlayerId) ||
        liberoIds.includes(payload.inPlayerId)
      )
        return fail("Use a libero replacement, not a substitution, for the libero");

      // Rule 15.7 waives the limits of Rule 15.6 — ALL of them, not just the
      // count (spec/30 R4). The scenario the exceptional substitution exists
      // for is a player who cannot continue when no legal substitution
      // remains, and that player is very often a substitute already on court:
      // under the slot rules only their own starter may replace them, so
      // waiving the count alone still refused the case. The physical checks
      // above stand — on court, not already on court, not the libero.
      if (payload.isExceptional) {
        // 15.7 names three players who may NOT come in this way: the Libero,
        // the second Libero — both already refused above — "or their regular
        // replacement player" (spec/33 F5). While the libero is on court that
        // player is off it, so every other check passes them.
        const liberoReplacement =
          payload.team === "A"
            ? set.libero.liberoReplacingA
            : set.libero.liberoReplacingB;
        if (liberoReplacement && payload.inPlayerId === liberoReplacement)
          return fail(
            "That player is the libero's regular replacement player and cannot be used for an exceptional substitution (Rule 15.7)",
          );
        return OK;
      }

      const outIsStarter = lineup.includes(payload.outPlayerId);
      const slotOpenedFor = outIsStarter ? slots[payload.outPlayerId] : undefined;
      // Case A: a starter (with no open slot) leaves for a fresh substitute.
      if (outIsStarter && slotOpenedFor === undefined) {
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
      const acting = actingLibero(set, payload.team);
      if (payload.direction === "IN") {
        // A libero barred from further play cannot come on (spec/33 F3).
        const barred = participationBar(
          state,
          payload.team,
          payload.liberoId,
          set.setNumber,
        );
        if (barred) return fail(barred);

        // Rule 19.3.2.2 (spec/33 F4): "The Acting Libero can only be replaced
        // by the regular replacement player for that position or by the second
        // Libero." The second half is a libero-for-libero swap — the ONE legal
        // "IN" while a libero is already on court. Everything else still
        // refuses, exactly as before.
        if (onCourt || acting) {
          if (!acting || payload.outPlayerId !== acting)
            return fail("Libero is already on court");
          if (payload.liberoId === acting)
            return fail("That libero is already on court");
          return OK;
        }
        const idx = court.indexOf(payload.outPlayerId);
        if (idx < 0) return fail("Player being replaced is not on court");
        // Back-row positions are 1, 5, 6 → indices 0, 4, 5 (Rule 7.4). The
        // libero may replace ANY of them (Rule 19.3.2.1) — including position
        // 1 — but may never SERVE (spec/29 F10). Position 1 is the serving
        // position, so the replacement there is legal only while the other
        // team holds the serve; once this team side-outs, the libero must come
        // off before their serve.
        if (idx !== 0 && idx !== 4 && idx !== 5)
          return fail("Libero may only replace a back-row player");
        if (idx === 0 && set.currentServer === payload.team)
          return fail(
            "The libero cannot serve — replace a different back-row player, or wait until the opponent serves",
          );
        return OK;
      }
      // OUT: the replaced back-row player returns.
      if (!onCourt) return fail("Libero is not on court");
      // With two liberos registered, only the one actually on court can leave
      // it (Rule 19.1.3 — spec/33 F4).
      if (acting && payload.liberoId !== acting)
        return fail("That libero is not the one on court");
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
