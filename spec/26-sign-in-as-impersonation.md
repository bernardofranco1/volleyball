# Spec 26 — "Sign in as…" (global-admin impersonation)

**Status: PLANNED — not implemented.** Written 2026-08-12. Everything below is design;
file:line references are against `main` @ `f21054b`.

## 1. Goal

Let a **global admin** view and operate the platform *as any other user* — same
tenants, same nav, same role gates, same failures — to test access and behaviour
without knowing the user's password or disturbing their account. One click from
the People console, an unmistakable banner while active, one click to exit.

**Non-goals** (possible later, out of scope here): impersonating tablet tokens or
scorer-PIN sessions (those are match-scoped credentials, not users — test them via
their own links); a read-only "view as" variant; letting tenant admins impersonate
within their tenant.

## 2. Mechanism: app-level overlay, not a session swap

Two ways to build this:

**(a) Mint a real Supabase session for the target** (admin API `generateLink` →
consume). Rejected:
- The browser then *is* the target — the real actor disappears from every log.
- One-time links are fragile (the 2026-07-30 Safe-Links incident burned exactly
  this kind of link).
- Returning requires a full re-login; there is no forced expiry; and a minted
  refresh token for the target outlives the test.

**(b) Overlay on top of the admin's own session** (chosen). The admin's Supabase
session stays untouched; a short-lived signed cookie says "resolve the app user
as X". This works cleanly here because of one architectural fact: **every
authorization gate funnels through `getCurrentUser()`** (`src/lib/authz.ts:41`) —
`getAuthContext`, `requireRole`, `authorizeMatch`, `requireGlobalAdmin`,
`rolesFor`, `isGlobalAdmin` all resolve identity from that single memoised
function. The DB is a plain Postgres pool (no RLS enforcement in the request
path), so app-level identity *is* the authorization identity. Swap it in one
place and every gate behaves as the target, with the real session intact
underneath for the banner, the exit action, and attribution.

## 3. Invariants (the security contract)

1. **Only a live global-admin session can activate the overlay.** The cookie
   alone is never sufficient: on every request the overlay verifies the real
   session's user id matches the cookie's `actor` AND `users.is_global_admin`
   is still true *now* (DB read, request-memoised). Revoking the flag or the
   session kills the overlay instantly.
2. **Global admins cannot be impersonated** (no privilege escalation, no audit
   evasion), and you cannot impersonate yourself or stack impersonations.
3. **Authorization is the target; attribution is the actor.** Every gate
   evaluates the target's roles; every audit/attribution write records the real
   admin, marked as impersonating.
4. **Time-boxed.** The expiry is inside the signed payload (60 min), not just
   the cookie's `maxAge` — a replayed cookie dies on schedule regardless.
5. **Visible.** A persistent banner renders on every server-rendered page while
   active. Exit is always one click, even where the target has no access.

## 4. The cookie

- **Name** `vbimp`; **options** `httpOnly`, `secure`, `sameSite: "lax"`,
  `path: "/"`, `maxAge: 3600`, and `domain` from `authCookieOptions()`
  (`src/lib/subdomain.ts:26`) — required, because `tenantUrl()` redirects are
  cross-subdomain once `NEXT_PUBLIC_ROOT_DOMAIN` is set and a host-only cookie
  would not follow (`src/lib/subdomain.ts:141`). Follow the cookie-write pattern
  of `src/proxy.ts:149-158`, not the two action precedents (neither applies the
  apex domain).
- **Value** `v1.<base64url(payload)>.<hmacHex>` with payload
  `{ a: actorUserId, t: targetUserId, iat, exp }`.
- **Crypto**: HMAC-SHA256 over `"vbimp:v1:" + base64url(payload)` — the context
  prefix domain-separates it from the scorer-PIN HMAC. Key via the same
  fail-closed chain as `hmacKey()` in `src/lib/scorer-pin.ts:18-30`
  (`PIN_HMAC_SECRET ?? SUPABASE_SERVICE_ROLE_KEY ?? DATABASE_URL`, throw if
  none); compare with the existing `timingSafeEqualHex`. New module
  `src/lib/impersonation.ts` (Node-only; the proxy never *verifies* it, see §10).

Stateless-vs-DB-row: a `match_sessions`-style row would add per-request
revocability, but the real credential is the admin's session — revoke that (or
the flag) and the overlay dies (§3.1), and the 60-min payload expiry bounds the
rest. Not worth a table.

## 5. Server model — changes in `src/lib/authz.ts`

```
getRealUser()        // the current getCurrentUser body, renamed: raw getClaims()
getImpersonation()   // cache(): parse+verify vbimp; require real session,
                     // cookie.a === realUser.id, isGlobalAdmin(realUser.id),
                     // fresh users row for cookie.t exists and is NOT global
                     // admin; returns { target: {id,email,name}, actor } | null
getCurrentUser()     // real user; if getImpersonation() → target identity
```

