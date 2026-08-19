# spec/38 — The VIS boards on a host of their own

Shipped 2026-08-19. No schema change, no VIS contract change, and the scoring
platform's production deployment is untouched.

## Why

The VIS boards (spec/34-37) have nothing to do with scoring: no login, no
tenant, no writes. But their links carried the scoring platform's hostname and
tenant path —

    https://volleyball-eight.vercel.app/t/live-events/scoreboard/vis/comp_vis_1670/27547

— so a competition official following one could wander into a sign-in page for
an application they have no business in, and the root of that hostname reads
"Volleyball Scoring Platform · Sign in". The links go to venue staff and get
typed into arena browsers; they must look and behave like their own thing.

## What was built

**A second deployment of the same codebase**, Vercel project
`fivb-live-scoreboards` (`prj_pgBaWUtfkb7GoWCqeSD8ESbxA86V`), production branch
`main`, serving:

    https://fivb-live-scoreboards.vercel.app

`BOARD_ONLY=1` turns on board-host mode. The proxy then serves the board routes
and nothing else — **every other path 404s, sign-in included** — and `/` is the
competition index rather than the platform's front page. The gate is the first
thing in the proxy, before any tenant, session or last-tenant work, because none
of that has meaning on a host with no accounts.

### The public URLs

    /                    competitions
    /c/{competitionId}   every match, grouped by venue-local date
    /m/{matchNo}         the board                     e.g. /m/27547
    /m/{matchNo}?layout=ushape
    /m/{matchNo}?screen=stats
    /m/mock              the spec/35 validation capture, no VIS call

Chosen to survive the extraction below: VIS match numbers are globally unique,
so `/m/27547` addresses a board with no tenant in the path and stays valid
whichever backend serves it later. Short enough to read down a phone line.

The day index carries a **copy button per layout** on every match, so a venue
can be sent its exact URL without anyone transcribing a match number.

### One renderer, two URLs

The board screen moved into `src/components/scoreboard/VisBoardScreen.tsx`,
shared by the tenant path and `/m/{matchNo}`, so the two cannot drift. The
in-app route now only resolves the tenant.

## Why one codebase and not a fork

The boards changed on four separate days this week. A copy would rot within a
fortnight, and the copy is the one venues would be watching. The flag keeps the
board host on the same commits while the shape settles.

## Deliberate compromises, to be removed

- **It shares the production database.** The board reads it for exactly two
  things: which VIS tournaments are allowed, and each competition's branding.
  That means a production `DATABASE_URL` now lives in a second Vercel project.
  It is read-only usage, but it is a second place that credential lives.
- **The intended end state is a project with no database at all.** Four
  tournaments and four branding rows are a config file, not a schema. Once the
  board is extracted it needs only `VIS_APP_ID` — no Supabase, no auth, no
  tenants — and the public URLs above do not change.
- **Deployment protection is off** on this project (`ssoProtection: null`),
  deliberately: the links are handed to competition staff and pointed at by
  venue TVs, so they must open with no account. The index therefore exposes the
  fixture list and the board URLs to anyone who finds the hostname. Accepted;
  the boards are on arena screens anyway.
- **`*.vercel.app`, not a bought domain.** Nothing in the code depends on the
  hostname: attaching a custom domain to this project is a settings change and
  the URLs keep their shape.

## Operating it

- Pushes to `main` deploy the board host automatically. The scoring app is
  unaffected — it still only reaches production through the release console's
  promote (spec/28), so the two can and do run different commits.
- Env on the board project: `BOARD_ONLY=1`, `DB_SCHEMA=public`,
  `NEXT_PUBLIC_DB_SCHEMA=public`, `DATABASE_URL`, `VIS_APP_ID`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The last two are
  needed only because the proxy constructs a Supabase client at module load.
  They disappear with the extraction.
- `src/__tests__/lib/board-host.test.ts` pins what the host serves, and the
  assertions that matter are the negative ones.
