# 12 — Build Order

Phased implementation plan. Each phase is independently deployable. Start with the foundation that makes every subsequent phase easier.

---

## Phase 1 — Foundation (week 1-2)

Goal: bare app running on Vercel with auth, DB connection, and a single tenant.

1. **Project bootstrap**
   - `npx create-next-app@latest volleyball --ts --app --tailwind`
   - Install Drizzle ORM + Neon driver: `@neondatabase/serverless drizzle-orm`
   - Install Clerk: `@clerk/nextjs`
   - Install Pusher: `pusher pusher-js`
   - Install Vitest: `vitest @vitest/ui`
   - Configure `tailwind.config.ts` with design tokens (see spec/08-UI.md)

2. **Database schema**
   - Implement `src/db/schema.ts` from spec/03-DATABASE.md
   - `drizzle-kit push` to Neon dev database
   - Seed first tenant: `{ slug: "fivb-demo", name: "FIVB Demo" }`

3. **Auth**
   - Clerk middleware: `src/middleware.ts`
   - Protect all `/t/[slug]/*` routes
   - `userTenantRoles` seeded for first admin user

4. **Tenant shell**
   - `src/app/t/[tenantSlug]/layout.tsx` — resolves tenant by slug, injects branding CSS vars
   - `src/app/t/[tenantSlug]/dashboard/page.tsx` — empty dashboard

5. **Discipline defaults**
   - `src/engine/config.ts` — `DISCIPLINE_DEFAULTS` + `resolveConfig()`

**Deliverable:** login → tenant dashboard working on Vercel.

---

## Phase 2 — Beach engine + scoring UI (week 2-3)

Goal: full beach volleyball scoring, start to finish.

1. **Beach engine**
   - `src/engine/beach/types.ts` — port from existing `andrew/src/engine/types.ts`
   - `src/engine/beach/reducer.ts` — port + adapt
   - `src/engine/beach/validator.ts` — extract validation from API route
   - Vitest tests: `src/__tests__/engine/beach.test.ts`

2. **Events API**
   - `src/app/api/matches/[id]/events/route.ts` (POST + GET/SSE)
   - `src/app/api/matches/[id]/state/route.ts`
   - Server-side stateCache (`Map<matchId, {state, lastSequence}>`)

3. **Match context**
   - `src/lib/match-context.tsx` — optimistic updates + offline queue

4. **BeachCourt.tsx** — SVG court art

5. **ActionBar** — BETWEEN_RALLIES, RALLY_LIVE, TIMEOUT_ACTIVE, TTO_ACTIVE

6. **Live page** — `src/app/t/[slug]/competitions/[id]/matches/[id]/live/page.tsx`
   - TopBar, ScoreHeader, BigScore, CourtArt, ServeClockBar, ActionBar
   - Desktop history sidebar

7. **Set break overlay** (60s countdown)

8. **Match confirm overlay** (two-tap match end)

9. **Serve clock** — `src/lib/serve-clock.ts` + `ServeClockWidget.tsx`

10. **Pusher integration**
    - `src/lib/pusher.ts` (client + server config)
    - Auth endpoint `/api/pusher/auth`

**Deliverable:** beach volleyball match fully scoreable, real-time on multiple devices.

---

## Phase 3 — Competition management (week 3-4)

Goal: create competitions, manage teams, schedule matches.

1. **Competition CRUD** — list, create, edit, archive
2. **Team management** — add/edit/delete teams + players
3. **Match scheduling** — create matches, assign courts + times
4. **Match detail page** — status, events log, [Open Scorer] button
5. **CSV import** — teams, players, schedule
6. **Basic standings** — pool table (computed on-the-fly)
7. **QR code generation** for team tablet tokens

**Deliverable:** full competition administration for beach volleyball.

---

## Phase 4 — Scoreboard display + PDF export (week 4)

1. **Scoreboard display** — `src/app/t/[slug]/scoreboard/[matchId]/page.tsx`
   - Public Pusher subscription
   - Three display modes (SCORE_ONLY, SCORE_WITH_SETS, SCORE_WITH_ROTATION)
   - TV-optimized responsive layout
   - Polling fallback (`?mode=poll`)

2. **PDF export** — `src/app/api/matches/[id]/export.pdf/route.ts`
   - PDFKit with `runtime = "nodejs"`
   - Match header, set scores, event log, sanctions log

**Deliverable:** TV scoreboard + match report PDF.

---

## Phase 5 — Indoor engine (week 5-6)

