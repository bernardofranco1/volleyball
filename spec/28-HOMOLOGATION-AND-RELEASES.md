# spec/28 — Homologation → Production releases (one URL, one DB, one project)

**Status: PLANNED — no implementation yet.** Written 2026-08-13; **revised the
same day (v2)** after review: homologation gets **its own tables in the same
database** (a `homolog` Postgres schema), selected per environment by an env
var. This supersedes v1's shared-tables model and its homolog-tenant idea, and
it demotes the expand/contract migration law from "always" to "promote-window
and rollback safety only".

## 1. Goal

- A push to `main` lands in **Homologation**, never directly in production.
- Homologation runs against **its own tables** — same database, so still one
  Supabase project — and production tables are untouched by testing.
- Once validated, the version is **promoted to production from a UI** that
  shows which version sits where; the same UI does rollback.
- **One URL**: the validator can switch the canonical address between the two
  versions, with an amber bar whenever they are looking at Homologation.

## 2. The shape in one paragraph

Postgres namespaces do the table separation: production lives in schema
`public` (exactly as today — its connection string does not change at all),
homologation lives in schema `homolog`, a refreshable clone of production.
Which schema a running app uses is decided by **one env var** (`DB_SCHEMA`),
applied as the connection's `search_path` — no query in the codebase changes,
because Drizzle emits unqualified table names and Postgres resolves them
through the search path. Vercel's environment split carries the var: **preview
deployments** (every push to `main`, and every feature branch) get
`DB_SCHEMA=homolog`; **production deployments** get `public`. Promotion is
therefore: build the production flavour of the validated commit (staged, not
yet serving), migrate `public` if needed, then flip the domain to it — from
the release console.

## 3. The building blocks (verified against Vercel/Supabase docs, Aug 2026)

All on the current Hobby plan.

1. **Production branch ≠ main.** Vercel's production branch becomes `release`,
   a branch only the release console fast-forwards. Pushes to `main` then
   build ordinary **preview deployments** — with preview env vars, i.e. the
   homolog schema — and `main`'s stable branch alias becomes the homolog URL.
   The `release` branch doubles as the audit trail: its history IS the
   promotion history.
2. **Staged production deployments.** Project setting *Auto-assign Custom
   Production Domains: off*. A push to `release` builds a production-env
   deployment that does **not** take the domain until promoted — the console
   flips it only after prod migrations have run.
3. **Promote API** — `POST /v10/projects/{projectId}/promote/{deploymentId}`
   assigns the domain to an existing deployment, no rebuild. First promotion
   of a release targets the fresh `release` build; **rollback promotes any
   older production deployment instantly** (it already exists, built with the
   right env).
4. **Protection Bypass for Automation** (all plans) lets the one-URL proxy
   reach protected preview URLs by header.
5. **postgres.js startup parameters** (`connection: { search_path }`) hold for
   the whole session on Supabase's **session pooler** — which is what homolog
   traffic uses (one validator; concurrency is trivial). Production keeps the
   transaction pooler and never sets a search_path at all. (Whether Supavisor's
   transaction mode honours `search_path` startup params: verify at
   implementation; nothing depends on it.)

Why not decide the schema at runtime inside one deployment (by host header or
a control table)? Because it reintroduces exactly the class of bug this design
exists to kill: a warm instance with a stale decision writing homolog data
into prod tables during the promote window. An env var is decided at deploy
time, per deployment, forever — there is nothing to race.

## 4. Three pointers, one project

| Pointer | Meaning | Moved by |
|---|---|---|
| **Production** | which deployment `volleyball-eight.vercel.app` serves everyone (schema `public`) | *Promote* in the console |
| **Homologation** | which preview build the homolog alias serves (schema `homolog`) | automatic: latest `main` push (manual override in console) |
| **Your browser** | which of the two YOU see at the one URL | the signed homolog cookie — console: *View homolog* / *Exit* |

**Promote, in full (one button, the console orchestrates):**
1. Guards: LIVE-match warning, migration preview (see §6), contract
   acknowledgement if applicable, confirm.
2. Full backup of all tenants (existing spec/23 machinery + all-tenants wrapper).
3. Fast-forward `release` to the validated SHA (GitHub API) → Vercel builds
   the production-env deployment, staged. Console polls until READY (~2 min).
4. Apply the migration delta to `public` (if any).
5. Promote API → the domain flips. `releases` row + platform audit entry;
   the homolog cookie is cleared.

Rollback: promote any earlier production deployment from the history —
instant, no rebuild. (Only guaranteed clean if migrations since that release
were expand-only — §6.)

