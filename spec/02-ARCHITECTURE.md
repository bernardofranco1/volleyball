# 02 — Architecture

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js 16 App Router | React 19, TypeScript strict |
| Styling | Tailwind CSS v4 | CSS-first config, no tailwind.config.js |
| ORM | Drizzle ORM | Type-safe, SQL-first |
| Database | Neon PostgreSQL | Serverless, Vercel-native integration |
| Auth | Clerk | Multi-tenant, org/team support built in |
| Real-time | Pusher Channels | Managed WebSockets, generous free tier |
| Testing | Vitest | Unit tests for all engine logic |
| PDF | PDFKit | Route with `runtime = "nodejs"` |
| i18n | Custom `useT()` hook | JSON locale files, no heavy library |
| Deployment | Vercel | Edge-compatible routes where possible |

## Event-sourcing pattern

All match state is derived by replaying an append-only event log. **No mutable match state is stored** — only events. State is cached in memory on the server between requests.

```
events[] ──replay──► MatchState
                        │
                        ▼
                   validateEvent(payload, state) → {ok, reason}
                        │
                      ok │
                        ▼
                   reduce(state, event) → newState
                        │
                        ▼
                   persist event + update matches.setsWonA/B/status
```

### Key rules
- `reduce(state, event): MatchState` — pure function, zero I/O
- `replayEvents(matchId, events[]): MatchState` — rebuilds from scratch
- `validateEvent(payload, state): {ok: boolean, reason?: string}` — enforces all FIVB rules
- Server-side `stateCache: Map<matchId, {state, lastSequence}>` — avoids full replay on every POST
- UNDO: save UNDO event to DB first, then re-replay from scratch to get correct post-undo state
- Auto-emit after RALLY_WON: side switch → TTO → set end (in priority order)

### Optimistic updates (client)
- Temp events with `id = "temp-{uuid}"` are added to client state immediately
- Server confirms with real `id` and `sequence`; client replaces temp with confirmed
- Offline queue: events queue when `navigator.onLine === false`, flush on reconnect

## Folder structure

```
src/
├── app/
│   ├── (auth)/                    # Clerk auth pages
│   ├── t/[tenantSlug]/            # Tenant-scoped app shell
│   │   ├── layout.tsx             # Inject tenant branding
│   │   ├── dashboard/
│   │   ├── competitions/[id]/
│   │   │   ├── page.tsx
│   │   │   └── matches/[matchId]/
│   │   │       ├── live/
│   │   │       │   └── page.tsx   # Main scoring page
│   │   │       └── team/[team]/
│   │   │           └── page.tsx   # Team tablet page
│   │   └── scoreboard/[matchId]/
│   │       └── page.tsx           # Public display
│   └── api/
│       ├── matches/[id]/events/
│       │   └── route.ts           # POST: add event; GET: SSE stream
│       ├── matches/[id]/state/
│       │   └── route.ts           # GET: full replay (resync)
│       └── pusher/auth/
│           └── route.ts
│
├── engine/
│   ├── types.ts                   # Shared types (TeamId, Side, etc.)
│   ├── beach/
│   │   ├── types.ts
│   │   ├── reducer.ts
│   │   └── validator.ts
│   ├── indoor/
│   │   ├── types.ts
│   │   ├── reducer.ts
│   │   └── validator.ts
│   ├── grass/
│   │   ├── types.ts
│   │   ├── reducer.ts
│   │   └── validator.ts
│   └── light/
│       ├── types.ts
│       ├── reducer.ts
│       └── validator.ts
│
├── components/
│   ├── court/
│   │   ├── BeachCourt.tsx         # SVG court art
│   │   ├── IndoorCourt.tsx
│   │   ├── GrassCourt.tsx
│   │   └── LightCourt.tsx
│   ├── scoring/
│   │   ├── ActionBar.tsx          # Per-discipline action bar
│   │   ├── BeachActionBar.tsx
│   │   ├── IndoorActionBar.tsx
│   │   ├── GrassActionBar.tsx
│   │   └── LightActionBar.tsx
│   ├── scoreboard/
│   │   ├── ScoreboardDisplay.tsx  # Full-screen public display
│   │   └── ServeClockWidget.tsx
│   ├── tablets/
│   │   ├── LineupEntry.tsx        # Team tablet lineup submission
│   │   ├── LiberoDesignation.tsx
│   │   └── TeamTabletBar.tsx      # TO/sub/challenge request bar
│   └── ui/                        # Design system atoms
│
├── db/
│   ├── schema.ts                  # Drizzle schema (all tables)
│   ├── index.ts                   # Neon connection
│   └── migrations/
│
├── lib/
│   ├── match-context.tsx          # Client-side match state provider
│   ├── pusher.ts                  # Pusher client/server config
│   ├── serve-clock.ts             # Serve clock hook
│   └── tenant.ts                  # Tenant resolution helpers
│
├── locales/
│   ├── en.json
│   ├── fr.json
│   ├── de.json
│   ├── es.json
│   └── pt.json
│
└── __tests__/
    ├── engine/
    │   ├── beach.test.ts
    │   ├── indoor.test.ts
    │   ├── grass.test.ts
    │   └── light.test.ts
    └── api/
        └── events.test.ts
```

