# 07 — Light Volleyball Engine

Rules source: Official Light Volleyball Competition Rules 2022-2025

## Key rule constants (defaults, all configurable)

```ts
const LIGHT_DEFAULTS = {
  bestOf: 3,
  setScore: 21,
  setScoreTiebreak: 15,
  twoPointLead: true,

  // Side switches: between sets only; deciding set at 8 pts
  sideSwitchBetweenSetsOnly: true,
  sideSwitchDecidingSetAt: 8,

  // No TTO
  ttoEnabled: false,

  // Timeouts
  timeoutsPerSet: 2,
  timeoutDurationSecs: 30,

  // Subs depend on format
  maxSubsPerSet: 4,       // 4-player: 4 subs; 5-player: 5 subs

  // Player count
  playersPerSide: 4,      // 4 or 5 (set at competition level, not match level)

  // Rotation: full clockwise, same as indoor
  rotationEnabled: true,
  lineupRequired: true,
  serverPlayerRequired: true,

  // No libero
  liberoEnabled: false,

  // Service
  serveClockEnabled: true,
  serveClockSecs: 8,
  jumpServeRestrictionLineM: 1.0,  // jump take-off must be behind this line

  // VCS: not supported for Light VB
  vcsEnabled: false,

  // Attack
  attackLineM: 2.0,        // 2m from center (vs 3m indoor)
  blockCountsAsTeamHit: false,  // block does NOT count as team hit (same as indoor)
  frontZoneArcRequired: true,   // unique to Light VB: attack in front zone must have upward arc

  // Court size
  courtLengthM: 12.0,
  courtWidthM: 6.0,

  // Medical
  medicalTimeoutSecs: 300,  // 5-minute recovery time
};
```

## Light Volleyball unique rules

### Front-zone attack arc (Rule 14.2.2)
Players in the front zone may attack at any height, BUT the ball's flight path must:
- Be higher than the hitting point, AND
- Have an obvious upward arc before crossing the net

This prevents spike-like flat/downward attacks from the front zone. Scorers call this fault manually. The engine records `ATTACK_ARC_FAULT` as a scored event (point to opponent, they serve).

### Jump serve restriction (Rule 10.4.4)
When taking off for a jump serve, both feet must be behind the restriction line (1m behind end line). After take-off, the player may land anywhere. The scorer records `JUMP_SERVE_FOOT_FAULT` event.

### Block does NOT count as team hit (Rule 15.4.1)
After a block, the team still has 3 hits available. Same as indoor volleyball (different from beach).

### 4-player vs 5-player formats

The format is set at the **competition level** — all matches in a competition use the same format. It cannot change mid-competition.

**4-player rotation (Diagram 2):**
```
NET
  3 | 2      (front row: left, right)
  4 | 1      (back row: left, right — position 1 = server)
```

Player positions:
- Position 1: back-right (server)
- Position 2: front-right
- Position 3: front-left
- Position 4: back-left

Position relationships (Rule 8.4.3):
- Each front-row player must be closer to the net than the corresponding back-row player
- Within same row: left player must be closer to left sideline than right player

**5-player rotation (Diagram 3):**
```
NET
  4 | 3 | 2     (front row: left, center, right)
  5 |   | 1     (back row: left, right — position 1 = server)
```

Player positions:
- Position 1: back-right (server)
- Position 2: front-right
- Position 3: front-center
- Position 4: front-left
- Position 5: back-left

Note: In 5-player, the front-center player (position 3) has no positional constraint relative to back-row players (Rule 8.4.3.1).

### Set intervals
- After set 1: 2-minute interval
- Before deciding set 3: 3-minute interval

### Court change
- After set 1: teams change ends
- In deciding set: change when leading team reaches 8 pts
- No mid-set side switches

## Event payload types