The promoted build is the same commit, not the same artifact, as what was
validated — necessarily, since the schema env var must differ. Same code, same
lockfile, config identical except `DB_SCHEMA`/`DATABASE_URL`; the honest
residual risk is a build-environment difference, accepted.

## 5. One database, two schemas — mechanics

- **`DB_SCHEMA`** env: `public` in Production env, `homolog` in Preview env
  (and in `.env.local` — see §10). `src/db/index.ts` passes it as
  `connection: { search_path }`; homolog connections use the session pooler
  URL, production keeps today's transaction-pooler URL untouched.
- **No query changes.** Drizzle emits unqualified names; `search_path`
  resolves them. Nothing in `src/` knows which schema it is on.
- **Migration journals split.** Drizzle's migrator takes
  `migrationsTable`/`migrationsSchema`: `public` keeps today's journal;
  `homolog` gets its own (`drizzle.__drizzle_migrations_homolog`).
  `db:migrate` gains a `--env homolog|prod` flag choosing connection + journal.
- **Clone script** `scripts/clone-prod-to-homolog.ts` (console button
  *Refresh homolog data*): drop & recreate schema `homolog`; for each `public`
  table `CREATE TABLE homolog.t (LIKE public.t INCLUDING ALL)` + copy rows +
  re-create FKs from `pg_get_constraintdef` (LIKE excludes them); copy the
  prod migration journal into the homolog journal so a candidate's
  `db:migrate --env homolog` applies exactly the delta. No sequences to fix —
  every PK is a text cuid. Minutes of work for a DB this size, runs in-database.
- **Email scrub on clone (decide: default on).** The clone contains real
  member addresses; homolog testing of anything that emails would otherwise
  mail real people. The script rewrites emails to `x+<id>@homolog.invalid`
  except allow-listed admin addresses.
- **Auth is shared on purpose.** Supabase `auth` schema is global; our
  `users`/roles tables are cloned, so the same logins work in both
  environments with whatever roles they had at clone time.
- Small print: RLS enablement isn't copied by LIKE (irrelevant — the app
  connects as owner and realtime-RLS is off); advisory-lock keys are
  DB-global, so the lock helper mixes `DB_SCHEMA` into the key; realtime
  channels get an env prefix (`hml:match:{id}`) since cloned match ids equal
  prod ids; Supabase Studio shows both schemas side by side, which is a nice
  free inspection UI.

## 6. What this does to migrations (the big win)

- **During validation: freedom.** A candidate's migrations — including drops
  and renames — run against `homolog` only. Production tables and production
  code are untouched for the whole validation period, however long it lasts.
  The class of incident from 2026-08-11 (a migration dropping columns the
  promoted code still read) becomes structurally impossible *during
  validation*.
- **At promote: a short overlap.** `public` is migrated seconds-to-minutes
  before the domain flips, while the outgoing release still serves stragglers.
  Destructive changes therefore still want the expand/contract split — but as
  a **promote-window rule**, not a development-time straitjacket.
- **Rollback defines the real policy.** Rolling back re-serves old code
  against the new schema. So: migrations since the previous release must be
  expand-only **if you want one-click rollback**; a release carrying a
  contract migration downgrades its rollback path to "restore from the
  pre-promote backup". The console makes this legible: a red `CONTRACT`
  chip (CI lint flags `DROP`/`RENAME`/`SET NOT NULL`/`ALTER TYPE` without a
  `-- contract-ok:` marker) and a promote dialog that says which rollback
  story this release has.
- The `MIGRATION_JOURNAL_IDX` / restore-map bump discipline stays as is
  (test-enforced), and step 2 of every promote is a full backup regardless.

## 7. Release console — `/admin/releases` (global admin)

Shows: recent `main` builds (SHA, title, age, chips `IN HOMOLOG` /
`CONTRACT`), the current production release (SHA, serving since), both
schemas' journal state (what `public` has vs what the candidate expects), and
the release history with rollback buttons.

Actions: *Refresh homolog data* (clone), *Set as homolog* (alias override),
*View homolog* / *Exit* (signed cookie), *Promote* (the §4 sequence),
*Rollback*. Everything audit-logged (platform-level rows, spec/26 convention).

New table `releases`: `id, deployment_id, sha, message, promoted_at,
promoted_by, previous_deployment_id, migration_state, note`.

## 8. The banner and the one-URL switch

