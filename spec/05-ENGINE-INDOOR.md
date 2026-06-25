# 05 — Indoor Volleyball Engine

Rules source: FIVB Official Volleyball Rules 2025-2028

## Key rule constants (defaults, all configurable)

```ts
const INDOOR_DEFAULTS = {
  bestOf: 5,
  setScore: 25,           // sets 1–4
  setScoreTiebreak: 15,   // set 5
  twoPointLead: true,
  sideSwitchBetweenSetsOnly: true,  // no mid-set switches
  sideSwitchDecidingSetAt: 8,       // change courts at 8 pts in set 5
  ttoEnabled: false,
  timeoutsPerSet: 2,
  timeoutDurationSecs: 30,
  maxSubsPerSet: 6,
  playersPerSide: 6,
  rotationEnabled: true,
  lineupRequired: true,
  serverPlayerRequired: true,
  liberoEnabled: true,
  liberoCount: 1,           // can be 2
  serveClockEnabled: true,
  serveClockSecs: 8,
  vcsEnabled: false,        // on/off per competition
  vcsChallengesPerSet: 2,
  blockCountsAsTeamHit: false,  // indoor: block does NOT count as team hit
  attackLineM: 3.0,
  backRowAttackEnabled: true,
  medicalTimeoutSecs: 180,    // 3-minute recovery time
};
```

## Indoor-specific rules

### Positions (Rule 7.4)
6 positions clockwise from back-right:
```
Position diagram:
  4  |  3  |  2      (front row: left, center, right)
  5  |  6  |  1      (back row: left, center, right)
```
Position 1 = back-right = server. On side-out, players rotate one clockwise: 1→6→5→4→3→2→1.

### Rotation fault (Rule 7.7)
- Server must be the player in position 1
- Receiving team must be in their registered positions at moment of service hit
- Scorer detects rotational fault immediately after service hit

### Back-row attack (Rule 13.2.2)
- Back-row player may spike only from behind the attack line (3m from center)
- At take-off, foot must not touch or cross the attack line
- If entirely in front zone, ball must be below top of net to be a legal attack

