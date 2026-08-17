# 32 — Session handover, 2026-08-17

Written before a machine shutdown. **Everything below is committed and pushed
to `origin/main`** — nothing of value lives only on this machine. This document
exists so the next session can resume without re-deriving any of it.

Head at time of writing: **`9b9939f`** on `main`.

---

## 1. What is live right now

| Environment | Commit | Schema | Migrations |
|---|---|---|---|
| **Production** — https://volleyball-eight.vercel.app | `b09d4e5` | `public` | 23 |
| **Homologation** — https://volleyball-homolog.vercel.app | `10f1d6f` | `homolog` | 23 |
| `origin/main` | `9b9939f` | — | 23 |

Production is **three commits behind main**: `b2daf26` (beach rulebook
citation, docs+tests only), `10f1d6f` (the release-console notice fix),
`7323dbb` / `dd62920` / `e5c7812` / `9b9939f` (tests and CI only). **None of
them changes runtime behaviour on production and none adds a migration**, so
there is no urgency — but the release-console fix (§4) is worth shipping on the
next promote.

Promoting is the two-step console flow (spec/28 §4). The gate now works
correctly because production runs the post-`24abc2e` console.

## 2. What was completed this session

In order, each fully shipped and pushed:

1. **spec/28 hardening** — the clone could reach production auth, storage and
   backups. Auth writes refused outside `public`; storage keys namespaced;
   `VERCEL_ENV ⇔ DB_SCHEMA` boot cross-check; `restore-backup.mts --schema`.
2. **spec/29** (7 phases) — bench officials, guided sanctions + `SET_DEFAULT`,
   positional fault corrections, injury/libero/recovery completeness, in-match
   protests, court + venue timezone + goldens + no-show, offline audit.
3. **spec/30** (A–G) — the stale-cache blast radius (VSR feed, timings,
   standings, audit views), the tablet exceptional substitution, the legacy
   queue migration, Rule 17.1.2 recovery enforcement, two-tier PDF text
   goldens.
4. **Production rollout** — promoted `24abc2e` (delivering the stranded
   2026-08-14 security guards), backed up all tenants, migrated production
   19 → 23, promoted `b09d4e5`.
5. **spec/31** — test-suite audit, then its backlog: mutation-layer tests,
   grass/light validator parity, `liveMatches`, coverage tooling. 471 → 711
   unit tests.
6. **CI e2e wiring** (this document's §3).

## 3. CI end-to-end — the state to know

`.github/workflows/ci.yml` now runs the authenticated Playwright specs. **All
7 secrets are set** on `bernardofranco1/volleyball`; all 6 e2e tests pass.

**The safety property, which matters more than the wiring:** those specs WRITE
(the scorer awards a real point, the tablet files a real request). The job sets
`DB_SCHEMA: homolog` explicitly, AND the specs verify it themselves against
`/api/version` and **fail** rather than skip if the answer is `public`. Both
were proven locally in each direction. Do not remove either — unset
`DB_SCHEMA` means `public`, and the Vercel cross-check does not fire on a
GitHub runner.

### The dedicated CI account (created this session)

- **`e2e@volleyball-demo.app`** — auth user `7e612899-2f66-459c-b860-473112eccee8`.
- Role: **SCORER on the test tenant only** (`tenant_fivb_demo`, slug
  `volleyball-scoring` = `TEST_TENANT_SLUG`). No global admin, no other tenant.
- Rows written to **both** `public` and `homolog`, so the grant survives the
  next `db:clone:homolog` (which rebuilds homolog from production).
- The password is in the `E2E_PASSWORD` GitHub secret and **nowhere else** —
  it is not in this repo. To rotate: reset via Supabase and update the secret.

### The tablet token

`E2E_TABLET_PATH` carries `?token=…`, a `match_sessions` row (`TEAM_SCORER`,
team A, 5-year expiry) minted in both schemas for match
`match_ba5f6x3asxqvr3h2ozwfx5ot`. Scoped to that one match and team; it can
file interrupt requests on a homolog demo match and nothing else. Revoke by
setting `revoked_at`.

### If CI e2e goes red later

Most likely cause: the target match drifted into a state with no scoreable
buttons, or `db:clone:homolog` reset it. Pick another LIVE homolog match and
update `E2E_SCORER_PATH`. The spec tolerates the rally gate being open or
closed, but not a match that cannot be scored at all.

## 4. Open items, in priority order

1. **§1 of spec/31 — CI is advisory to deployment.** The Vercel build does not
   wait for CI; a failing push still produces the homolog preview. Two options,
   both needing an owner decision: GitHub branch protection requiring the CI
   check (ends direct pushes to `main`, which is the current workflow), or
   surfacing candidate CI status in the release console (needs a
   `GITHUB_TOKEN`, which spec/28 deliberately avoided). **This is the single
   biggest remaining gap in "attested on build".**
2. **Promote main to production** when convenient — carries the
   release-console notice fix (`10f1d6f`), which currently tells anyone opening
   `/admin/releases` on homologation to go and add three environment variables
   they must not add.
3. **spec/31 §5 remainder** — `match-admin-actions` (24%) and `team-actions`
   (30%) hold several untested sibling actions (officials, sessions, team
   CRUD). The *gates* are covered; the siblings are the natural next slice.
4. **Coverage thresholds** — deliberately NOT set. The headline % falls when a
   dark module is first tested (denominator grows faster than coverage), so a
   threshold today would be tripped by the next honest attempt. Watch
   `statements.covered` instead; revisit once the mutation layer is broadly
   covered. See spec/31 §7.
5. **Grass/light rules authority** — neither discipline has a selected
   rulebook (`volleyball-codex` spec/20). Their recovery limits and several
   validator rules are house rules by necessity.

## 5. Things that will bite if forgotten

- **`.env.local` points at `DB_SCHEMA=homolog`.** Any script meant for
  PRODUCTION must be prefixed `DB_SCHEMA=public` (AGENTS.md).
- **Dev and production share one Supabase database**, separated only by schema.
  Never run a branch's migrations without merging the code first.
- **Migrations: bump BOTH** `MIGRATION_JOURNAL_IDX` (backup-policy.ts) and
  `KNOWN_JOURNAL_IDX` (restore-backup.mts). A test enforces it; it has caught
  two real mistakes in two days.
- **Every new client-submittable event type** must be added to
  `CLIENT_SUBMITTABLE` in `api/matches/[id]/events/route.ts`, or the console
  gets a 422.
- **`max_pipeline: 0`** in `src/db/index.ts` must never be removed while on the
  transaction pooler.
- **Fixtures before features.** Twice now the golden fixtures caught a defect
  the feature work had shipped (the stale score cache, three commits later).
- **Verify rules against the rulebook, never memory.** Twice the source
  contradicted a plan: Rule 15.7 revealed a waiver we were missing, and beach
  Rule 17.1.2 revealed a limit we were about to invent.

## 6. Reference — the rulebooks

Both were fetched and read this session; neither is committed (5 MB each).

- Indoor: `https://www.fivb.com/wp-content/uploads/2025/01/FIVB-Volleyball_Rules2025_2028-EN-v05.pdf`
- Beach: `https://www.fivb.com/wp-content/uploads/2025/02/FIVB-BeachVolleyball_Rules2025_2028-EN-v01.pdf`

Rules cited in code: **17.1.2** (recovery — indoor caps the count, beach caps
only the duration), **15.7** (exceptional substitution is beyond ALL of 15.6,
slot rules included), **19.3.2.1 / 19.3.2.2** (libero may replace any back-row
player but may never serve), **7.3.1 / 6.4.3** (incomplete team → `SET_DEFAULT`).
