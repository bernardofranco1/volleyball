# 11 — Configuration Reference

All settings live in `tournament_config`. Null = use discipline default.

## Discipline defaults

```ts
const DISCIPLINE_DEFAULTS: Record<Discipline, Partial<TournamentConfig>> = {

  BEACH: {
    bestOf: 3,
    setScore: 21,
    setScoreTiebreak: 15,
    sideSwitchEnabled: true,
    sideSwitchEvery: 7,
    sideSwitchTiebreakEvery: 5,
    sideSwitchBetweenSetsOnly: false,
    ttoEnabled: true,             // toggle off for non-official competitions
    ttoTriggerScore: 21,
    timeoutsPerSet: 1,
    timeoutDurationSecs: 30,
    maxSubsPerSet: 0,
    playersPerSide: 2,
    rotationEnabled: false,
    serverPlayerRequired: true,   // track who of the 2 players serves
    lineupRequired: false,
    liberoEnabled: false,
    liberoCount: 0,
    serveClockEnabled: true,
    serveClockSecs: 5,
    vcsEnabled: false,
    vcsChallengesPerSet: 2,
    attackLineM: null,            // N/A (beach has no attack line)
    backRowAttackEnabled: false,  // N/A
    frontZoneArcRequired: false,
    jumpServeRestrictionLineM: null,
    blockCountsAsTeamHit: true,
    medicalTimeoutSecs: 300,
    teamTabletEnabled: false,
    allowTeamTabletDirectEntry: false,
  },

  INDOOR: {
    bestOf: 5,
    setScore: 25,
    setScoreTiebreak: 15,
    sideSwitchEnabled: true,
    sideSwitchBetweenSetsOnly: true,
    sideSwitchDecidingSetAt: 8,
    ttoEnabled: false,
    timeoutsPerSet: 2,
    timeoutDurationSecs: 30,
    maxSubsPerSet: 6,
    playersPerSide: 6,
    rotationEnabled: true,
    serverPlayerRequired: true,
    lineupRequired: true,
    liberoEnabled: true,
    liberoCount: 1,
    serveClockEnabled: true,
    serveClockSecs: 8,
    vcsEnabled: false,
    vcsChallengesPerSet: 2,
    attackLineM: 3.0,
    backRowAttackEnabled: true,
    frontZoneArcRequired: false,
    jumpServeRestrictionLineM: null,
    blockCountsAsTeamHit: false,
    medicalTimeoutSecs: 180,
    teamTabletEnabled: true,
    allowTeamTabletDirectEntry: false,
  },

  GRASS: {
    bestOf: 3,
    setScore: 21,
    setScoreTiebreak: 15,
    sideSwitchEnabled: true,
    sideSwitchEvery: 7,
    sideSwitchTiebreakEvery: 5,
    sideSwitchBetweenSetsOnly: false,
    ttoEnabled: false,
    timeoutsPerSet: 2,
    timeoutDurationSecs: 30,
    maxSubsPerSet: 4,
    playersPerSide: 3,            // 3 or 4 per competition
    rotationEnabled: true,
    serverPlayerRequired: true,
    lineupRequired: true,
    liberoEnabled: false,
    liberoCount: 0,
    serveClockEnabled: true,
    serveClockSecs: 5,
    vcsEnabled: false,
    attackLineM: null,
    backRowAttackEnabled: false,  // N/A for 3/4-player
    frontZoneArcRequired: false,
    jumpServeRestrictionLineM: null,
    blockCountsAsTeamHit: true,
    medicalTimeoutSecs: 300,
    teamTabletEnabled: false,
    allowTeamTabletDirectEntry: false,
  },

  LIGHT: {
    bestOf: 3,
    setScore: 21,
    setScoreTiebreak: 15,
    sideSwitchEnabled: true,
    sideSwitchBetweenSetsOnly: true,
    sideSwitchDecidingSetAt: 8,
    ttoEnabled: false,
    timeoutsPerSet: 2,
    timeoutDurationSecs: 30,
    maxSubsPerSet: 4,             // 4 for 4-player; 5 for 5-player
    playersPerSide: 4,            // 4 or 5 per competition
    rotationEnabled: true,
    serverPlayerRequired: true,
    lineupRequired: true,
    liberoEnabled: false,
    liberoCount: 0,
    serveClockEnabled: true,
    serveClockSecs: 8,
    vcsEnabled: false,
    attackLineM: 2.0,
    backRowAttackEnabled: true,   // back-row can attack from behind 2m line
    frontZoneArcRequired: true,   // unique to Light VB
    jumpServeRestrictionLineM: 1.0,
    blockCountsAsTeamHit: false,
    medicalTimeoutSecs: 300,
    teamTabletEnabled: false,
    allowTeamTabletDirectEntry: false,
  },
};
```

