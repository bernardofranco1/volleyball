# 14 — Remediation Plan (Code-Review Fixes)

Precise, implementation-ready instructions to fix every issue from the staff
review. Ordered by dependency, not just severity, so fixes compose instead of
conflicting. Each item: **what**, **where**, **how** (concrete code), **why this
approach** (design decision), **test**, **done-when**.

> Conventions: production DB changes use `drizzle-kit generate` + `db:migrate`,
> **never `push`** (spec/12). Match the existing helper/idiom style. After every
> workstream: `tsc` + `eslint` + `vitest` + `next build` must stay green.

## Migrations introduced (run in this order)

1. `matches`: add `state_snapshot jsonb`, `snapshot_sequence integer not null default 0` (M1).
2. `matches`: partial unique index `(competition_id, round_name, match_number)` for knockout rounds (M4).
3. Drop table `lineup_submissions` (L1).
4. (Optional) `matches.scheduled_at` → `timestamptz` (M6 long-term).

Generate one migration per logical change: `npm run db:generate` after each
schema edit, review the SQL, then `npm run db:migrate`.

---

# Workstream A — Authorization & API hardening (C1, C2, H1, H4)

The keystone. Everything in the match API currently checks *authentication*
only. Build one server-side authorization primitive and reuse it everywhere.

## A1 (C1) — Authorize every match route + the live page

**Where:** `src/lib/authz.ts` (new helpers), then `events`, `export.pdf`,
`interrupt-requests` routes, and `.../matches/[matchId]/live/page.tsx`.

**How.** Add to `authz.ts`:

```ts
import { cache } from "react";
import { matches } from "@/db/schema";

// One getUser network call per request (M3 too).
export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export interface MatchAuth {
  user: { id: string; email: string | null };
  tenantId: string;
  roles: Role[];
}
export type MatchAuthResult =
  | { ok: true; auth: MatchAuth }
  | { ok: false; status: 401 | 403 | 404 };

/** Resolve the match's tenant and the caller's role in it. No throw/redirect. */
export async function authorizeMatch(
  matchId: string,
  allowed: Role[],
): Promise<MatchAuthResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401 };
  const row = (
    await db.select({ tenantId: matches.tenantId })
      .from(matches).where(eq(matches.id, matchId)).limit(1)
  )[0];
  if (!row) return { ok: false, status: 404 };
  const roleRows = await db.select({ role: userTenantRoles.role })
    .from(userTenantRoles)
    .where(and(eq(userTenantRoles.userId, user.id),
               eq(userTenantRoles.tenantId, row.tenantId)));
  const roles = roleRows.map((r) => r.role as Role);
  if (!hasRole(roles, allowed)) return { ok: false, status: 403 };
  return { ok: true, auth: { user: { id: user.id, email: user.email ?? null }, tenantId: row.tenantId, roles } };
}

/** Page variant: redirect on 401, notFound on 403/404 (don't reveal existence). */
export async function requireMatchRole(
  matchId: string, allowed: Role[], loginDest?: string,
): Promise<MatchAuth> {
  const r = await authorizeMatch(matchId, allowed);
  if (r.ok) return r.auth;
  if (r.status === 401)
    redirect(loginDest ? `/login?redirectTo=${encodeURIComponent(loginDest)}` : "/login");
  notFound();
}
```

Use in **`events` POST**:
```ts
const auth = await authorizeMatch(id, ["SCORER", "COMPETITION_ADMIN"]); // TENANT_ADMIN auto-allowed by hasRole
if (!auth.ok) return Response.json({ error: "Forbidden" }, { status: auth.status });
const { state, newEvents } = await appendMatchEvent(id, body.payload, { actor: "SCORER" });
```
Same pattern in **`export.pdf`** (allow `["SCORER","COMPETITION_ADMIN"]` — any tenant member) and **`interrupt-requests` PATCH** (`["SCORER","COMPETITION_ADMIN"]`). In the **live page**, replace the bare `getUser` guard with:
```ts
await requireMatchRole(matchId, ["SCORER", "COMPETITION_ADMIN"],
  `/t/${tenantSlug}/competitions/${competitionId}/matches/${matchId}/live`);
```