- **Banner detection is now trivial and unspoofable:** preview deployments
  have `VERCEL_ENV=preview` → render the amber bar (SHA + "this is not
  production" + *Exit* in cookie mode) on every surface including the scorer
  console. Production builds never render it. No cookies, hosts or DB reads
  involved in the decision.
- **One-URL switch** (unchanged from v1): the production deployment's
  `proxy.ts` gains a first branch — a valid signed `hml` cookie (set only by
  the console, ~4 h TTL) rewrites the request to the homolog alias with the
  protection-bypass header. Matcher widens to `_next/static`, images and
  `/api/*` with an immediate `NextResponse.next()` for non-cookie traffic so
  today's hot-path discipline is preserved. Canonical origin goes into
  `serverActions.allowedOrigins` and our `sameOriginOk`. Auth cookies are
  host-scoped to the one domain and flow through both ways. Bonus of v2: a
  proxied validator session reads and writes **homolog tables** by
  construction — the target deployment's env decides, nothing to get wrong.

## 9. Promote-time skew

Unchanged: promoting swaps code under open browsers and old hashed assets stop
resolving (Skew Protection is a paid feature). The LIVE-match guard is the
main mitigation; the optional version beacon ("new version — reload") remains
a Phase-4 nicety.

## 10. Two free wins outside the pipeline

- **Local dev stops touching production tables.** `.env.local` points
  `DB_SCHEMA=homolog` (session pooler). The standing shared-DB hazard — dev
  work writing to prod, the root of two incidents — largely disappears;
  touching `public` locally becomes a deliberate act (`--env prod`).
- **Feature-branch previews become harmless.** Today every PR preview runs
  against production tables; under v2 they inherit preview env → homolog.

## 11. Inventory of changes

**Vercel:** production branch → `release`; auto-assign production domains →
off; Protection Bypass secret. **Env:** `DB_SCHEMA` (prod=`public`,
preview=`homolog`), preview `DATABASE_URL` → session pooler, `VERCEL_TOKEN`,
`VERCEL_PROJECT_ID`, `GITHUB_TOKEN` (ff the `release` ref),
`HOMOLOG_COOKIE_SECRET` — minding the `vercel env add --value` truncation
gotcha. **Repo:** `db/index.ts` search_path plumbing; `migrate.ts --env` +
homolog journal; `scripts/clone-prod-to-homolog.ts` (+ email scrub);
`releases` migration; `/admin/releases` + `src/lib/releases.ts` (Vercel +
GitHub API clients); proxy.ts homolog branch; banner; migration CI lint;
all-tenants backup wrapper; advisory-lock env salt; realtime channel prefix.

**Unchanged:** production's connection string, all queries, scorers, tablets,
boards, PDFs, crons (production deployment only → `public` by construction).

## 12. Rollout

- **Phase 0 — settings (minutes).** `release` branch + both toggles. Pushes
  to `main` stop reaching production that moment. Interim promote: push
  `release` + dashboard Promote button.
- **Phase 1 — schema split (~1 day).** `DB_SCHEMA` plumbing, clone script,
  dual journals, banner, `.env.local` → homolog. Validate by cloning and
  driving the app on a preview URL end-to-end (spec/27 QA pattern).
- **Phase 2 — release console (~1 day).** `releases` table, promote
  orchestration (backup → ff → poll → migrate → flip), rollback, guards,
  audit.
- **Phase 3 — one-URL switch (~½–1 day).** Cookie + proxy + origins; browser
  pass in both modes, including scoring a match in homolog through the proxy.
- **Phase 4 — optional.** Migration CI lint, version beacon.

## 13. Alternatives considered

- **v1 of this spec (shared tables + homolog tenant):** simpler plumbing, but
  every migration was a loaded gun pointed at prod for the entire validation
  period, and test writes needed tenant discipline. Superseded.
- **Runtime schema switching in one deployment** (host- or control-table
  based): race-prone at exactly the promote moment; rejected above (§3).
- **Second database / Supabase branching:** the textbook answer; rejected
  against the one-DB constraint, and the schema split now captures most of its
  value (isolation of writes and of migrations) at none of its cost.
- **Exact-artifact promotion** (v1's staged-main flow): incompatible with
  per-environment env vars; traded for same-commit promotion, with instant
  exact-artifact **rollback** retained.

## 14. Decisions to take at implementation

1. Email scrub in the clone: default **on** (recommended) — confirm.
2. Clone cadence: manual button only, or auto-clone on every new candidate?
   (Proposal: manual; validating mid-flow reseeds are disruptive.)
3. Keep Vercel Authentication on preview URLs (proxy bypasses it) — recommended — or off?
4. Promote ceremony: plain confirm vs typing the SHA suffix.
5. Local dev default `DB_SCHEMA=homolog`: adopt immediately in Phase 1?
   (Strongly recommended.)
