# Volleyball — white-label multi-discipline scoring platform

Real-time scoring for **Beach, Indoor, Grass, and Light** volleyball, with
competition management, tournament brackets, public scoreboards/results, PDF
match reports, team tablets, and per-tenant white-labelling (colours, logo,
court colours, 5 languages).

Stack: **Next.js 16** (App Router) · **Supabase** (Auth + Postgres + Realtime) ·
**Drizzle ORM** · **Tailwind v4** · **Vitest**.

> Next.js here has breaking changes from older versions — read
> `node_modules/next/dist/docs/` (and `AGENTS.md`) before touching app code.

## Setup

1. Install deps: `npm install`
2. Copy `.env.example` → `.env.local` and fill in the Supabase values
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`). The DB password must be
   URL-encoded (`%` → `%25`). Migrations use the **session** pooler (`:5432`),
   runtime uses the **transaction** pooler (`:6543`).
3. Push the schema: `npm run db:push`
4. Seed the foundation tenant: `npm run db:seed`
   (optionally set `SEED_ADMIN_EMAIL` + `SEED_ADMIN_USER_ID` to grant the first
   `TENANT_ADMIN`).
5. Seed the full demo data (4 competitions, one per discipline, each with a
   finished + a live match): `npm run db:seed:demo`

## Develop

```bash
npm run dev      # http://localhost:3000  → /login → /t/fivb-demo/dashboard
npm test         # engine unit tests (vitest)
npm run lint     # eslint
npm run build    # production build
```

## Scripts

| Script | Purpose |
|--------|---------|
| `db:push` | Sync schema to the dev DB (`drizzle-kit push`) |
| `db:generate` | Generate a migration from schema.ts changes (production path) |
| `db:migrate` | Apply committed migrations (baseline 0000 marks the pre-migration schema) |
| `db:seed` | Seed the demo tenant + optional first admin |
| `db:seed:demo` | Seed 4 competitions with finished + live matches |

## Surfaces

- **Admin** (`/t/[slug]/…`): competitions, teams/players, scheduling, standings,
  pools, knockout bracket, CSV import/export, settings (branding + language).
- **Scorer** (`…/matches/[id]/live`): discipline-aware live scoring (rotation,
  libero, subs, VCS, faults — per discipline).
- **Public** (no auth): scoreboard `…/scoreboard/[id]`, results `…/results/[id]`.
- **Team tablet** (token): `…/matches/[id]/team/[A|B]?token=` — lineup + interrupt
  requests.
- **PDF**: `GET /api/matches/[id]/export.pdf`.

## Deploy to Vercel

The build is deployment-ready (`npm run build` is green). Deployment is a manual
step performed with your own Vercel account:

1. `vercel link` (or import the GitHub repo at vercel.com/new).
2. Add the Project Environment Variables (same keys as `.env.local`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`.
3. Run migrations against the production DB (`drizzle-kit generate` →
   `drizzle-kit migrate`), then `npm run db:seed` / `db:seed:demo` if desired.
4. `vercel --prod`.
5. **Custom domains** (per-tenant white-label): map domains in the Vercel
   dashboard or via the Vercel Domains API. The settings page surfaces this as a
   deploy-time step (the Domains API integration is not wired into the app).

## Monitoring (optional, Phase 11)

- **Errors**: set `SENTRY_DSN` (+ `NEXT_PUBLIC_SENTRY_DSN`) to enable Sentry;
  unset = inert.
- **Uptime**: point a monitor (UptimeRobot / BetterStack / Pingdom) at
  `GET /api/health` — 200 when the DB is reachable, 503 otherwise.
- **Rate limiting**: set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
  for cross-instance limits; otherwise a per-instance in-memory limiter is used.
