# 13 — Seed Data (First Deployment)

Four competitions — one per discipline. Two matches each: one **finished**, one **currently live** (in progress at mid-match state).

Implemented in `src/scripts/seed.ts`. Run after first `drizzle-kit push` on the production database.

---

## Tenant

```ts
{
  id: "tenant_demo",
  slug: "demo",
  name: "FIVB Volleyball Demo",
  branding: {
    primaryColor: "#0047AB",   // FIVB blue
    secondaryColor: "#FFD700", // gold
    logoUrl: null,
  }
}
```

---

## Competition 1 — Beach Volleyball

```ts
{
  id: "comp_beach",
  tenantId: "tenant_demo",
  name: "Beach Pro Tour — Lausanne",
  discipline: "BEACH",
  gender: "MIXED",
  startDate: "2026-07-10",
  endDate: "2026-07-12",
  venue: "Place de la Navigation, Lausanne",
  status: "ACTIVE",
  config: {
    // all defaults (TTO enabled, 21/15, 7/5 switches)
    vcsEnabled: true,
  }
}
```

### Teams & players
```ts
// Team A
{ displayName: "Duda / Ana Patrícia", seed: 1 }
  players: [
    { firstName: "Duda", lastName: "Lisboa", jerseyNumber: 1 },
    { firstName: "Ana Patrícia", lastName: "Ramos", jerseyNumber: 2 },
  ]

// Team B
{ displayName: "Graudina / Kravcenoka", seed: 2 }
  players: [
    { firstName: "Tīna", lastName: "Graudiņa", jerseyNumber: 1 },
    { firstName: "Anastasija", lastName: "Kravcenoka", jerseyNumber: 2 },
  ]

// Team C
{ displayName: "Hughes / Cheng", seed: 3 }
  players: [
    { firstName: "Sarah", lastName: "Hughes", jerseyNumber: 1 },
    { firstName: "Kelly", lastName: "Cheng", jerseyNumber: 2 },
  ]

// Team D
{ displayName: "Borger / Sude", seed: 4 }
  players: [
    { firstName: "Karla", lastName: "Borger", jerseyNumber: 1 },
    { firstName: "Julia", lastName: "Sude", jerseyNumber: 2 },
  ]
```

### Match 1 (finished) — Duda/Ana vs Graudina/Kravcenoka
```
Result: Team A wins 2-0 (21-18, 21-16)
Status: FINISHED
Events seed: ~80 RALLY_WON events reproducing the exact scores,
including 1 TTO per set, 1 timeout per team per set, 1 side switch per set.
```

### Match 2 (live) — Hughes/Cheng vs Borger/Sude
```
Status: LIVE
Current state: Set 2, score 14-11, Team A serves
Events seed: Set 1 (Team A won 21-19) complete, set 2 in progress to 14-11
```

---

## Competition 2 — Indoor Volleyball

```ts
{
  id: "comp_indoor",
  tenantId: "tenant_demo",
  name: "Swiss Volleyball League — Round 5",
  discipline: "INDOOR",
  gender: "WOMEN",
  startDate: "2026-07-15",
  endDate: "2026-07-15",
  venue: "Salle omnisports de Malley, Lausanne",
  status: "ACTIVE",
  config: {
    bestOf: 5,
    liberoEnabled: true,
    liberoCount: 1,
    vcsEnabled: true,
    serveClockEnabled: true,
    serveClockSecs: 8,
    teamTabletEnabled: true,
  }
}
```

### Teams & players
```ts
// Team A — Lausanne UC
{ displayName: "Lausanne UC", clubName: "Lausanne UC", seed: 1 }
  players: [
    { firstName: "Sophie", lastName: "Müller", jerseyNumber: 2, isCaptain: true },
    { firstName: "Emma", lastName: "Dubois", jerseyNumber: 3 },
    { firstName: "Clara", lastName: "Schmid", jerseyNumber: 4 },
    { firstName: "Laura", lastName: "Mayer", jerseyNumber: 7 },
    { firstName: "Nina", lastName: "Koch", jerseyNumber: 9 },
    { firstName: "Lisa", lastName: "Weber", jerseyNumber: 11 },
    // Libero
    { firstName: "Mia", lastName: "Fischer", jerseyNumber: 1, isLibero: true },
    // Bench
    { firstName: "Julia", lastName: "Braun", jerseyNumber: 5, role: "BENCH" },
    { firstName: "Anna", lastName: "Huber", jerseyNumber: 8, role: "BENCH" },
  ]

// Team B — Volley Schönenwerd
{ displayName: "Volley Schönenwerd", clubName: "Volley Schönenwerd", seed: 2 }
  players: [
    { firstName: "Alicia", lastName: "Peng", jerseyNumber: 3, isCaptain: true },
    { firstName: "Valérie", lastName: "Gelin", jerseyNumber: 5 },
    { firstName: "Marta", lastName: "Rossi", jerseyNumber: 6 },
    { firstName: "Hannah", lastName: "Wolf", jerseyNumber: 8 },
    { firstName: "Sara", lastName: "Bauer", jerseyNumber: 10 },
    { firstName: "Lena", lastName: "Richter", jerseyNumber: 12 },
    // Libero
    { firstName: "Tanja", lastName: "Steiner", jerseyNumber: 2, isLibero: true },
    // Bench
    { firstName: "Petra", lastName: "Vogel", jerseyNumber: 4, role: "BENCH" },
    { firstName: "Monika", lastName: "Schwartz", jerseyNumber: 7, role: "BENCH" },
  ]
```

