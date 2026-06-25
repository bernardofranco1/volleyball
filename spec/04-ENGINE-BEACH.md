# 04 — Beach Volleyball Engine

Rules source: FIVB Official Beach Volleyball Rules 2025-2028

## Key rule constants (defaults, all configurable)

```ts
const BEACH_DEFAULTS = {
  bestOf: 3,
  setScore: 21,          // sets 1 & 2
  setScoreTiebreak: 15,  // set 3
  twoPointLead: true,
  sideSwitchEvery: 7,           // sum of both scores at switch (sets 1 & 2)
  sideSwitchTiebreakEvery: 5,   // set 3
  ttoEnabled: true,             // only at FIVB/official competitions
  ttoTriggerScore: 21,          // sum of both scores
  timeoutsPerSet: 1,
  timeoutDurationSecs: 30,
  maxSubsPerSet: 0,             // no substitutions
  playersPerSide: 2,
  rotationEnabled: false,       // no positional rotation
  serverPlayerRequired: true,   // track which player serves (alternates on side-out)
  lineupRequired: false,
  liberoEnabled: false,
  serveClockEnabled: true,
  serveClockSecs: 5,
  vcsEnabled: false,
  blockCountsAsTeamHit: true,   // beach rule: block = 1 of 3 hits
  medicalTimeoutSecs: 300,      // 5-minute injury time
};
```

## Event payload types

```ts
export type BeachEventPayload =
  | { type: "MATCH_CREATED"; matchId: string }
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side }
  | { type: "MATCH_START" }
  | { type: "SET_START"; setNumber: SetNumber; firstServer: TeamId; teamAStartSide: Side }
  | { type: "RALLY_WON_A" }
  | { type: "RALLY_WON_B" }
  | { type: "REPLAY_POINT" }
  | { type: "TIMEOUT_REQUEST"; team: TeamId }
  | { type: "TIMEOUT_END"; team: TeamId }
  | { type: "TTO_START" }         // auto-emitted by system
  | { type: "TTO_END" }
  | { type: "SIDE_SWITCH"; newTeamASide: Side }   // auto-emitted
  | { type: "SET_END"; winner: TeamId; scoreA: number; scoreB: number; setNumber: SetNumber }  // auto-emitted
  | { type: "MATCH_END"; winner: TeamId; setsA: number; setsB: number }
  | { type: "SERVE_CLOCK_EXPIRE" }  // scorer manually records delay sanction
  | { type: "DELAY_WARNING"; team: TeamId }
  | { type: "DELAY_PENALTY"; team: TeamId }
  | { type: "MEDICAL_TIMEOUT"; team: TeamId }
  | { type: "MEDICAL_TIMEOUT_END" }
  | { type: "MISCONDUCT_WARNING"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_PENALTY"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_EXPULSION"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_DISQUALIFICATION"; team: TeamId; playerId: string }
  | { type: "VCS_CHALLENGE"; team: TeamId }
  | { type: "VCS_RESULT"; upheld: boolean; team: TeamId }
  | { type: "UNDO"; targetEventId: string }
  | { type: "NOTE"; text: string };
```

## State shape

```ts
export interface BeachSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  teamAStartSide: Side;
  teamASide: Side;
  firstServer: TeamId;
  currentServer: TeamId;
  // Beach: server alternates between players on side-out
  // player 1 served first → player 2 serves next time team gets serve
  serverPlayerA: 1 | 2;  // which player of team A currently serves
  serverPlayerB: 1 | 2;

  timeoutsUsedA: number;
  timeoutsUsedB: number;
  ttoFired: boolean;      // TTO is permanent; survives UNDO via separate tracking

  // VCS
  challengesRemainingA: number;
  challengesRemainingB: number;

  // Sanctions
  delaySanctionsA: number;  // 0=none, 1=warning, 2+=penalty
  delaySanctionsB: number;

  winner: TeamId | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface BeachMatchState {
  matchId: string;
  status: "SETUP" | "COIN_TOSS" | "READY" | "LIVE" | "FINISHED";
  rallyPhase: RallyPhase;
  currentSetNumber: SetNumber;
  sets: BeachSetState[];
  setsWonA: number;
  setsWonB: number;
  winner: TeamId | null;
  activeTimeoutTeam: TeamId | null;
  ttoActive: boolean;
  ttoFiredSets: number[];    // which set numbers have had TTO fired (immutable)
  matchStartedAt: string | null;
  lastSequence: number;

  // Misconduct tracking
  misconductA: MisconductRecord[];
  misconductB: MisconductRecord[];
}

export type RallyPhase =
  | "IDLE"
  | "BETWEEN_RALLIES"
  | "RALLY_LIVE"
  | "TIMEOUT_ACTIVE"
  | "TTO_ACTIVE"
  | "MEDICAL_TIMEOUT_ACTIVE"
  | "SET_BREAK"
  | "MATCH_OVER";
```

## Reducer: key logic

### RALLY_WON_A / RALLY_WON_B

