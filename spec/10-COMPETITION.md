# 10 — Competition & Tournament Management

## Data model

```
Tenant
  └── Competition (discipline, dates, venue)
        ├── TournamentConfig (rules overrides)
        ├── Teams[]
        │     └── Players[]
        ├── Pools[] (optional)
        │     └── Pool → teams[], matches[]
        └── Matches[]
              └── Events[] (append-only)
```

## Competition lifecycle

```
DRAFT → ACTIVE → FINISHED
```

- **DRAFT**: admin can edit everything (teams, schedule, config)
- **ACTIVE**: matches can be played; teams and schedule locked (minor edits allowed)
- **FINISHED**: read-only; results exportable

## Pool play (round robin)

Each competition can have multiple pools. Pools are created by the admin and teams are assigned manually or automatically (by seed).

**Pool standings columns:**
| Column | Value |
|--------|-------|
| MP | Matches played |
| W | Wins |
| L | Losses |
| SW | Sets won |
| SL | Sets lost |
| SR | Set ratio (SW/SL) |
| PW | Points won |
| PL | Points lost |
| PR | Point ratio (PW/PL) |

Tiebreaker order: W → SR → PR → head-to-head result.

**Standing computation** (server-side, on-the-fly):
```ts
async function computePoolStandings(poolId: string) {
  const matches = await db.query.matches.findMany({
    where: and(
      eq(matches.poolId, poolId),
      eq(matches.status, "FINISHED")
    ),
  });
  // aggregate per team
}
```

## Knockout brackets

After pool play, teams advance to knockout rounds. Bracket generation:

```ts
type BracketFormat = 
  | "SINGLE_ELIMINATION"
  | "DOUBLE_ELIMINATION"
  | "SINGLE_ELIMINATION_3RD_PLACE";
```

Bracket advancement is automatic: when a match finishes, the winner is placed in the next round match automatically (updates `matches.teamAId` or `matches.teamBId`).

## Match scheduling

```ts
interface MatchSlot {
  matchId: string;
  courtNumber: number;
  scheduledAt: Date;
}
```

Admin assigns court + time per match. No automatic scheduling — manual drag-drop interface (future enhancement; v1 = form-based).

## CSV import format

### Teams import (`teams.csv`)
```csv
displayName,countryCode,clubName,seed
"Brazil",BRA,,1
"Poland",POL,,2
```

### Players import (`players.csv`)
```csv
teamDisplayName,firstName,lastName,jerseyNumber,isCaptain,isLibero
"Brazil",Gabi,Guimarães,10,true,false
"Brazil",Ana,Patrícia,13,false,false
```

### Schedule import (`schedule.csv`)
```csv
matchNumber,teamA,teamB,courtNumber,scheduledAt,roundName
1,Brazil,Poland,1,2026-07-10T10:00:00Z,Pool A
2,Italy,France,2,2026-07-10T10:00:00Z,Pool A
```

### Results import (`results.csv`)
For importing historical/completed matches without live scoring:
```csv
matchNumber,setsWonA,setsWonB,setScores
1,3,1,"25-20,23-25,25-18,25-22"
```

## Admin pages

### `/t/[slug]/competitions` — Competition list
- Filter by discipline, status
- Create new competition (discipline, dates, bestOf, set score)
- Archive/export

### `/t/[slug]/competitions/[id]` — Competition detail
- Tabs: Overview | Teams | Schedule | Standings | Results
- Config panel: toggle any `tournament_config` field on/off

### `/t/[slug]/competitions/[id]/teams` — Team & player management
- Add/edit/delete teams
- Add/edit/delete players per team
- Assign seeds
- CSV import

### `/t/[slug]/competitions/[id]/schedule` — Match schedule
- View as list or grid (by court / by time)
- Assign courts and times
- Create match: pick Team A, Team B, court, time
- Generate round-robin fixtures automatically (admin button)

### `/t/[slug]/competitions/[id]/matches/[id]` — Match detail
- Status, result, event log
- [Open Scorer] — launches live scoring page
- [Generate QR for Team A] / [Generate QR for Team B] — team tablet tokens
- [Export PDF] — match report
- [View Scoreboard] — opens scoreboard display

### `/t/[slug]/competitions/[id]/standings` — Standings
- Pool standings tables
- Bracket visual (knockout rounds)

## Role-based access by page

| Page | Required role |
|------|---------------|
| Competition list | TENANT_ADMIN, COMPETITION_ADMIN |
| Competition detail / config | TENANT_ADMIN, COMPETITION_ADMIN |
| Teams / players | COMPETITION_ADMIN |
| Schedule | COMPETITION_ADMIN |
| Live scoring | SCORER |
| Team tablet | TEAM_SCORER (token) |
| Scoreboard | Public (no auth) |
| Standings | Public (no auth) |

## PDF export (match report)

Route: `GET /api/matches/[id]/export.pdf`
```
runtime = "nodejs"  // required for PDFKit
```

**Page 1 — Match header:**
- Tenant logo (top-left)
- Competition name, discipline, round, court
- Date and start/end time
- Team A vs Team B
- Final result: Sets 3-1, match duration

**Page 2 — Set-by-set scoring (points run):**
For each set: running score table showing each rally point (similar to official score sheet)
Team A points in left column, Team B points in right column

**Page 3 — Game interruptions log:**
- Timeouts (team, score at time, duration)
- Substitutions (player out, player in, score at time)
- Libero replacements (indoor)
- TTO (score, set)
- VCS challenges (outcome)
- Sanctions (type, player, score)

**Page 4 — Summary:**
- Set scores
- Service aces per set (count of events)
- Match duration

## Competition statistics dashboard

Server-side aggregates from events table. Updated on match FINISH:
- Matches played, sets played
- Longest rally (tracked via NOTE or dedicated event)
- Distribution of set scores

No per-player stats (per product owner decision).