**Why.** Authorization must be keyed to the *match's* tenant (server-derived),
not the URL or the user's "primary" tenant. A pure resolver (`authorizeMatch`)
serves API routes (return a status); a redirect/notFound wrapper serves pages.
TENANT_ADMIN remains a superuser via the existing `hasRole`.

**Test.** New `src/__tests__/api/authz.test.ts` (or route test): user with no role
in the match's tenant → 403; user from another tenant → 403; unauth → 401;
unknown match → 404; SCORER of the tenant → 200.

**Done when.** No match route or scoring page reaches `appendMatchEvent`/render
without a passing `authorizeMatch`/`requireMatchRole`.

## A2 (C2) — Reject engine-internal events from the client API

**Where:** `src/app/api/matches/[id]/events/route.ts` (boundary), and harden each
validator's `default` (defense in depth).

**How.** At the route, after parsing `body.payload`:
```ts
const CLIENT_SUBMITTABLE = new Set([
  "MATCH_CREATED","COIN_TOSS","MATCH_START","SET_START","LINEUP_CONFIRMED",
  "RALLY_WON_A","RALLY_WON_B","REPLAY_POINT","TIMEOUT_REQUEST","TIMEOUT_END",
  "TTO_END","SUBSTITUTION","LIBERO_REPLACEMENT","LIBERO_REDESIGNATION",
  "VCS_CHALLENGE","VCS_RESULT","JUMP_SERVE_FOOT_FAULT","ATTACK_ARC_FAULT",
  "DELAY_WARNING","DELAY_PENALTY","MEDICAL_TIMEOUT","MEDICAL_TIMEOUT_END",
  "MISCONDUCT_WARNING","MISCONDUCT_PENALTY","MISCONDUCT_EXPULSION",
  "MISCONDUCT_DISQUALIFICATION","NOTE","UNDO",
]);
if (!CLIENT_SUBMITTABLE.has(body.payload.type))
  return Response.json({ error: "Event type not accepted" }, { status: 422 });
```
Excludes the auto-emitted/system set: `SET_END`, `MATCH_END`, `SIDE_SWITCH`,
`TTO_START`, `SERVE_CLOCK_EXPIRE`. In each validator, change `default: OK` →
`default: fail("unsupported event")` and add explicit `case` for any client
event currently relying on the default (re-run engine tests; add cases as the
tests demand).

**Why.** `SET_END`/`MATCH_END` are the results-*import* path. Exposing them on
the live API lets a scorer fabricate a set/match result in one request. Keep
those internal to the seed/import; the live API only takes "real" actions and
lets the engine auto-emit consequences.

**Test.** `events` route test: posting `{type:"SET_END",...}` → 422; posting
`RALLY_WON_A` → accepted. Engine tests still green after `default` hardening.

## A3 (H1) — Sanitize the login redirect

**Where:** `src/lib/auth-actions.ts`.

**How.**
```ts
function safeRedirect(dest: string): string {
  // same-origin absolute path only; block //host and /\ tricks
  return /^\/(?!\/|\\)/.test(dest) ? dest : "";
}
// in login():
let destination = safeRedirect(redirectTo);
if (!destination) { const slug = await getUserPrimaryTenantSlug(...); destination = slug ? `/t/${slug}/dashboard` : "/"; }
```

**Why.** `redirectTo` is attacker-supplied (`?redirectTo=`). Only relative,
non-protocol-relative paths may be honored.

**Test.** `auth-actions` unit: `safeRedirect("https://evil.com")===""`,
`safeRedirect("//evil")===""`, `safeRedirect("/t/x/dashboard")` passes.

