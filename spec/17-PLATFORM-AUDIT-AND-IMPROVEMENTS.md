# 17 — Platform audit & improvement pass (July 2026)

A four-track audit (competition management/configuration pages, settings + match
center, performance/DB efficiency, project-wide code quality) followed by an
implementation pass. Everything below marked ✅ landed in this change;
"Deferred" items are documented candidates for later.

## Performance — page load & DB read/write

| Area | Finding | Fix | |
|---|---|---|---|
| Proxy | `getUser()` (20–80ms Supabase Auth HTTP call) ran on EVERY request — including public scoreboards/tablets/results (result discarded) and all `/api/*` (which re-auth themselves), doubling auth latency everywhere | Public-path check now runs before any auth; `/api/*` excluded from the proxy matcher (route handlers refresh cookies themselves) | ✅ |
| Scoring hot path | `POST /events` = ~13 sequential round trips: triple `matches` reads, sequential rate-limit, 2–3 sequential awaited realtime broadcasts | `loadMatchMeta` is one query (match + config + snapshot via LEFT JOIN); authorize/rate-limit/body-parse run in `Promise.all`; broadcasts batched into ONE request sent `after()` the response | ✅ |
| Write amplification | Full `state_snapshot` jsonb (1–50KB) rewritten on **every rally** (~250×/match) | Snapshot refreshed every 5 events + on set/match boundaries + always after UNDO (undo invalidates the cache); cheap derived columns still update per event | ✅ |
| Standings | Loaded **every event row** of every finished match per view (≈5–8k rows for a 30-match comp, incl. the public results page) | Per-set maxima computed in SQL (`GROUP BY match_id, set_number`); three queries parallelized | ✅ |
| Resync backstop | Every open board/scorer polled `/state` (4 queries) every 25s | `GET /state?since=<seq>` answers **204** from one indexed `MAX()` when nothing changed; provider sends `since` when idle | ✅ |
| Interrupt polling | 4s poll per scorer console, forever, even when tablets disabled / match finished; indoor-only UI | 15s poll (realtime is the fast path), stops on FINISHED, gated on `teamTabletEnabled` — and now mounted on **all four** disciplines' consoles (requests were previously invisible outside indoor) | ✅ |
| Indexes | Postgres doesn't auto-index FKs — `matches(competition_id)`, `matches(tenant_id, scheduled_at)`, `teams(competition_id)` etc. were seq scans; `events_match_id_idx` was redundant write amplification on the hottest insert | Added 12 indexes (incl. `matches_knockout_slot` partial unique from spec/14 §E1, now in schema.ts) + FK `teams.pool_id → pools.id`; dropped the redundant events index. Applied to the live DB | ✅ |
| Page waterfalls | Match detail was ~8 sequential steps incl. a duplicate full-log read for the integrity check and an `await` inside JSX; overview fetched full team/match row sets just to render counts | Single `Promise.all`; integrity computed from already-fetched sequences; `competitionCounts()` uses SQL `count()`; teams/schedule/standings pages parallelized; `getAuthContext` runs user+tenant concurrently | ✅ |
| Match detail log | Full unbounded event log (300–450 rows late in a match) server-rendered on every visit | Last 50 events by default + "Show all N" link | ✅ |
| Client bundle | Live scorer statically bundled all four discipline engines + action bars (~2k lines of client JS; only one renders) | Per-discipline `await import()` in the live page — only the needed engine ships | ✅ |
| DB client | No pool bounds → N warm instances × 10 idle conns against the pooler | `max: 5, idle_timeout: 20, connect_timeout: 10` | ✅ |
| List filters | Competitions list filtered discipline/status in JS after fetching all rows | Filters + new name search pushed into the WHERE clause | ✅ |

## Correctness & code quality

- ✅ **Sequence conflicts**: any transaction error was reported as "Concurrent
  write — please retry"; now only Postgres `23505` maps to
  `SequenceConflictError`, real faults propagate.
- ✅ **Client post serialization**: rapid taps on the scorer used to race each
  other server-side for the same sequence number (one 409s); posts now go
  through a per-device promise chain.
- ✅ **Offline flush loop**: the reconnect flush could spin forever on a captive
  portal (failed posts re-queued into the loop it was draining); it now stops on
  the first undelivered post. The offline queue also **persists to
  localStorage** (was silently lost on reload) and shows an "N queued" badge.
- ✅ **Beach provider unified**: the 224-line hand-rolled beach context (already
  drifted: stale error banners) is now a thin wrapper over the shared
  `createMatchProvider`, like indoor/grass/light.
- ✅ **Typed MatchView**: discriminated union on `discipline` — deleted the
  `as unknown as XMatchState` casts in live/tablet pages.
- ✅ **Server-side validation**: scoring rules (best-of ∈ {1,3,5}, set scores
  1–99, players-per-side per discipline), all branding colours (`normalizeHex`),
  board font whitelist, http(s)-only logo URLs, competition status transitions
  (`DRAFT→FINISHED` jumps rejected).