### Match 1 (finished) — Lausanne UC vs Volley Schönenwerd
```
Result: Team B wins 3-2 (25-22, 22-25, 25-21, 20-25, 15-12)
Status: FINISHED
Events seed: Full 5-set match including:
  - LINEUP_CONFIRMED for both teams at each set start
  - 2 timeouts per team per set
  - 3-4 substitutions per team per set
  - 2-3 libero replacements per set
  - 1 VCS challenge (Team A, set 3, result: DENIED)
  - Side switch after each set; set 5 switch at score 8
```

### Match 2 (live) — Same teams, rematch
```
Status: LIVE
Current state: Set 3 (of 5), score 12-14, Team B leads
Lineups confirmed for sets 1-3
Set 1: Team A won 25-22
Set 2: Team B won 25-23
Set 3 in progress at 12-14
```

---

## Competition 3 — Grass Volleyball

```ts
{
  id: "comp_grass",
  tenantId: "tenant_demo",
  name: "Lausanne Grass Open",
  discipline: "GRASS",
  gender: "MIXED",
  startDate: "2026-07-20",
  endDate: "2026-07-21",
  venue: "Parc de l'Élysée, Lausanne",
  status: "ACTIVE",
  config: {
    playersPerSide: 3,
    maxSubsPerSet: 4,
    timeoutsPerSet: 2,
  }
}
```

### Teams & players
```ts
// Team A
{ displayName: "Lausanne Rockets", seed: 1 }
  players: [
    { firstName: "Marc", lastName: "Dupont", jerseyNumber: 1, isCaptain: true },
    { firstName: "Stéphane", lastName: "Blanc", jerseyNumber: 2 },
    { firstName: "Pierre", lastName: "Noir", jerseyNumber: 3 },
    { firstName: "Thomas", lastName: "Gris", jerseyNumber: 4, role: "BENCH" },
  ]

// Team B
{ displayName: "Geneva Smashers", seed: 2 }
  players: [
    { firstName: "Lucas", lastName: "Martin", jerseyNumber: 1, isCaptain: true },
    { firstName: "Antoine", lastName: "Bernard", jerseyNumber: 2 },
    { firstName: "Kevin", lastName: "Petit", jerseyNumber: 3 },
    { firstName: "Julien", lastName: "Grand", jerseyNumber: 4, role: "BENCH" },
  ]

// Teams C & D for second match
{ displayName: "Bern Eagles", seed: 3 }
{ displayName: "Zurich Thunder", seed: 4 }
  // 3 players + 1 bench each
```

### Match 1 (finished) — Lausanne Rockets vs Geneva Smashers
```
Result: Team A wins 2-1 (21-18, 19-21, 15-11)
Status: FINISHED
```

### Match 2 (live) — Bern Eagles vs Zurich Thunder
```
Status: LIVE
Current state: Set 2, score 9-11, Team B serves
Set 1: Team A won 21-17
Set 2 in progress
```

---

## Competition 4 — Light Volleyball

```ts
{
  id: "comp_light",
  tenantId: "tenant_demo",
  name: "Light Volleyball Masters — Vevey",
  discipline: "LIGHT",
  gender: "MIXED",
  startDate: "2026-07-25",
  endDate: "2026-07-26",
  venue: "Salle des fêtes de Vevey",
  status: "ACTIVE",
  config: {
    playersPerSide: 4,      // 4-player format
    maxSubsPerSet: 4,
    frontZoneArcRequired: true,
    jumpServeRestrictionLineM: 1.0,
    attackLineM: 2.0,
    blockCountsAsTeamHit: false,
  }
}
```

### Teams & players
```ts
// Team A
{ displayName: "Vevey Masters", seed: 1 }
  players: [
    { firstName: "Paul", lastName: "Lemaire", jerseyNumber: 1, isCaptain: true },
    { firstName: "Jean", lastName: "Fontaine", jerseyNumber: 2 },
    { firstName: "René", lastName: "Leclerc", jerseyNumber: 3 },
    { firstName: "Michel", lastName: "Rousseau", jerseyNumber: 4 },
    { firstName: "André", lastName: "Moreau", jerseyNumber: 5, role: "BENCH" },
  ]

// Team B
{ displayName: "Montreux Seniors", seed: 2 }
  players: [
    { firstName: "François", lastName: "Simon", jerseyNumber: 1, isCaptain: true },
    { firstName: "Jacques", lastName: "Girard", jerseyNumber: 2 },
    { firstName: "Henri", lastName: "Roux", jerseyNumber: 3 },
    { firstName: "Georges", lastName: "Lefort", jerseyNumber: 4 },
    { firstName: "Claude", lastName: "Durand", jerseyNumber: 5, role: "BENCH" },
  ]

// Teams C & D for second match
{ displayName: "Lausanne Vets", seed: 3 }
{ displayName: "Bienne Classics", seed: 4 }
  // 4 players + 1 bench each
```

### Match 1 (finished) — Vevey Masters vs Montreux Seniors
```
Result: Team A wins 2-0 (21-17, 21-14)
Status: FINISHED
Events seed: both sets complete with:
  - LINEUP_CONFIRMED at each set start (4-player rotation)
  - 1 timeout per team per set
  - 2 substitutions per team
  - Court change after set 1
```

### Match 2 (live) — Lausanne Vets vs Bienne Classics
```
Status: LIVE
Current state: Set 1, score 8-6, Team A serves
Set 1 in progress — lineups confirmed
```

---

## Seed script structure

```ts
// src/scripts/seed.ts

import { db } from "@/db";
import { tenants, competitions, teams, players, matches, events } from "@/db/schema";

async function seed() {
  await seedTenant();
  await seedBeach();
  await seedIndoor();
  await seedGrass();
  await seedLight();
  console.log("✓ Seed complete");
}

seed().catch(console.error);
```

Run with: `npx tsx src/scripts/seed.ts`

The seed script uses `replayEvents()` to verify that all seeded events produce the expected state before inserting them — this validates both the seed data and the engine simultaneously.