## A4 (H4) — Origin check + SameSite on the JSON mutation routes

**Where:** `events` POST, `lineup` POST, `interrupt-requests` POST/PATCH; one
shared helper `src/lib/http.ts`.

**How.**
```ts
export function sameOriginOk(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-CORS (same-site form/navigation) — JSON body already guards
  try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
}
```
Call at the top of each mutation route; `403` on mismatch. Also set the Supabase
auth cookie `sameSite: "strict"` (or "lax") via the `@supabase/ssr` cookie
options in `src/lib/supabase.ts` / `src/proxy.ts` `setAll`.

**Why.** Defense in depth with C1. The `req.json()` requirement already blocks
classic form-CSRF; an explicit Origin check + strict cookie closes the gap
without a token scheme.

---

# Workstream B — Realtime trust (H2)

**Decision:** treat the realtime transport as **untrusted**. Don't authorize the
channel with bespoke crypto; instead make broadcasts a *signal*, with the
(now-cheap, post-M1) `/state` endpoint as the authority. Add Supabase Realtime
Authorization as defense-in-depth.

## B1 — Broadcast = "something changed", client refetches authoritative state

**Where:** `src/lib/realtime.ts`, all four `*-match-context.tsx`,
`ScoreboardDisplay.tsx`, `TeamTablet.tsx`.

**How.** Server `broadcastState` sends only `{ lastSequence }` (no full state).
Clients, on `state-update`, compare `lastSequence` and if newer call the existing
`resync()` (`GET /state`) which is authoritative. Forged broadcasts then cause at
most a harmless refetch that returns true DB state.

```ts
// realtime.ts
export async function broadcastState(matchId: string, lastSequence: number) {
  await broadcast([{ topic: `match:${matchId}`, event: "state-update", payload: { lastSequence } }]);
}
// provider on("state-update"): if (payload.lastSequence > stateRef.current.lastSequence) void resync();
```
Keep `serve-clock-start` as-is (ephemeral, low stakes) or sign it.

**Why.** Removes *trust* from the transport entirely and dovetails with M1
(snapshots make `/state` O(tail)). Also shrinks broadcast payloads (perf) and
fixes the optimistic/broadcast double-apply. This is strictly better than trying
to make the public channel tamper-proof while still allowing anon reads.

## B2 — Realtime Authorization (defense in depth)

**Where:** Supabase SQL migration + client `.channel(..., { config: { private: true } })`.

**How.** Mark `:scorer` and `:team-*` channels `private: true` on the client; for
those, the browser client must `supabase.realtime.setAuth()` (session JWT).
Enable RLS on `realtime.messages` and add policies:
```sql
alter table realtime.messages enable row level security;
-- receive only; clients may never broadcast (only service_role, used server-side)
create policy "recv match public" on realtime.messages for select
  to anon, authenticated using ( realtime.topic() like 'match:%' and realtime.topic() not like '%:scorer' and realtime.topic() not like 'match:%:team-%' );
create policy "recv scorer" on realtime.messages for select
  to authenticated using ( realtime.topic() like 'match:%:scorer' );
-- no INSERT policy => clients cannot send; server uses the service key (bypasses RLS)
```
(Per-tenant restriction of `:scorer` is a follow-up via a `security definer`
function mapping topic→match→`user_tenant_roles`.)

**Why.** B1 already neutralizes the impact; B2 stops anon snooping/forgery at the
broker. Both are cheap together.

**Test.** Manual: a second anon client cannot `send()` to `match:{id}`; a forged
`state-update` does not change the scorer's displayed score (it refetches truth).

---

# Workstream C — State management & performance (M1, M2, M5, L6)

## C1 (M1+M2) — Snapshot the replayed state; bound replay; drop the leaky cache

**Where:** `src/db/schema.ts`, `src/lib/match-engine.ts`.