## Config resolution

When the engine needs a config value, it merges `tournament_config` (DB row, may have nulls) over `DISCIPLINE_DEFAULTS[discipline]`:

```ts
function resolveConfig(discipline: Discipline, dbConfig: Partial<TournamentConfig>): TournamentConfig {
  return { ...DISCIPLINE_DEFAULTS[discipline], ...Object.fromEntries(
    Object.entries(dbConfig).filter(([, v]) => v !== null)
  )};
}
```

## Per-competition editable fields (admin UI)

Grouped into sections in the competition settings panel:

### Scoring
- Best of: [3] / [5]
- Set score: number input (default 21 or 25)
- Tiebreak score: number input (default 15)

### Side switches
- Side switch enabled: toggle
- Interval (pts): number input [7]
- Tiebreak interval: number input [5]
- Between sets only: toggle (indoor/light auto-on)

### Time-outs & TTO
- Timeouts per set: number input
- Timeout duration: number input (seconds)
- TTO enabled: toggle (beach only shown)
- TTO trigger score: number input [21]

### Substitutions
- Subs per set: number input [0 / 4 / 5 / 6]
- Players per side: number input [2 / 3 / 4 / 5 / 6]

### Rotation & lineup
- Rotation enabled: toggle
- Lineup required: toggle (if rotation off, lineup can also be off)
- Track server player: toggle

### Libero (indoor only)
- Libero enabled: toggle
- Number of liberos: [1] / [2]

### Service
- Serve clock enabled: toggle
- Serve clock seconds: number input [5] / [8]
- Jump serve restriction line (m): number input (Light VB)

### Video Challenge
- VCS enabled: toggle
- Challenges per set: number input [2]

### Attack rules
- Attack line (m): number input [2.0 / 3.0]
- Back-row attack enabled: toggle
- Front-zone arc required: toggle (Light VB)
- Block counts as team hit: toggle

### Team tablets
- Team tablets enabled: toggle
- Auto-approve team requests: toggle

## Configuring for specific competition scenarios

### Club training session (relaxed rules)
```
rotationEnabled: false
lineupRequired: false
serverPlayerRequired: false
ttoEnabled: false
serveClockEnabled: false
vcsEnabled: false
```

### FIVB Beach official competition
```
ttoEnabled: true
ttoTriggerScore: 21
vcsEnabled: true
vcsChallengesPerSet: 2
serveClockSecs: 5
teamTabletEnabled: false
```

### Indoor national championship
```
bestOf: 5
liberoEnabled: true
liberoCount: 2
vcsEnabled: true
serveClockEnabled: true
serveClockSecs: 8
teamTabletEnabled: true
allowTeamTabletDirectEntry: false
```

### Light Volleyball 5-player format
```
playersPerSide: 5
maxSubsPerSet: 5
frontZoneArcRequired: true
jumpServeRestrictionLineM: 1.0
attackLineM: 2.0
blockCountsAsTeamHit: false
sideSwitchBetweenSetsOnly: true
```