- ✅ **Transactions**: competition+config creation, team+players delete, roster
  import (teams+players all-or-nothing), `setSingleRole` (no more role-less
  member on mid-failure), match delete.
- ✅ **Upserts**: `updateCompetitionConfig` no longer silently no-ops for
  competitions missing a config row.
- ✅ **Event attribution**: scoring events record the signed-in user id
  (`deviceInfo`) — the log is the match's legal record.
- ✅ **Scorer PIN**: verification rate-limited (5/min/user/match); the cookie now
  stores an HMAC of the PIN, not the PIN itself; rotation asks for confirmation
  and warns about lockout.
- ✅ **addMember**: Supabase `listUsers` fallback paginates (used to silently
  scan only the first page).
- ✅ **Shared modules**: `form-data.ts` (FormData helpers — were copy-pasted in
  5 files), `action-gate.ts` (competition gate — 4 drifting copies),
  `domain.ts` (discipline/gender/status constants + transitions — were
  triplicated), `match-number.ts` (SQL `MAX()` — was 2 copies fetching all rows).
- ✅ **Dead code removed**: `importTeams`, `importPlayers`, `listPools`,
  `loadMatchStateFresh` alias, `uuid` + `@types/uuid` dependencies.
- ✅ **CSV**: import failures surface the constraint/detail instead of a generic
  message; the roster template's "John Doe" example row is skipped **by
  content** (the old importer silently discarded the first data row of every
  clean file); downloadable templates added.
- ✅ Rate-limiter outages now report to Sentry instead of failing open silently;
  `npm run typecheck` script added.
- ✅ New unit tests: standings (pool scoping, tiebreakers, aggregation),
  form-data helpers (UTC round-trips, tri-state), domain transitions.
  129 tests total (was 111).

## UX / workflow