## API routes

### POST `/api/matches/[id]/events`
Add a new event to a match.

Request body:
```json
{
  "payload": { "type": "RALLY_WON_A" },
  "clientTempId": "temp-abc123"
}
```

Response:
```json
{
  "event": { "id": "evt_xxx", "sequence": 42, ... },
  "state": { ... },
  "autoEmitted": [{ "type": "SIDE_SWITCH" }]
}
```

### GET `/api/matches/[id]/events` (SSE)
Server-Sent Events stream. Sends `event: match-update` with the full updated state on every event. Also used for serve clock ticks.

Clients subscribe via Pusher channel `match-{matchId}` for lower latency updates.

### GET `/api/matches/[id]/state`
Full state resync — replays all events and returns current state. Used on reconnect and by team tablets on mount.

## Authentication flow (Clerk)

1. Tenant admin creates organization in Clerk
2. Users invited to org get `TENANT_ADMIN` or `SCORER` role
3. Team tablets use short-lived signed tokens (generated by SCORER for a specific match/team) — no Clerk login required on the tablet itself
4. Scoreboard viewer tokens are public (no auth, read-only Pusher channel)

## Real-time channels (Pusher)

| Channel | Type | Who subscribes |
|---------|------|----------------|
| `match-{id}` | public | Scoreboard displays, spectators |
| `private-match-{id}-scorer` | private | Scorer tablet |
| `private-match-{id}-team-a` | private | Team A tablet |
| `private-match-{id}-team-b` | private | Team B tablet |

Events pushed: `state-update`, `serve-clock-start`, `serve-clock-reset`, `interrupt-request` (team tablet → scorer).

## Serve clock

Serve clock is UI-only state (not stored as events). After each rally ends:
1. Server pushes `serve-clock-start` with `{ deadline: timestamp, serveClockSecs }` to the Pusher channel
2. All clients render a countdown
3. If scorer manually records a `DELAY_WARNING` or `DELAY_PENALTY` event, it IS stored in the event log

The serve clock is configurable (`serveClockEnabled`, `serveClockSecs` in `tournament_config`).

## Multi-device conflict resolution

Only one device acts as **scorer** (writes events). Team tablets can submit **requests** (TO, sub, challenge, lineup) which appear as notifications on the scorer's screen. The scorer approves/denies each request, which then generates the actual event. This avoids concurrent writes.

Exception: if `allowTeamTabletDirectEntry` is true in config, team tablet requests auto-approve and immediately emit the event.

## PDF export

Match summary PDF generated server-side using PDFKit. Route: `GET /api/matches/[id]/export.pdf`

Must use `export const runtime = "nodejs"` (PDFKit requires Node.js crypto).

Content:
- Match header (tenant logo, competition, teams, date)
- Set-by-set scores
- Event timeline (formatted, per-set)
- Substitution log
- Sanction log
- Final result