Notes:
- The target's email comes from its `users` row (PK read, memoised), since
  claims belong to the admin.
- `isGlobalAdmin()` stays keyed by the id it is given — `rolesFor(target …)`
  therefore returns the target's real roles and the `["TENANT_ADMIN"]`
  short-circuit (`authz.ts:81`) never fires for a non-admin target. This is the
  load-bearing detail: without it every gate would stay wide open.
- `requireGlobalAdmin` flows through `getCurrentUser` too, so **`/admin` 404s
  while impersonating** — correct fidelity; exit lives in the banner (§7),
  which authenticates against `getRealUser()`.
- `AuthContext` and `MatchAuth` gain `actor: { id, email } | null` (null when
  not impersonating) so attribution sites can record the real admin (§8).
- Verification failures (bad signature, expired, actor mismatch, target became
  admin, real user not admin) all behave as "no overlay" and the cookie is
  deleted at the next Server-Action/route opportunity (Server Components can't
  write cookies — `supabase.ts:24-34` precedent swallows exactly this).

## 6. Start / exit

**Start** — `startImpersonation(prev, fd)` in `src/lib/user-admin-actions.ts`
(the file's convention: first line `requireGlobalAdmin()`):
1. Guards: target exists, `!target.isGlobalAdmin`, `target.id !== me.id`, no
   active overlay already.
2. Audit (§9), sign cookie, set it.
3. `redirect(await postLoginDestination(target.id) ?? "/select-tenant")` — land
   exactly where the target's fresh login would (`src/lib/login-destination.ts:15`).
   Two wrinkles: step 4 of `postLoginDestination` reads the browser's
   `lastTenant` cookie — the *admin's* history, acceptable noise; and a
   tenant-less target returns `null` → `/select-tenant`, which renders the
   target's (empty) picker — itself a state worth testing.

**UI** — a "Sign in as" button per person in
`src/components/admin/PeopleList.tsx` action row (`:94-134`), same
`ActionForm` + hidden `userId` shape as Delete, hidden for self and for global
admins (mirror the server guards — the server re-checks regardless).

**Exit** — `stopImpersonation()` in `src/lib/impersonation-actions.ts`:
authenticates via `getRealUser()` + valid cookie (NOT `requireGlobalAdmin`,
which is overlay-aware and would 404), deletes the cookie, audits, redirects to
`/admin/access`. Also: `logout()` (`src/lib/auth-actions.ts:61-65`) must delete
`vbimp` alongside the Supabase cookies — today it clears only `sb-*`.

## 7. The banner

Rendered from the **root layout** (`src/app/layout.tsx:41`) — the only place
that wraps `/t/*`, `/admin`, `/login`, `/select-tenant` and survives the
cross-subdomain hop. Discipline: the layout does a cheap `cookies().has("vbimp")`
pre-check (the `sb-` presence-probe trick from `t/[tenantSlug]/layout.tsx:80`)
so the 99% case costs nothing; only when present does it verify and render
`<ImpersonationBanner>`: fixed bottom bar, high-contrast amber, ~
"Viewing as jane@club.ch — expires 14:32 — [Exit]". English-only (its audience
is a global admin; matches the `/admin` console convention,
`admin/layout.tsx:7-10`). Fixed-bottom avoids layout shift and never collides
with the tenant header; the scoreboard's `fixed inset-0` overlay will cover it —
acceptable (public board fidelity), the tablet/scorer pages will not.

## 8. Attribution — the sweep

Rule: **gates decide as target; records name the actor.** With
`ctx.actor`/`auth.actor` available (§5), the sites to touch (each a one-line
change from `user.id` to `actor?.id ?? user.id`, plus an impersonation marker):

| Site | Field |
|---|---|
| `src/app/api/matches/[id]/events/route.ts:138` | `actorUserId` → real admin; `deviceInfo` → `"impersonating:<targetId>"` while active |
| `src/lib/match-admin-actions.ts` (rewind, confirm result, reopen) | `actorUserId` + `recordAudit` actor |
| signature capture (`capturedBy`) | real admin |
| `recordAudit` call sites in branding-, access-, csv-, competition-, tenant-config-actions | `actor` + `metadata.impersonating: targetId` |
| scorer-PIN cookie issuance / tablet-token `createdBy` | real admin |

Safety note: a missed site records the *target* id — bounded by the audit
bracket rows (§9) and the events `deviceInfo` marker, and findable later. The
implementation should grep `\.user\.id` across `src/lib/*-actions.ts` and the
API routes as its checklist.

## 9. Audit

`audit_log.tenant_id` is NOT NULL (`schema.ts:840`), and the codebase already
documents the consequence: platform-level actions (global-admin flag flips,
password resets) are simply **not audited** (`user-admin-actions.ts:8-10`).
Impersonation must not join that blind spot — it is the single most
audit-worthy action the platform has. So this spec includes closing the gap:

- **Migration 0017**: `ALTER TABLE audit_log ALTER COLUMN tenant_id DROP NOT
  NULL` (additive-safe; bump `MIGRATION_JOURNAL_IDX` **and** the restore
  script's `KNOWN_JOURNAL_IDX` + note, per the 2026-08-12 drift lesson).
  `recordAudit` accepts `tenantId: string | null`. Tenant-scoped backups never
  exported platform rows before and still won't (export filters by tenantId) —
  acceptable, note it in `backup-policy.ts`.
- **Rows**: `admin.impersonate.start` / `.stop` / `.expired-on-use` with
  `actor = real admin`, `entityType "user"`, `entityId = target`,
  `metadata { targetEmail, exp }`, `tenantId: null`.
- **Viewer**: minimal `/admin/audit` page (global-admin, reuse the tenant audit
  table markup from `t/[tenantSlug]/audit/page.tsx`) listing `tenantId IS NULL`
  rows. Also retrofit the other platform-level actions
  (`setGlobalAdminFlag`, `deleteUserAccount`, `resetPassword`,
  `sendPasswordEmail`) to audit with `tenantId: null` — four call sites, closes
  the documented gap for good.

## 10. Known leaks & required fixes

Paths that read Supabase auth **directly** and would miss the overlay:

1. `t/[tenantSlug]/dashboard/page.tsx:23-26` — "Signed in as {email}" uses
   `supabase.auth.getUser()`. Switch to `getCurrentUser()` (also removes an
   Auth-server round trip). **Must fix** — it is the most visible identity
   surface.
2. `src/proxy.ts:133-158` — edge session check + `lastTenant` write. The
   session check is correct as-is (the *admin* is the one signed in). The
   `lastTenant` write pollutes the admin's own routing history while browsing
   as the target: suppress when the `vbimp` cookie is *present* (presence
   check only — the edge never verifies HMACs and never makes authz decisions
   from this cookie).
3. Browser-side Supabase (realtime subscriptions, `set-password` flow) sees the
   real session. Public channels (the default) don't care. If
   `NEXT_PUBLIC_REALTIME_PRIVATE` is ever enabled, private channels would
   authorize as the admin — record as a known limitation in the code.
4. Token/secret-gated routes (tablet lineup/interrupts, cron, webhooks) have no
   user identity — unaffected by design.

## 11. Edge cases

- **Expiry mid-flight**: next request silently reverts to the admin (banner
  gone, admin's own access active). Acceptable; the banner shows the expiry
  time so it isn't a surprise. No auto-renew — restart deliberately.
- **Target deleted / flag changes mid-session**: `getImpersonation` re-reads
  the target row and both flags every request → overlay dies as "no overlay".
- **Admin's session expires**: overlay dies with it (invariant 1).
- **Two tabs / two targets**: last-set cookie wins — same as any cookie flow.
- **`/select-tenant`** redirects global admins to `/admin` (`select-tenant/page.tsx:23`)
  — via `getCurrentUser` → evaluates the *target* → not redirected. Correct.
- **Impersonated "change password" attempt**: the browser-side recovery flow
  acts on the *admin's* real session — it cannot touch the target's
  credentials. Confusing rather than dangerous; the banner is the mitigation.

## 12. Testing

Unit (vitest, `vi.mock` style of `user-admin-actions.test.ts`):
- cookie: sign/verify round-trip; tampered payload; tampered sig; expired;
  wrong actor id vs session; version mismatch.
- overlay: valid cookie + admin session → target identity; real user not
  admin → ignored; target is global admin → refused; target row missing →
  ignored; `rolesFor(target)` returns target roles (no TENANT_ADMIN synthesis).
- actions: start guards (self / admin-target / already-active); stop clears;
  logout clears; audit rows written with `tenantId: null`.

Manual e2e checklist (Playwright-able later): start as a SCORER-only user →
tenant nav shrinks, `/admin` 404s, other tenants 404; score a point → events
row has `actor_user_id` = admin + `deviceInfo` marker; exit → admin console
back; banner visible on dashboard/matches/settings; cross-subdomain hop keeps
banner (once a root domain exists).

## 13. Implementation order

1. `src/lib/impersonation.ts` (cookie sign/verify) + unit tests.
2. `authz.ts` overlay (`getRealUser` / `getImpersonation` / `getCurrentUser`,
   `actor` on `AuthContext`/`MatchAuth`) + tests.
3. Migration 0017 (audit nullable) + `recordAudit` widening + journal-guard
   bumps (both constants + restore PK map check).
4. Start/exit actions + PeopleList button + logout clearing.
5. Root-layout banner.
6. Leak fixes: dashboard identity read, proxy `lastTenant` suppression.
7. Attribution sweep (§8 table) — mechanical, one commit.
8. `/admin/audit` viewer + platform-action audit retrofit.
9. Full suite + manual checklist; deploy.

Steps 1–6 are the usable core (~a focused day); 7–8 complete the audit story.
No new env vars required; one DB migration (0017), additive.