- ✅ **No more silent no-ops**: all 13 `Promise<void>` server actions (delete
  team/match, save rules, pools, bracket, sessions, roles…) return `FormState`;
  a shared `<ActionForm>` renders inline errors and a transient "Saved ✓" on
  every form. Guard failures now explain themselves ("This team appears in a
  match…", "This is the tenant's last admin…").
- ✅ **Confirmations** on every destructive action (delete team/player/match,
  status changes, bracket generation, round-robin, pool distribute/delete,
  token revoke, PIN rotate).
- ✅ **Pool-aware round robin**: with pools assigned, fixtures generate per pool
  (roundName = pool name) — previously 2 pools of 4 produced 28 cross-pool
  fixtures; standings tables now count intra-pool matches only (knockout
  results no longer pollute pool tables). Pools gained rename/delete,
  serpentine distribute-by-seed, and one "save all assignments" form
  (was one round trip per team).
- ✅ **Teams**: bulk add (one per line), players editable in place (were
  delete-and-re-add only), per-row a11y labels/ids, jersey-dup checks on edit.
- ✅ **Match center**: pinned "Live now" section, auto-refresh every 20s while
  matches are live, explicit Manage / Score / Board links per row (the card's
  role-dependent destination was invisible), empty states with a next action.
- ✅ **Times**: rendered in the viewer's local timezone with UTC in the tooltip
  (were raw UTC strings); schedule/create forms label UTC entry explicitly.
- ✅ **Competition pages**: shared header (breadcrumb + status badge + public
  results/CSV links on every tab — subpages had drifted), schedule grouped by
  round with finished rounds collapsed, gender editable post-creation,
  serve-clock/TTO are tri-state (Default/On/Off — a saved checkbox used to
  freeze the default as a permanent override), auto-submitting filters + name
  search.
- ✅ **Settings**: grouped sections (General / Branding / People & security);
  removed internal dev notes ("see Phase 10/11", "string sweep… incremental")
  and the dead custom-domain card; language switcher honestly labelled as
  per-browser; temp passwords auto-hide after 60s and "Copied" resets per
  member; tablet token URLs replaced with a Copy-link button (screenshots
  leaked live credentials).
- ✅ **Match detail**: QR/tablet card hidden when the competition has tablets
  disabled; error/404 boundaries (`error.tsx`, `global-error.tsx`,
  `not-found.tsx`) with Sentry reporting.
- ✅ Mobile: add-forms order before empty lists (the empty state used to say
  "add one on the right" with the form below the fold); all key pages verified
  at 390×844 with no horizontal overflow.

## Verification

- 129/129 unit tests, lint, `tsc --noEmit`, production build.
- 36-check end-to-end pass against a local production build with the live DB:
  auth redirect + login, competition create/configure (incl. validation),
  bulk team add + inline edit, pool create/distribute/save-all, pool-aware
  round-robin, PIN generate + gate, full beach scoring flow (setup → coin toss
  → start → points → undo), public scoreboard consistency after undo, live
  match-center section, settings/access/audit, and 7 mobile-viewport checks.
- Index/FK DDL applied to the production database after verifying no dangling
  `pool_id`s or knockout-slot duplicates existed.

## Notable decision: no route-level `loading.tsx`

Route-level `loading.tsx` skeletons were added and then **removed**: under
Next 16.2.9, their Suspense boundaries intermittently wedged server-action
transitions (the POST returned 200 in <1s but the router never applied the
result — forms stuck on "Working…"). Reproduced reliably with them, gone
without them; revisit on a future Next upgrade.

## Deferred (documented, not implemented)

- **Engine core extraction** (~750 duplicated lines across the four reducers:
  win conditions, append/replay orchestration, ~12 identical cases) — largest
  payoff, wants the standings/action test net that now exists; do as its own
  change.
- ActionBar/Scoreboard/LineupEntry consolidation (Grass/Light ~90% identical);
  shared `Banner/Primary/Score/Secondary` sub-components duplicated in all four
  bars.
- Migrations baseline (`drizzle-kit generate` 0000 + migrate-only deploys) —
  the repo still uses the push workflow; note `drizzle-kit push` currently
  crashes on a CHECK-constraint introspection bug, DDL was applied explicitly.
- i18n sweep beyond the shell (scoring surfaces are hardcoded English).
- Pagination on tenant-wide match/competition lists; `unstable_cache` on public
  results of finished competitions; per-court scorer day-PINs; coin-toss side
  selector; seed-from-standings bracket option; match-engine integration tests
  (pg-backed); `getClaims()` local JWT verification in the proxy.

---

# Batch 2 — deferred items implemented (July 2026)

Everything from the "Deferred" list above except where noted, plus a scorer-
reported bug:

- **Undo vs TTO (bug fix)**: undoing now targets the last *scorer* event plus
  every auto-emitted consequence in its batch (`selectUndoTargets`, tested) —
  previously undo during a TTO removed only the auto-emitted `TTO_START`
  (mis-tapped point survived), undo after ending it removed `TTO_END`
  (straight back into the TTO), and undoing only the rally left the surviving
  `TTO_START` replaying the match back into TTO. The beach TTO banner also
  gained an "Undo last point" button. Verified end-to-end in a browser.
- **Engine core extraction**: `src/engine/core/` (winConditions, baseReducer
  with the 19 identical cases, append/replay factories); 1,123 duplicated
  lines deleted across the four reducers (−395 net). Replay compatibility
  proven by a differential fuzz (240 simulated matches, old vs new engine,
  deep-equal states and event logs).
- **Scoring UI consolidation**: `src/components/scoring/shared/`
  (useArmedConfirm, buttons, PhaseBanners, LiveControls, RotationScoreboard/
  LineupEntry); the four action bars shrank 1,371 → 486 lines (−397 net).
- **Coin-toss side selector**: the toss now records which side team A actually
  starts on (two-step banner) instead of hardcoding LEFT.
- **i18n sweep**: ~265 new keys × 5 locales (en/fr/de/es/pt) across scoring
  consoles, competition admin surfaces, match centre, access/audit; new
  `{placeholder}` interpolation; `useT()` falls back to English outside a
  LocaleProvider. Still English: server-action FormState messages, engine
  validator reasons, audit summaries, CSV headers, role/status enum labels.
- **Seed from standings**: one click writes the Seed column rank-major across
  pools (winners first) before generating the bracket.
- **Scorer QR deep-link**: match detail shows a QR + copy-link whose
  `?key=<HMAC of PIN>` pre-satisfies the PIN gate (login + role still
  required); rotating the PIN revokes it.
- **Set-up checklist** on DRAFT competition overviews (teams → pools →
  schedule → activate).
- **Pagination** on the tenant-wide match list (50/page, filter-preserving).
- **Public results caching**: FINISHED competitions serve from a 5-minute
  `unstable_cache` (tag `results:{id}`); results.csv gets CDN
  `s-maxage=300` once all matches are finished.
- **Proxy `getClaims()`**: local ES256 JWT verification against the project's
  JWKS replaces the per-request Auth round trip for page navigations.
- **Migrations baseline**: migration `0000` committed and marked applied in
  prod (`drizzle.__drizzle_migrations`); `db:migrate` fixed (it was broken —
  top-level await under CJS — i.e. untested) and verified as a clean no-op.
  Future schema changes: `db:generate` + `db:migrate`, not push.
- **New pure-logic tests**: `selectUndoTargets`, `shouldSnapshot` (snapshot
  write policy). Suite: 136 tests.

Verified: 136 unit tests, lint, tsc, production build, and a 27-check browser
functional pass (auth → competition setup → pools → pool-aware round-robin →
PIN + deep-link → live beach scoring with the TTO-undo path → public
scoreboard consistency → mobile viewports). QA data and the temporary QA
admin were removed afterwards.

Note for future test automation: the events endpoint rate-limits ~30 posts/10s
per scorer — scripted scoring must be human-paced or it gets designed 429s.