**How.**
1. Schema: `matches.stateSnapshot jsonb`, `matches.snapshotSequence integer notNull default 0`. Migration.
2. `appendMatchEvent`: wrap the events insert + matches update in a **transaction**, and write the snapshot in the same update:
```ts
await db.transaction(async (tx) => {
  await tx.insert(events).values(rows);
  await tx.update(matches).set({
    setsWonA: finalState.setsWonA, setsWonB: finalState.setsWonB,
    winner: finalState.winner, status: meta.engine.matchStatusOf(finalState),
    stateSnapshot: finalState, snapshotSequence: finalState.lastSequence,
    ...(finalState.matchStartedAt ? { startedAt: new Date(finalState.matchStartedAt) } : {}),
    ...(finalState.status === "FINISHED" ? { finishedAt: new Date() } : {}),
  }).where(eq(matches.id, matchId));
});
```
3. Replace `loadCommonState`/`loadMatchStateFresh` with snapshot + tail replay:
```ts
async function loadFromSnapshot(matchId, meta) {
  const row = (await db.select({ snap: matches.stateSnapshot, seq: matches.snapshotSequence })
    .from(matches).where(eq(matches.id, matchId)).limit(1))[0];
  let state = row?.snap ? (row.snap as CommonMatchState) : meta.engine.replay(matchId, [], meta.config);
  const baseSeq = row?.snap ? (row.seq ?? 0) : 0;
  const tail = await db.select(...).from(events)
    .where(and(eq(events.matchId, matchId), gt(events.sequence, baseSeq))).orderBy(asc(events.sequence));
  for (const e of tail) state = meta.engine.reduce(state, e, meta.config);
  return state;
}
```
4. Delete the module-level `stateCache` Map (and its get/set/delete). Snapshots
   are the cache, persisted and cross-instance.
5. In reducers, replace `JSON.parse(JSON.stringify(x))` with `structuredClone(x)`.

**Why.** Event sourcing is fine; *unbounded replay on every read* is not. A
snapshot row makes reads O(events-since-last-write) ≈ 0–2, works across serverless
instances (unlike the in-memory Map), and removes the cache/replay divergence
that hid the Phase-10 TTO bug. Snapshot is a *cache validated by sequence* — if
absent/behind, tail replay (or full replay) self-heals, so correctness never
depends on it. The transaction removes torn writes.

**Test.** Integration: append N events, assert `loadFromSnapshot` equals a full
`replayEvents`; corrupt/clear the snapshot and assert it still reconstructs.

## C2 (M5) — Remove the dead SSE endpoint; rate-limit; gate spectators to realtime

**Where:** `src/app/api/matches/[id]/events/route.ts` (delete `GET`), new limiter.

**How.**
1. **Delete the `GET` (SSE) handler** — verified unused (no `EventSource`
   consumer; clients poll `/state`). Removes the 60s replay-loop DoS surface and
   ~60 lines of dead code in one stroke.
2. Add rate limiting (serverless-safe) with `@upstash/ratelimit` + Upstash Redis,
   keyed by `ip:matchId`, on `events` POST, `lineup` POST, `interrupt` POST/PATCH,
   and `/state` GET. Example wrapper `src/lib/ratelimit.ts`:
```ts
const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, "10 s") });
export async function rateLimit(key: string) { return (await limiter.limit(key)).success; }
```
   Return `429` when exceeded. If you don't want a Redis dependency yet, document
   it as a required Phase-11 prerequisite and add a minimal per-instance LRU
   limiter as a stopgap (note: not effective across instances).
3. `/state` stays public (scoreboard) but is now cheap (C1) and rate-limited.

**Why.** The biggest DoS lever (expensive unauthenticated SSE replay loop) is
*dead code* — deleting it is the best fix. Rate limiting protects the rest.

## C3 (L6) — Stop re-querying immutable match meta per append

**Where:** `match-engine.ts` `loadMatchMeta`.

