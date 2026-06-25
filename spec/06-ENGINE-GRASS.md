# 06 — Grass Volleyball Engine

Rules source: FIVB Beach Volleyball Rules base (adapted for 3v3 / 4v4 on grass)

## Key rule constants (defaults, all configurable)

```ts
const GRASS_DEFAULTS = {
  bestOf: 3,
  setScore: 21,
  setScoreTiebreak: 15,
  twoPointLead: true,
  sideSwitchEnabled: true,
  sideSwitchEvery: 7,
  sideSwitchTiebreakEvery: 5,
  ttoEnabled: false,
  timeoutsPerSet: 2,
  timeoutDurationSecs: 30,
  maxSubsPerSet: 4,
  playersPerSide: 3,          // default; 4-player also supported
  rotationEnabled: true,
  lineupRequired: true,
  serverPlayerRequired: true,
  liberoEnabled: false,
  serveClockEnabled: true,
  serveClockSecs: 5,
  vcsEnabled: false,
  blockCountsAsTeamHit: true,  // follows beach rule
  medicalTimeoutSecs: 300,
};
```

## Differences from Beach engine

Grass volleyball extends the beach engine with:

1. **More players per side** (3 or 4)
2. **Full rotation** — unlike beach, players rotate clockwise on side-out
3. **Lineup confirmation** — before first rally of each set, submit 3 or 4 players in rotation order
4. **Substitutions** — up to 4 per set (each sub pair uses one slot, same rule as indoor)
5. **Side switches** — same beach logic (every 7 pts / every 5 pts in set 3)

## Event payload types

Reuses most of the beach types with these additions:

```ts
// Additional events (added to beach base types)
| {
    type: "LINEUP_CONFIRMED";
    setNumber: SetNumber;
    teamAPlayerIds: string[];  // in rotation order (pos 1 = server first)
    teamBPlayerIds: string[];
  }
| {
    type: "SUBSTITUTION";
    team: TeamId;
    outPlayerId: string;
    inPlayerId: string;
    isEmergency?: boolean;
  }
```

## State shape

```ts
export interface GrassSetState {
  setNumber: SetNumber;
  scoreA: number;
  scoreB: number;
  teamAStartSide: Side;
  teamASide: Side;
  firstServer: TeamId;
  currentServer: TeamId;

  // Rotation (3 or 4 players)
  lineupA: string[];       // [pos1, pos2, pos3 (, pos4)] in rotation order
  lineupB: string[];
  lineupConfirmed: boolean;
  rotationIndexA: number;  // current rotation (0 to playersPerSide-1)
  rotationIndexB: number;
  lastRotA: number | null; // last rotation index when team A served (null = not yet)
  lastRotB: number | null;

  timeoutsUsedA: number;
  timeoutsUsedB: number;
  subsUsedA: number;
  subsUsedB: number;

  winner: TeamId | null;
  startedAt: string | null;
  endedAt: string | null;
}
```

## Rotation logic

On side-out (receiving team wins rally):
```ts
const n = config.playersPerSide;  // 3 or 4
const nextRot = lastRot === null ? 0 : (lastRot + 1) % n;
// player at nextRot index in lineup serves next
```

On consecutive rally wins (same team keeps serve): no rotation.

Side switches fire at same thresholds as beach (7 pts / 5 pts).

## Roster configuration

**3-player format:**
```
Position diagram:
   2  |  3       (front row)
      1           (back row, server)
```

**4-player format:**
```
Position diagram:
   3  |  4       (front row)
   2  |  1       (back row; pos 1 = server back-right)
```

The `playersPerSide` config field determines which diagram is used. The UI renders the correct court layout.

## Unit tests required

```
✓ rally scoring increments correct team
✓ side-out triggers rotation (3-player)
✓ side-out triggers rotation (4-player)
✓ rotation wraps correctly (pos 3 → pos 1 for 3-player)
✓ side switch fires at sum=7 and 14 (sets 1 & 2)
✓ side switch fires at sum=5 and 10 (set 3)
✓ lineup confirmation required before first rally
✓ substitution limit enforced (4/set)
✓ emergency substitution not counted toward limit
✓ set won at 21/15 with 2-point lead
✓ UNDO removes event and recomputes state
✓ replayEvents identical to incremental reduce
```