```ts
export type LightEventPayload =
  | { type: "MATCH_CREATED"; matchId: string }
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side }
  | { type: "MATCH_START" }
  | {
      type: "LINEUP_CONFIRMED";
      setNumber: SetNumber;
      // Player IDs in rotation order; length must equal playersPerSide
      teamAPlayerIds: string[];
      teamBPlayerIds: string[];
    }
  | { type: "SET_START"; setNumber: SetNumber; firstServer: TeamId; teamAStartSide: Side }
  | { type: "RALLY_WON_A" }
  | { type: "RALLY_WON_B" }
  | { type: "REPLAY_POINT" }
  | { type: "TIMEOUT_REQUEST"; team: TeamId }
  | { type: "TIMEOUT_END"; team: TeamId }
  | { type: "SIDE_SWITCH"; newTeamASide: Side }    // auto-emitted at deciding set 8 pts
  | {
      type: "SUBSTITUTION";
      team: TeamId;
      outPlayerId: string;
      inPlayerId: string;
      isEmergency?: boolean;
    }
  | { type: "SET_END"; winner: TeamId; scoreA: number; scoreB: number; setNumber: SetNumber }
  | { type: "MATCH_END"; winner: TeamId; setsA: number; setsB: number }
  | { type: "SERVE_CLOCK_EXPIRE" }
  | { type: "DELAY_WARNING"; team: TeamId }
  | { type: "DELAY_PENALTY"; team: TeamId }
  | { type: "JUMP_SERVE_FOOT_FAULT"; team: TeamId }    // scored: point + serve to opponent
  | { type: "ATTACK_ARC_FAULT"; team: TeamId }         // scored: point + serve to opponent
  | { type: "MEDICAL_TIMEOUT"; team: TeamId }
  | { type: "MEDICAL_TIMEOUT_END" }
  | { type: "MISCONDUCT_WARNING"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_PENALTY"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_EXPULSION"; team: TeamId; playerId: string }
  | { type: "MISCONDUCT_DISQUALIFICATION"; team: TeamId; playerId: string }
  | { type: "UNDO"; targetEventId: string }
  | { type: "NOTE"; text: string };
```

## State shape

```ts
export interface LightSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  teamAStartSide: Side;
  teamASide: Side;
  firstServer: TeamId;
  currentServer: TeamId;

  lineupA: string[];           // player IDs in rotation order (length = playersPerSide)
  lineupB: string[];
  lineupConfirmed: boolean;

  rotationIndexA: number;      // 0 to playersPerSide-1
  rotationIndexB: number;
  lastRotA: number | null;
  lastRotB: number | null;

  timeoutsUsedA: number;
  timeoutsUsedB: number;
  subsUsedA: number;
  subsUsedB: number;

  delaySanctionsA: number;
  delaySanctionsB: number;

  winner: TeamId | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface LightMatchState {
  matchId: string;
  playersPerSide: 4 | 5;         // from competition config
  status: "SETUP" | "COIN_TOSS" | "READY" | "LIVE" | "FINISHED";
  rallyPhase: LightRallyPhase;
  currentSetNumber: SetNumber;
  sets: LightSetState[];
  setsWonA: number;
  setsWonB: number;
  winner: TeamId | null;
  activeTimeoutTeam: TeamId | null;
  matchStartedAt: string | null;
  lastSequence: number;

  misconductA: MisconductRecord[];
  misconductB: MisconductRecord[];
}

export type LightRallyPhase =
  | "IDLE"
  | "LINEUP_PENDING"
  | "BETWEEN_RALLIES"
  | "RALLY_LIVE"
  | "TIMEOUT_ACTIVE"
  | "MEDICAL_TIMEOUT_ACTIVE"
  | "SET_BREAK"
  | "MATCH_OVER";
```

## Rotation logic

Same clockwise rotation as indoor. On side-out:
```ts
const n = state.playersPerSide;  // 4 or 5
const nextRot = lastRot === null ? 0 : (lastRot + 1) % n;
// Player at lineup[nextRot] serves next
```

## Auto-emit after RALLY_WON

1. `computeSetEnd(set, config)` — if set won
2. `computeDecidingSetSideSwitch(set, config)` — if set 3 and leading team just reached 8

## Validation rules specific to Light VB

```ts
// SUBSTITUTION
if (subsUsed >= config.maxSubsPerSet) {
  // 4-player: max 4; 5-player: max 5
  return { ok: false, reason: "Substitution limit reached" };
}

// JUMP_SERVE_FOOT_FAULT and ATTACK_ARC_FAULT
// These are referee-called faults recorded by the scorer
// Always valid to record (scorer judgment)
// Effect: point + serve to the opponent team
```

## Unit tests required

```
✓ 4-player rotation: side-out advances rotation index (0→1→2→3→0)
✓ 5-player rotation: side-out advances rotation index (0→1→2→3→4→0)
✓ set won at 21 with 2-point lead
✓ deciding set won at 15 with 2-point lead
✓ no mid-set side switch (unlike beach)
✓ deciding set: side switch auto-emitted when leading team reaches 8
✓ deciding set: side switch noticed late → fires at discovery (score unchanged)
✓ substitution limit: 4 for 4-player, 5 for 5-player
✓ emergency sub not counted toward limit
✓ timeout limit: 2 per set
✓ JUMP_SERVE_FOOT_FAULT scores point to opponent and gives them serve
✓ ATTACK_ARC_FAULT scores point to opponent and gives them serve
✓ UNDO restores previous state correctly
✓ replayEvents = incremental reduce
✓ lineup confirmation required before first rally
✓ rotation fault: points cancelled from fault moment
```