**How.** Wrap in React `cache()` (per request) or fold the discipline/config read
into the snapshot read (single query). Discipline + resolved config never change
for a match.

---

# Workstream D — Auth round-trips (M3)

**Where:** `authz.ts`, `proxy.ts`, tenant layout.

**How.** (a) `getCurrentUser` via `cache()` (added in A1) — every server caller
shares one `getUser()`. (b) `requireRole` must call `getCurrentUser()` once and
**not** re-call inside `getAuthContext` (refactor `getAuthContext` to accept the
user, or build it from `getCurrentUser`). (c) Wrap `getTenantBySlug` in `cache()`
so layout + page share one query. (d) In `proxy.ts`, use a session/claims check
for the optimistic redirect rather than a full `getUser()` network validation
(`getClaims()`), since real authz happens server-side anyway.

**Why.** Today an admin page does ~3 `getUser()` network round-trips + 2
`getTenantBySlug`. Request-scoped memoization removes the duplicates; the proxy
only needs an optimistic check.

**Test.** Add a counter/spy in a unit test asserting `getUser` is invoked once per
`requireRole`.

---

# Workstream E — Correctness fixes (M4, M6, M8, M9)

## E1 (M4) — Serialize bracket generate/advance

**Where:** `src/lib/tournament-actions.ts`.

