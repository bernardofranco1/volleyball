# spec/28 — Homologation → Production releases (own URL, one DB, one project)

**Status: COMPLETE 2026-08-13.** Phases 0, 1 and 2 are live and verified end
to end. **Phase 3 (the one-URL switch) is DROPPED by decision** — homologation
keeps its own hostname. Nothing in the plan is outstanding.

**The pipeline as it stands today:** a push to `main` builds a PREVIEW
deployment on the `homolog` tables, reachable at
`https://volleyball-homolog.vercel.app` (stable alias) and carrying the amber
banner. It cannot reach the production domain. Promoting = fast-forward
`release` to the validated SHA, wait for the staged production build, then
`POST /v10/projects/{prj}/promote/{dpl}`. Rollback = the same call on an older
production deployment. `GET /api/version` on any URL reports commit, branch,
Vercel target and which schema it is serving.

Written 2026-08-13; **revised the same day (v2)** after review: homologation
gets **its own tables in the same database** (a `homolog` Postgres schema),
selected per environment by an env var. This supersedes v1's shared-tables
model and its homolog-tenant idea, and it demotes the expand/contract migration
law from "always" to "promote-window and rollback safety only".

## 0. What is built (Phase 1)

`DB_SCHEMA` (`public` | `homolog`) selects the tables, applied as the
connection's `search_path`; no query in the app changed. Verified on the live
database:

- `search_path` survives **both** Supabase poolers — transaction mode included,
  which v2 had flagged as unverified. Homolog therefore needs no special
  connection string.
- The path is a **single application schema with no `public` fallback**. With
  `homolog,public`, a table missing from the clone would silently resolve
  against production data; with one entry it errors instead.
- A **fail-closed boot check** (`assertDbSchema`, called from
  `instrumentation.register`) refuses to start a non-production deployment
  whose connection does not actually resolve to its schema.
- `scripts/clone-prod-to-homolog.ts` rebuilds the clone in ~6s (25 tables,
  9.8k rows, 44 foreign keys re-pointed inside `homolog`, RLS parity, journal
  seeded, emails scrubbed to `@homolog.invalid` outside an allow-list).
- Two migration journals: `drizzle.__drizzle_migrations` (production) and
  `drizzle_homolog.__drizzle_migrations`. `db:migrate` now **requires**
  `--env homolog|prod` — inheriting the local default would have made the old
  "migrate production" command quietly migrate the clone.
- Advisory-lock keys and Realtime channel names are namespaced per environment
  (`envKey`, `src/lib/realtime-topics.ts`); both are global to the database /
  project and the clone shares production's ids.
- The amber banner renders from `DB_SCHEMA` alone — a production build cannot
  show it and a homolog build cannot hide it.

Proven end to end in a browser: a competition created through the UI in
homologation appeared in `homolog.competitions` and **never** in `public`;
production row counts were unchanged throughout; the production build shows no
banner and reads production data.

## 1. Goal

- A push to `main` lands in **Homologation**, never directly in production.
- Homologation runs against **its own tables** — same database, so still one
  Supabase project — and production tables are untouched by testing.
- Once validated, the version is **promoted to production from a UI** that
  shows which version sits where; the same UI does rollback.
- **Homologation has its own hostname** (`volleyball-homolog.vercel.app`),
  with an amber bar on every one of its surfaces. Decided 2026-08-13 in
  preference to serving both versions from the canonical address — see §8.

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
4. ~~Protection Bypass for Automation for the one-URL proxy.~~ Not needed —
   Phase 3 was dropped (§8), and it turned out not to be offered on this plan
   anyway.
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

## 4. Two pointers, one project

| Pointer | Meaning | Moved by |
|---|---|---|
| **Production** | which deployment `volleyball-eight.vercel.app` serves everyone (schema `public`) | *Promote* in the console |
| **Homologation** | which candidate `volleyball-homolog.vercel.app` serves (schema `homolog`) | *Set as homolog* in the console |

(A third pointer — a per-browser cookie choosing which version the canonical
address served — was the dropped Phase 3. See §8.)