### Libero (Rule 19)
- Designated defensive specialist; maximum 2 per team (1 active at a time)
- Wears contrasting jersey color
- Can replace any back-row player — unlimited replacements (at least 1 rally between)
- **CANNOT**: serve, block (or attempt block), attack if ball entirely above net height
- **CANNOT**: set with overhand finger pass from front zone if teammate attacks from above net height
- Libero replacements are NOT substitutions (don't count toward the 6/set limit)
- Replacement zone: free zone on bench side, between attack line and end line extension

### Libero state in IndoorSetState
```ts
interface LiberoState {
  // Libero players for this set (resolved from LINEUP_CONFIRMED + LIBERO_DESIGNATION)
  liberoIdA: string | null;   // acting libero for team A
  liberoIdB: string | null;
  secondLiberoIdA: string | null;  // second libero if designated
  secondLiberoIdB: string | null;

  // Who the libero is currently replacing (back-row player who stepped off)
  liberoReplacingA: string | null;  // playerId who left court for libero
  liberoReplacingB: string | null;

  // Libero on court?
  liberoOnCourtA: boolean;
  liberoOnCourtB: boolean;

  // Replacements must have a completed rally between them
  lastLiberoRallyA: number;  // sequence of last rally after libero was on court
  lastLiberoRallyB: number;
}
```

### Substitution limitations (Rule 15.6)
- A starting player may leave once and re-enter once per set, only to original position
- A substitute may enter once per set, only in place of the same starting player
- Each sub pair (starter ↔ sub) is a "slot" — once used both ways, exhausted
- Maximum 6 total substitutions per set
- Two or more players may sub simultaneously in one request (counts as one request, multiple slots)

### VCS (Video Challenge System, Rule 25)
- 2 challenges per set per team
- Successful challenge (ruling overturned): keep the challenge
- Unsuccessful challenge: lose the challenge
- Deciding set (5th): 1 challenge per team per set
- Challenges can be used between rallies only

```ts
// VCS state per set
interface VCSState {
  challengesRemainingA: number;
  challengesRemainingB: number;
  activeChallenge: { team: TeamId; requestSeq: number } | null;
}
```

### Court change (Rule 18.2)
- After each set (sets 1-4): teams change ends; no mid-set switches
- Deciding 5th set: change courts when leading team reaches 8 points
- Scorer auto-emits SIDE_SWITCH event when leading team reaches 8 in set 5

## Event payload types

```ts
export type IndoorEventPayload =
  | { type: "MATCH_CREATED"; matchId: string }
  | { type: "COIN_TOSS"; firstServer: TeamId; teamAStartSide: Side }
  | { type: "MATCH_START" }
  | {
      type: "LINEUP_CONFIRMED";
      team: TeamId;
      setNumber: SetNumber;
      // Player IDs in rotation order: position 1 first (server), then 2, 3, 4, 5, 6
      playerIds: string[];
      liberoId: string | null;
      secondLiberoId: string | null;
    }
  | { type: "SET_START"; setNumber: SetNumber; firstServer: TeamId; teamAStartSide: Side }
  | { type: "RALLY_WON_A" }
  | { type: "RALLY_WON_B" }
  | { type: "REPLAY_POINT" }
  | { type: "TIMEOUT_REQUEST"; team: TeamId }
  | { type: "TIMEOUT_END"; team: TeamId }
  | { type: "SIDE_SWITCH"; newTeamASide: Side }
  | {
      type: "SUBSTITUTION";
      team: TeamId;
      outPlayerId: string;
      inPlayerId: string;
      isExceptional?: boolean;  // injury substitution, doesn't count toward limit
    }
  | {
      type: "LIBERO_REPLACEMENT";
      team: TeamId;
      liberoId: string;
      // Direction: LIBERO_IN = libero enters for outPlayerId; LIBERO_OUT = outPlayerId returns
      direction: "IN" | "OUT";
      outPlayerId: string;
    }
  | { type: "LIBERO_REDESIGNATION"; team: TeamId; newLiberoId: string }
  | { type: "SET_END"; winner: TeamId; scoreA: number; scoreB: number; setNumber: SetNumber }
  | { type: "MATCH_END"; winner: TeamId; setsA: number; setsB: number }
  | { type: "SERVE_CLOCK_EXPIRE" }
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
export interface IndoorSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  teamAStartSide: Side;
  teamASide: Side;
  firstServer: TeamId;
  currentServer: TeamId;

  // Rotation: current rotation index (0-5) for each team
  // Positions are always tracked relative to the *starting* lineup of the set
  // rotationIndex advances by 1 (clockwise) each time that team earns serve
  rotationIndexA: number;
  rotationIndexB: number;

  // Starting lineup for this set (after LINEUP_CONFIRMED)
  lineupA: string[];  // [pos1, pos2, pos3, pos4, pos5, pos6] player IDs
  lineupB: string[];
  lineupConfirmedA: boolean;
  lineupConfirmedB: boolean;

  // Current court positions (may differ from lineup due to subs/libero)
  // courtPositionsA[i] = playerId currently in position i+1
  courtPositionsA: string[];
  courtPositionsB: string[];

  // Substitution tracking
  timeoutsUsedA: number;
  timeoutsUsedB: number;
  subsUsedA: number;
  subsUsedB: number;
  // Sub slots: Map<startingPlayerId, substitutePlayerId | null>
  // A slot is "exhausted" if both directions have been used
  subSlotsA: Record<string, string | null>;  // starter → current sub
  subSlotsB: Record<string, string | null>;

  // Libero
  libero: LiberoState;

  // VCS
  vcs: VCSState;

  // Sanctions
  delaySanctionsA: number;
  delaySanctionsB: number;

  winner: TeamId | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface IndoorMatchState {
  matchId: string;
  status: "SETUP" | "COIN_TOSS" | "READY" | "LIVE" | "FINISHED";
  rallyPhase: IndoorRallyPhase;
  currentSetNumber: SetNumber;
  sets: IndoorSetState[];
  setsWonA: number;
  setsWonB: number;
  winner: TeamId | null;
  activeTimeoutTeam: TeamId | null;
  matchStartedAt: string | null;
  lastSequence: number;

  // Cross-set substitution totals
  totalMatchSubsA: number;
  totalMatchSubsB: number;

  misconductA: MisconductRecord[];
  misconductB: MisconductRecord[];
}

export type IndoorRallyPhase =
  | "IDLE"
  | "LINEUP_PENDING"     // awaiting LINEUP_CONFIRMED from both teams
  | "BETWEEN_RALLIES"
  | "RALLY_LIVE"
  | "TIMEOUT_ACTIVE"
  | "MEDICAL_TIMEOUT_ACTIVE"
  | "VCS_ACTIVE"
  | "SET_BREAK"
  | "MATCH_OVER";
```

## Reducer: key logic

### RALLY_WON_A / RALLY_WON_B

On side-out (receiving team wins rally):
1. Receiving team gains serve
2. Receiving team rotates clockwise: `rotationIndex = (rotationIndex + 1) % 6`
3. New server = player now in position 1 (back-right) after rotation

```ts
function nextServerAfterRotation(lineup: string[], rotation: number): string {
  // After rotate: position 1 player is at index (rotation % 6) in the original lineup
  const newPos1Index = rotation % 6;
  return lineup[newPos1Index];
}
```

### SUBSTITUTION

Validation:
- `subsUsedA/B < maxSubsPerSet`
- `outPlayerId` is currently on court
- `inPlayerId` is not on court and is a valid sub for the out player's slot
- Cannot sub for Libero (use LIBERO_REPLACEMENT instead)

State update:
- Swap player in `courtPositionsA/B`
- Increment `subsUsedA/B`
- Update `subSlotsA/B`

### LIBERO_REPLACEMENT

Validation:
- `liberoId` is the designated libero for this team
- At least 1 rally must have completed since last libero replacement for this team
- Libero cannot enter front zone if it would put them in a front-row position at service

State update:
- Swap libero in/out of `courtPositionsA/B`
- Update `libero.liberoOnCourtA/B` and `libero.liberoReplacingA/B`
- Record `lastLiberoRallyA/B`

### Auto-emit after RALLY_WON

1. `computeSetEnd(set, config)` — if 25+ (or 15+ in set 5) with 2-pt lead
2. `computeSideSwitchDecidingSet(set, config)` — if set 5 and leading team just reached 8

No mid-set side switches for indoor (only between sets, handled at SET_END → SET_START).

## Lineup entry flow

Before the first rally of each set:
1. `rallyPhase` = `"LINEUP_PENDING"` after SET_START
2. Both team tablets (or scorer) submit lineup via `LINEUP_CONFIRMED` event (one per team)
3. Once both teams have confirmed, `rallyPhase` → `"BETWEEN_RALLIES"`
4. If `lineupRequired = false` in config, LINEUP_PENDING is skipped

## Unit tests required

```
✓ rally scoring increments correct team
✓ side-out triggers rotation (rotationIndex advances)
✓ server after rotation is correct player in position 1
✓ positional fault detected when wrong player serves
✓ rotational fault detected and points cancelled back to fault moment
✓ set won at 25 with 2-point lead; deciding set at 15
✓ match won at 3 sets (or 2 sets won for best-of-3 config)
✓ timeout limit enforced (2/set)
✓ substitution limit enforced (6/set)
✓ sub slot exhausted after both directions used
✓ libero replacement: cannot happen twice without rally between
✓ libero cannot serve, block, or attack from above net
✓ libero replacement does NOT count as substitution
✓ libero overhand front-zone pass restricts teammate attack
✓ back-row player attack from front zone with ball above net = fault
✓ VCS: successful challenge retains challenge count
✓ VCS: unsuccessful challenge decrements count
✓ deciding set court change auto-emitted at 8 pts for leading team
✓ court change happens when noticed if missed at 8 pts
✓ UNDO removes event and recomputes state correctly
✓ replayEvents identical to incremental reduce
```