**How.** Wrap `generateBracket` and `advanceBracket` bodies in a transaction with
a per-competition advisory lock, and add the partial unique index:
```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${competitionId}))`);
  // ...existing read-then-insert logic using tx...
});
```
Migration: `create unique index matches_knockout_slot on matches (competition_id, round_name, match_number) where round_name in ('Round of 64',...,'3rd Place');`

**Why.** Two concurrent "advance" clicks both see the next round absent and both
insert it. The advisory lock serializes the read-modify-write; the unique index
is a backstop.

## E2 (M6) — Treat schedule times as UTC explicitly

**Where:** `src/lib/schedule-actions.ts` `dateTimeOrNull`, `csv-actions.ts` date parse.

**How.** `datetime-local` yields `YYYY-MM-DDTHH:mm` (no zone). Parse as UTC:
```ts
const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + "Z");
```
The schedule UI already labels/prefills UTC (`toISOString().slice(0,16)`), so this
makes the round-trip exact on any server TZ. Long-term: migrate `scheduled_at` to
`timestamptz`.

**Why.** `new Date("…T10:00")` is parsed in the *server's* local zone; correct only
by accident on UTC hosts. Be explicit.

## E3 (M8) — Don't let the libero rotate into the front row / serve

**Where:** `src/engine/indoor/reducer.ts` (`applyPoint`/`reduce` rotation path) +
`src/__tests__/engine/indoor.test.ts`.

**How.** After a side-out rotation, if the acting libero is on court and its new
court index is front-row (`1,2,3`) or position 1 (serve), auto-emit a
`LIBERO_REPLACEMENT { direction:"OUT" }` so the replaced back-row player returns
before front-row/serve. Model it as a system auto-emit (like `SIDE_SWITCH`) so
replay reproduces it. Validate against FIVB Rule 19.3.

**Why.** Rotation currently shifts the libero with everyone; the engine can
produce an illegal lineup (libero front row, or serving). This is engine-computed
state, not a referee judgment, so the engine must keep it legal.

**Test.** Rotate a team with the libero on court until the libero would reach
front row; assert an auto `LIBERO_REPLACEMENT OUT` fired and the original player
is back.

## E4 (M9) — Validate pool belongs to the competition

**Where:** `src/lib/tournament-actions.ts` `assignTeamPool`.

**How.** If `poolId` non-empty, require a `pools` row with that id **and**
`competitionId === g.competitionId` before the update; else no-op/return.

**Why.** Prevents assigning a team to a foreign competition's pool (corrupts
standings grouping).

---

# Workstream F — Architecture & maintainability (M7, L1, L2, L3, L4, L5, L7, L8, L9 + design challenges)

## F1 (M7 + design #7) — One generic scoring provider

**Where:** new `src/lib/match-provider.tsx`; collapse the four
`*-match-context.tsx` into thin wrappers.

**How.** Extract the shared logic (optimistic dispatch, realtime subscribe,
offline queue, resync) into a generic provider parameterized by the engine
append fn + types:
```ts
export function createMatchProvider<S extends { lastSequence: number; status: string }, P extends { type: string }>(opts: {
  append: (s: S, p: P, c: TournamentConfig, o: AppendOpts) => { ok: boolean; state?: S; reason?: string };
  isRallyWon: (p: P) => boolean;
}) { /* returns { Provider, useMatch } with the existing behaviour */ }
```
Beach/indoor/grass/light become ~10-line modules supplying `appendXEvent` and the
roster/teamName props. Do the same for a `ScoreboardShell` (court + action-bar
slots) and a single `LineupEntry` driven by config (`playersPerSide`, libero,
single-vs-two-team confirm). `GrassCourt`/`LightCourt` are byte-identical → merge
into one `RotationCourt`.

**Why.** ~1500 lines of copy-paste across providers/action-bars/scoreboards/
lineups will drift (the B1 realtime change must otherwise be made in 4 places).
The server-side registry already proves the orchestration is discipline-generic.

**Test.** A single provider test (optimistic apply → server-confirm reconcile →
realtime signal → resync) covers all disciplines.

## F2 (L2 + design #4) — Honest engine typing

**Where:** `src/engine/registry.ts`, `src/lib/match-engine.ts`.

**How.** Define `interface Engine<S extends CommonMatchState, P extends {type:string}>`
and type each adapter as `Engine<BeachMatchState, BeachEventPayload>` etc.;
`getEngine` returns `Engine<CommonMatchState, BasePayload>` via a typed registry.
Stop returning `BeachMatchState` from `match-engine` loaders for non-beach —
return `CommonMatchState` and have callers narrow with a discipline check, or make
`loadMatchView` generic. Remove the `as unknown as` casts.

**Why.** The current return type is a documented lie; reading a beach-only field
off an indoor match silently yields `undefined`. Generics make divergence a
compile error.

## F3 (design #5) — One `LINEUP_CONFIRMED` shape

**Where:** indoor vs grass/light payloads + `lineup` route + team tablet.

**How.** Standardize on **per-team** `LINEUP_CONFIRMED { team, playerIds, libero }`
across all disciplines (indoor's shape). Grass/light scorer UI sends two events
(or a thin server action that emits both). This makes the token-gated `/lineup`
route work uniformly and lets grass/light support team tablets later.

**Why.** Today `/lineup` is hard-coded to the indoor shape; grass/light can't use
it (only saved by `teamTabletEnabled=false`). One shape removes the trap.

## F4 (L1) — Remove the dead `lineup_submissions` table

**Where:** `src/db/schema.ts`, `src/scripts/seed.ts` (cleanup refs), migration.

**How.** Drop the table + its imports/cleanup references. The event log
(`LINEUP_CONFIRMED`) is the source of truth. (If you instead want a team→scorer
*pending* lineup handshake, wire it — but don't leave it dead.)

## F5 (L3) — Batch CSV inserts + cap upload size

**Where:** `src/lib/csv-actions.ts`.

**How.** Reject files over a limit (`if (file.size > 512*1024) return fail(...)`).
Validate all rows first, then a single `db.insert(table).values(validRows)`;
collect per-row errors without a query each. Keep the `csv_imports` log.

## F6 (L4) — Don't trust `x-forwarded-host` for QR origin

**Where:** `src/app/.../matches/[matchId]/page.tsx` `originFromHeaders`.

**How.** Use `process.env.NEXT_PUBLIC_APP_URL` when set; fall back to the header
only in development. Add `NEXT_PUBLIC_APP_URL` to `.env.example` + deploy docs.

## F7 (L5) — Generalize the scoreboard for non-beach

**Where:** `src/components/scoreboard/ScoreboardDisplay.tsx`.

**How.** Pass `discipline` + a server-position resolver; for rotation disciplines
show the rotation server (from `lastRot`/`courtPositions`), or hide the
`SCORE_WITH_ROTATION` mode for beach-less server semantics. Remove the
beach-typed cast.

## F8 (L7) — Serve-clock SSR safety

**Where:** `src/lib/serve-clock.ts`.

**How.** Initialize `now` to a stable value and set the real time in the effect
(`useState(deadline ?? 0)` then `useEffect` sets `Date.now()`), avoiding an
SSR/CSR hydration mismatch from `useState(() => Date.now())`.

## F9 (L8, L9) — Minor polish

- L8: keep `requireRole`/`requireMatchRole` returning `notFound()` for forbidden
  (intentional non-disclosure) but add a short code comment stating the decision;
  optionally a dedicated 403 page for first-party UX.
- L9: `parseCsv` drops fully-blank rows via `trim()`; document the behavior in the
  function comment (acceptable for admin uploads).

---

# Workstream G — Tests (H3)

The integration layer has **zero** coverage; that's where the real bug lived.

**Add:**
- `__tests__/engine/match-engine.test.ts`: `appendMatchEvent` happy paths per
  discipline, UNDO + re-replay, `denormalize` columns, snapshot==full-replay
  (C1), the **TTO-mid-set** regression (a rally that auto-emits `TTO_START`
  followed by another action), `SequenceConflict` on concurrent insert.
- `__tests__/lib/standings.test.ts`: W/SR/PR math, **head-to-head** tiebreak,
  points from per-set max, pool grouping.
- `__tests__/lib/bracket.test.ts`: `seedOrder(8/16)`, `bracketSize`, advance
  pairing + 3rd-place, idempotency, **concurrent-advance** guarded (E1).
- `__tests__/lib/csv.test.ts`: quoted commas/newlines, `""` escaping, CRLF, blank
  rows, missing columns.
- `__tests__/api/authz.test.ts`: the matrix from A1 (cross-tenant 403, etc.) and
  the C2 event whitelist (422 on `SET_END`).
- `__tests__/lib/authz.test.ts`: `safeRedirect` (A3), `hasRole` superuser.

**CI gate:** keep `tsc` + `eslint` + `vitest` + `next build` as the merge gate
(already the manual gate — make it CI).

---

# Sequencing & dependencies

```
1. A1 authz primitive (+ getCurrentUser/cache)         ← unblocks A2, M3, route tests
2. A2 event whitelist, A3 redirect, A4 origin/cookie    ← finish API hardening
3. C1 snapshot + transaction + drop in-memory cache     ← unblocks B1, C2-perf
4. C2 delete dead SSE + rate limit; C3 meta cache
5. B1 broadcast-as-signal; B2 realtime RLS (defense)    ← depends on cheap /state (C1)
6. D auth round-trip de-dup (rides on A1's cache())
7. E1 bracket lock+index; E2 tz; E3 libero; E4 pool
8. F1 generic provider (do AFTER B1 so you de-dup the fixed code, not 4 copies)
9. F2 typing, F3 lineup shape, F4 drop table, F5–F9 polish
10. G tests land alongside each workstream; H3 closes the gate
```

**Critical/High (A, B, the C1 snapshot, H3 tests) are the ship blockers.**
M/L items improve durability and cost; do them before scaling load or adding the
6th discipline.

# Verification checklist (per PR)

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm test` green (incl. new suites)
- [ ] `npm run build` green
- [ ] For auth PRs: manual cross-tenant probe returns 403/404
- [ ] For realtime PR: forged broadcast does not alter displayed score
- [ ] For snapshot PR: `loadFromSnapshot === replayEvents` over a seeded match