**Promote, as built — TWO console steps, not one button.** A single action
would have to wait ~2 minutes for the build and would hit the Server Action
timeout, so the flow is split (and is clearer for it — you watch the artifact
go green before anything points users at it):

*Prepare release* (on a validated candidate)
1. `POST /v13/deployments` with `target: production` and the candidate's SHA →
   Vercel builds the production flavour of that commit, staged. Returns
   immediately; the page auto-refreshes while it builds.

*Promote* (once that build is READY)
2. Guards: LIVE-match warning; **hard block** if `public` is behind the repo on
   migrations (the operator runs `npm run db:migrate:prod` — deliberately a
   separate, human act, never automated inside a promotion); confirm.
3. Full backup of every tenant.
4. Promote API → the domain flips. `releases` row + platform audit entry.

Note what is NOT here: no GitHub token and no `release`-branch fast-forward.
Building straight from a SHA needs one credential instead of two. The `release`
branch still exists as Vercel's nominal production branch (that is what makes
`main` pushes build as previews), it just no longer has to move.

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

Actions as built: *Set as homolog* (moves the alias onto a candidate),
*Prepare release*, *Promote*, *Roll back to this*. Everything audit-logged
(platform-level rows, spec/26 convention). Refreshing the homologation data is
a CLI command rather than a button — `npm run db:clone:homolog -- --execute` —
because it drops and rebuilds a schema and deserves a shell, not a click.

New table `releases`: `id, deployment_id, sha, message, promoted_at,
promoted_by, previous_deployment_id, migration_state, note`.

## 8. Two hostnames, and the banner

Homologation lives at its own address:

| | |
|---|---|
| Production | `volleyball-eight.vercel.app` — schema `public` |
| Homologation | `volleyball-homolog.vercel.app` — schema `homolog`, amber bar |

**Banner detection is trivial and unspoofable:** the build either was made with
`DB_SCHEMA=homolog` or it was not. A production build cannot render the bar and
a homologation build cannot hide it. No cookies, hosts or database reads are
involved, and it covers every surface including the scorer console and tablets.

### Why not one URL (decision, 2026-08-13)

The original plan served both versions from the canonical address, switched by
a signed cookie that made `proxy.ts` rewrite to the candidate. **Dropped**, and
the reasons are worth keeping because they argue against rebuilding it later:

- **It was the only piece needing a Vercel plan upgrade.** The proxy has to
  authenticate itself to the protected candidate with a Protection Bypass for
  Automation secret, which this plan does not offer.
- **It put a rewrite branch on the hot path.** The proxy matcher would have had
  to widen to `_next/static`, images and `/api/*` — the very paths spec/17
  deliberately excluded from proxy work — to proxy a candidate's assets.
- **Two addresses are clearer, not worse.** "Which version am I on" is
  answered by the address bar before the page even renders, and a stale tab
  cannot silently be the wrong environment. The amber bar remains as the
  in-page confirmation.
- **The thing it was really solving** — validating against realistic data — is
  solved by the schema clone, not by the URL.

What is lost: you cannot hand someone a single link that shows them "the same
page, but the new version", and homologation URLs are Vercel-SSO protected, so
only people on the Vercel team can open them. If a non-Vercel colleague ever
needs to validate, the options are to add them to the team or to turn off
`ssoProtection` for preview deployments (the app has its own login regardless).

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

