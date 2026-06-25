# 02 — Architecture

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js 16 App Router | React 19, TypeScript strict |
| Styling | Tailwind CSS v4 | CSS-first config, no tailwind.config.js |
| ORM | Drizzle ORM | Type-safe, SQL-first |
| Database | **Supabase PostgreSQL** | Free 500 MB → Pro $25/month |
| Auth | **Supabase Auth** | Built into Supabase — no separate service |
| Real-time | **Supabase Realtime** | Broadcast + Presence — built into Supabase |
| File storage | **Supabase Storage** | Logos, PDF exports — built into Supabase |
| Testing | Vitest | Unit tests for all engine logic |
| PDF | PDFKit | Route with `runtime = "nodejs"` |
| i18n | Custom `useT()` hook | JSON locale files, no heavy library |
| Deployment | Vercel | Edge-compatible routes where possible |
| Email | Resend | Team invitations — free 3k/month |
| Error tracking | Sentry | Free 5k errors/month |

**Supabase is the single external backend service** — it replaces what would otherwise be four separate services (Neon + Clerk + Pusher + blob storage). The Drizzle ORM connection string changes from Neon to Supabase's PostgreSQL pooler; all schema and query code is identical.

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
│   ├── (auth)/                    # Supabase Auth pages (login, signup, reset)
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
│       └── realtime/token/
│           └── route.ts           # Issues Supabase Realtime JWT for team tablets
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
│   ├── index.ts                   # Supabase PostgreSQL connection (via Drizzle)
│   └── migrations/
│
├── lib/
│   ├── match-context.tsx          # Client-side match state provider
│   ├── supabase.ts                # Supabase client (browser + server variants)
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

Clients also subscribe to the Supabase Realtime channel `match-{matchId}` for lower-latency push updates — whichever arrives first wins.

### GET `/api/matches/[id]/state`
Full state resync — replays all events and returns current state. Used on reconnect and by team tablets on mount.

## Authentication flow (Supabase Auth)

1. Tenant admin signs up via Supabase Auth (email + password, or magic link)
2. After sign-up, an entry is created in `user_tenant_roles` assigning them `TENANT_ADMIN`
3. Admins invite scorers by email — Supabase Auth sends the invite link; on accept, a `SCORER` row is created in `user_tenant_roles`
4. Team tablets use short-lived signed JWTs (generated server-side for a specific match/team) — no Supabase login on the tablet itself
5. Scoreboard is public — no auth, open Realtime channel

```ts
// src/lib/supabase.ts — two clients needed

// Browser client (used in React components)
import { createBrowserClient } from "@supabase/ssr";
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Server client (used in API routes and Server Components)
import { createServerClient } from "@supabase/ssr";
export function createSupabaseServerClient(cookieStore: ReadonlyRequestCookies) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  );
}

// Drizzle DB connection — uses Supabase PostgreSQL pooler (Transaction mode)
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
const client = postgres(process.env.DATABASE_URL!);  // Supabase pooler URL
export const db = drizzle(client);
```

**Environment variables:**
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # server-only, never exposed to client
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

## Real-time channels (Supabase Realtime)

Supabase Realtime uses **Broadcast** (low-latency custom events) and **Presence** (online tracking). This replaces Pusher with zero additional cost.

| Channel | Type | Who subscribes |
|---------|------|----------------|
| `match:{id}` | public Broadcast | Scoreboard displays, spectators |
| `match:{id}:scorer` | private Broadcast | Scorer tablet (Supabase Auth JWT) |
| `match:{id}:team-a` | private Broadcast | Team A tablet (custom JWT) |
| `match:{id}:team-b` | private Broadcast | Team B tablet (custom JWT) |

Private channels are secured via Supabase Realtime's JWT-based RLS policies. The anon key allows public channel access; scorer and team channels require a valid JWT with matching claims.

Events broadcast: `state-update`, `serve-clock-start`, `interrupt-request` (team tablet → scorer), `request-resolved` (scorer → team tablet).

```ts
// Server-side broadcast after event is persisted
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
await supabaseAdmin.channel(`match:${matchId}`)
  .send({ type: "broadcast", event: "state-update", payload: { state, lastEvent } });
```

```ts
// Client-side subscription (scorer / scoreboard)
const channel = supabase.channel(`match:${matchId}`)
  .on("broadcast", { event: "state-update" }, ({ payload }) => {
    setMatchState(payload.state);
  })
  .on("broadcast", { event: "serve-clock-start" }, ({ payload }) => {
    startClock(payload.deadline);
  })
  .subscribe();
```

## Serve clock

Serve clock is UI-only state (not stored as events). After each rally ends:
1. Server broadcasts `serve-clock-start` with `{ deadline: timestamp, serveClockSecs }` via Supabase Realtime
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