Goal: indoor volleyball with full officiating (rotation, libero, subs, VCS).

1. **Indoor engine**
   - `src/engine/indoor/types.ts` — 6 positions, libero state, VCS state
   - `src/engine/indoor/reducer.ts` — rotation, libero replacements, back-row rules
   - `src/engine/indoor/validator.ts`
   - Vitest tests: `src/__tests__/engine/indoor.test.ts`

2. **IndoorCourt.tsx** — hardwood court with attack line, position numbers

3. **IndoorActionBar.tsx** — includes [Sub], [Lineup], [Challenge] buttons

4. **Lineup entry flow** — LINEUP_PENDING phase, both-teams confirmation

5. **Team tablet interface**
   - `src/app/t/[slug]/matches/[id]/team/[team]/page.tsx`
   - LineupEntry, LiberoDesignation, TeamTabletBar components
   - Session token auth

6. **Interrupt request flow** — team tablet → scorer notification → approve/deny

7. **VCS challenge workflow** — VCS_ACTIVE phase, upheld/rejected buttons

8. **Deciding set court switch** — auto-emit at 8 pts

**Deliverable:** indoor volleyball fully scoreable with team tablets.

---

## Phase 6 — Grass engine (week 7)

1. **Grass engine**
   - `src/engine/grass/types.ts` — port from existing `andrew/src/engine/grass/types.ts`
   - `src/engine/grass/reducer.ts` — port + adapt
   - `src/engine/grass/validator.ts`
   - Vitest tests: `src/__tests__/engine/grass.test.ts`

2. **GrassCourt.tsx** — grass court SVG (3-player and 4-player layouts)

3. **GrassActionBar.tsx** — extends beach action bar with sub/lineup buttons

4. Live page routing: `match.discipline === "GRASS"` → render grass components

**Deliverable:** grass volleyball fully scoreable.

---

## Phase 7 — Light Volleyball engine (week 7-8)

1. **Light engine**
   - `src/engine/light/types.ts` — 4-player and 5-player position support
   - `src/engine/light/reducer.ts` — front-zone arc fault, jump serve fault, deciding set switch
   - `src/engine/light/validator.ts`
   - Vitest tests: `src/__tests__/engine/light.test.ts`

2. **LightCourt.tsx** — 12×6m court, 2m attack line, jump serve restriction line

3. **LightActionBar.tsx** — includes arc fault and jump serve fault buttons

4. Live page routing: `match.discipline === "LIGHT"` → render light components

**Deliverable:** light volleyball fully scoreable (both 4-player and 5-player).

---

## Phase 8 — Tournament brackets + standings (week 8-9)

1. Pool standings with tiebreaker algorithm
2. Knockout bracket visual
3. Auto-advance winners to next bracket match
4. Competition results export (CSV)
5. Public results page (no auth)

**Deliverable:** complete tournament lifecycle.

---

## Phase 9 — i18n + white-label polish (week 9-10)

1. Complete locale files: en, fr, de, es, pt
2. Language switcher in user settings
3. Tenant branding panel (logo upload, color picker)
4. Court color overrides
5. Custom domain support (Vercel domains API)
6. `useT()` hook throughout all components

**Deliverable:** fully white-label, multilingual app.

---

## Phase 10 — Seed data + first deployment (week 10)

1. Implement seed script: `src/scripts/seed.ts`
2. 4 competitions (one per discipline), 2 matches each (1 finished + 1 live)
3. Vercel project setup (Neon integration, Pusher env vars, Clerk keys)
4. `vercel --prod` deployment
5. QA sweep across all 4 disciplines

See spec/13-SEED-DATA.md for exact data.

**Deliverable:** production deployment at `app.volleyball-platform.com`.

---

## Phase 11 — Hardening (ongoing)

- End-to-end tests with Playwright (scorer flow, team tablet flow)
- Rate limiting on events API (prevent accidental double-submit)
- Event sequence gap detection (detects dropped events)
- Admin audit log
- Tenant billing hooks (Stripe integration — future)
- Error monitoring (Sentry)
- Uptime monitoring

---

## Development conventions

- **Engine first**: every new discipline gets engine + tests before any UI
- **Feature flags via config**: all new features start behind a `tournament_config` toggle
- **No stats scope creep**: the events table captures everything; stats can be added later without schema changes
- **Migrations**: always `drizzle-kit generate` in production; never `push` against production DB
- **Read AGENTS.md** before touching any Next.js 16 code (breaking changes from earlier versions)