- **Phase 2 — release console. ✅ DONE 2026-08-13.** `/admin/releases`
  (global admins only), `releases` table (migration 0018), `src/lib/vercel.ts`
  (hand-rolled API client), `src/lib/releases.ts` (history + guards),
  `src/lib/release-actions.ts`.

  Promotion is **two explicit steps**, because building takes ~2 minutes and a
  Server Action that waited would hit the function timeout: *Prepare release*
  starts the production build of a validated commit and returns; *Promote* backs
  up every tenant, flips the domain, writes a `releases` row and a
  platform-level audit entry. Rollback is the same call on an older production
  build and is recorded as `ROLLBACK`.

  Guards that actually fired in testing: a **live-match warning** naming the
  matches being scored (7 at the time), and a **hard block** when production is
  behind the repo on migrations — promoting then would serve code against a
  schema without its columns.

  Verified end to end through the UI: promoted `28686b6`, production moved;
  three tenant backups recorded OK *before* the domain moved; rolled back to
  `cd1d068`; the history distinguishes PROMOTE from ROLLBACK. Config lives in
  `RELEASE_TOKEN` / `RELEASE_TEAM_ID` / `HOMOLOG_ALIAS` — deliberately NOT
  `VERCEL_*`, since Vercel injects `VERCEL_PROJECT_ID` and `VERCEL_GIT_REPO_ID`
  itself and a same-named user variable would shadow them.

- **Phase 1 — schema split. ✅ DONE 2026-08-13.** Shipped as described in §0.
  Local development now defaults to `DB_SCHEMA=homolog`.
- **Phase 0 — settings. ✅ DONE 2026-08-13.** `release` branch created;
  Vercel production branch → `release`; *Auto-assign Custom Production
  Domains* → off; `DB_SCHEMA` + `NEXT_PUBLIC_DB_SCHEMA` = `homolog` on the
  **Preview** environment; stable alias `volleyball-homolog.vercel.app`;
  `/api/version` probe added. Verified live: a `main` push built as a preview
  and production kept serving the previous build; a `release` push built and
  sat READY *without* taking the domain; promote flipped it; rollback to the
  previous deployment flipped it back (~15 s) and forward again.

  Two findings worth recording:
  - **The production branch is not settable through the public API.** PATCH
    `/v9/projects/{id}` rejects `link`, `productionBranch` and
    `gitProductionBranch`. The dashboard uses an undocumented
    `PATCH /v9/projects/{id}/branch` with `{"branch":"release"}`, which works
    and is what was used. Unsupported by Vercel — if it ever breaks, the same
    change is one click in Settings → Git.
  - **Protection Bypass for Automation is not available on this plan** —
    every documented endpoint shape returns `not_found`. With Phase 3 dropped
    this costs one thing only: candidate URLs are reachable in a browser by
    Vercel-team members but not by scripts, so a candidate cannot be
    smoke-tested automatically the way production can. Validation of a
    candidate is therefore a human opening the homologation URL.
- **Phase 1 — schema split (~1 day).** `DB_SCHEMA` plumbing, clone script,
  dual journals, banner, `.env.local` → homolog. Validate by cloning and
  driving the app on a preview URL end-to-end (spec/27 QA pattern).
- **Phase 2 — release console (~1 day).** `releases` table, promote
  orchestration (backup → ff → poll → migrate → flip), rollback, guards,
  audit.
- **Phase 3 — one-URL switch. ❌ DROPPED 2026-08-13** by decision (§8):
  homologation keeps its own hostname. No code was written for it.
- **Phase 4 — optional, not done.** Migration CI lint (flag
  `DROP`/`RENAME`/`SET NOT NULL` without a `-- contract-ok:` marker) and the
  "new version — reload" beacon for promote-time skew. Both remain worthwhile;
  neither blocks anything.

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
- **One URL for both versions** (v1/v2 Phase 3): dropped 2026-08-13 — see §8
  for the reasoning. Homologation keeps its own hostname.

## 14. Decisions to take at implementation

1. Email scrub in the clone: default **on** (recommended) — confirm.
2. Clone cadence: manual button only, or auto-clone on every new candidate?
   (Proposal: manual; validating mid-flow reseeds are disruptive.)
3. ~~Keep Vercel Authentication on preview URLs?~~ **Settled**: kept ON. With
   Phase 3 dropped nothing needs to bypass it, so homologation stays private to
   the Vercel team. Revisit only if someone outside the team must validate.
4. Promote ceremony: plain confirm vs typing the SHA suffix.
5. Local dev default `DB_SCHEMA=homolog`: adopt immediately in Phase 1?
   (Strongly recommended.)