```ts
case "RALLY_WON_A":
case "RALLY_WON_B": {
  const winner = payload.type === "RALLY_WON_A" ? "A" : "B";
  const loser = oppositeTeam(winner);
  const set = activeSet(state);
  const newScoreA = winner === "A" ? set.scoreA + 1 : set.scoreA;
  const newScoreB = winner === "B" ? set.scoreB + 1 : set.scoreB;

  // Server rotation: beach alternates server player on side-out
  let newServerA = set.serverPlayerA;
  let newServerB = set.serverPlayerB;
  let newServer = set.currentServer;

  if (winner !== set.currentServer) {
    // Side-out: new team serves, other team rotates their server player
    newServer = winner;
    if (winner === "A") newServerA = set.serverPlayerA === 1 ? 2 : 1;
    else               newServerB = set.serverPlayerB === 1 ? 2 : 1;
  }
  // (if winner === currentServer: no rotation, same player serves again)

  return { ...state, sets: [...withUpdatedSet(state.sets, { ...set, scoreA: newScoreA, scoreB: newScoreB,
    currentServer: newServer, serverPlayerA: newServerA, serverPlayerB: newServerB })],
    rallyPhase: "BETWEEN_RALLIES" };
}
```

### Auto-emit after RALLY_WON (in priority order)

Called by the API route after processing RALLY_WON:
1. `computeSetEnd(set, config)` — if set is won, emit SET_END + either MATCH_END or new SET_START
2. `computeSideSwitch(set, config)` — if side switch threshold crossed, emit SIDE_SWITCH
3. `computeTTODue(set, config, ttoFiredSets)` — if sum = ttoTriggerScore and TTO not yet fired in this set, emit TTO_START

**Side switch condition:**
```ts
function isSideSwitchDue(set: BeachSetState, config): boolean {
  const sum = set.scoreA + set.scoreB;
  const interval = set.setNumber === 3 ? config.sideSwitchTiebreakEvery : config.sideSwitchEvery;
  return sum > 0 && sum % interval === 0;
}
```

**Set won condition:**
```ts
function isSetWon(set: BeachSetState, config): boolean {
  const target = set.setNumber < config.bestOf ? config.setScore : config.setScoreTiebreak;
  const maxScore = Math.max(set.scoreA, set.scoreB);
  const minScore = Math.min(set.scoreA, set.scoreB);
  return maxScore >= target && maxScore - minScore >= 2;
}
```

**TTO condition:**
```ts
function isTTODue(set: BeachSetState, config, ttoFiredSets: number[]): boolean {
  if (!config.ttoEnabled) return false;
  if (set.setNumber === config.bestOf) return false;  // no TTO in deciding set
  if (ttoFiredSets.includes(set.setNumber)) return false;
  return set.scoreA + set.scoreB === config.ttoTriggerScore;
}
```

**TTO survives UNDO:** `ttoFiredSets` is only written once per set and never removed during UNDO replay. The reducer tracks `ttoFiredSets` and skips re-firing.

## Validation rules

```ts
function validateBeachEvent(payload, state, config): {ok: boolean, reason?: string} {
  const set = activeSet(state);

  switch (payload.type) {
    case "TIMEOUT_REQUEST":
      if (state.rallyPhase !== "BETWEEN_RALLIES") return {ok: false, reason: "Not between rallies"};
      const used = payload.team === "A" ? set.timeoutsUsedA : set.timeoutsUsedB;
      if (used >= config.timeoutsPerSet) return {ok: false, reason: "Timeout limit reached"};
      break;

    case "VCS_CHALLENGE":
      if (!config.vcsEnabled) return {ok: false, reason: "VCS disabled"};
      const remaining = payload.team === "A" ? set.challengesRemainingA : set.challengesRemainingB;
      if (remaining <= 0) return {ok: false, reason: "No challenges remaining"};
      break;
  }
  return {ok: true};
}
```

## UNDO behavior

On UNDO, the entire match is re-replayed from `MATCH_CREATED` skipping the targeted event. `ttoFiredSets` are rebuilt during replay — TTO fires are re-detected as long as the sum is still crossed after the UNDO.

If the UNDO target was the RALLY_WON that triggered the TTO, the TTO is also un-fired (it won't be in `ttoFiredSets` after replay).

## Unit tests required

```
✓ rally scoring increments correct team
✓ side-out switches server player
✓ server player alternates correctly across multiple side-outs
✓ side switch fires at correct sum intervals (7/5)
✓ side switch does not fire twice for same sum
✓ TTO fires at sum=21 in sets 1 and 2
✓ TTO does not fire in set 3
✓ TTO survives UNDO (does not re-fire after undo of preceding rally)
✓ set won at 21 with 2-point lead
✓ set continues at 20-20 until 2-point lead
✓ match won after correct number of sets
✓ timeout limit enforced (1/set for beach)
✓ VCS challenge deducted on failure, retained on success
✓ UNDO removes last event and recalculates state
✓ replayEvents produces same state as incremental reduce
✓ all auto-emitted events fire in correct order
```
