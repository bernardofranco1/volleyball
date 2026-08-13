# spec/28 — Homologation → Production releases (one URL, one DB, one project)

**Status: PLANNED — no implementation yet.** Written 2026-08-13.

## 1. Goal

Today a push to `main` goes straight to the production domain. Wanted instead:

- A push to `main` lands in **Homologation**, never directly in production.
- Once validated, that exact version is **promoted to production from a UI**,
  where it is also visible which version sits where.
- **One URL, one database, one Vercel project** — no second address, no second
  Supabase project.
- The validator can **switch between the two versions in the UI**, with an
  unmistakable visual marker (a coloured bar) whenever they are looking at
  Homologation.
- Rollback: re-promote a previous version, from the same UI.

## 2. The building blocks (verified against Vercel docs, Aug 2026)

Everything below works on the current Hobby plan.

1. **Staged Production Deployments.** Project Settings → Environments →
   *Auto-assign Custom Production Domains* → **off**. From then on every push
   to `main` builds a production-configured deployment that does **not** take
   the domain — it sits "staged" with its own unique URL until promoted. The
   Vercel dashboard already has a *Promote* button for staged deployments, so
   the core workflow exists before we write any code.
2. **Promote API** — `POST /v10/projects/{projectId}/promote/{deploymentId}`.
   Promotes the **exact build artifact** that was validated (no rebuild), which
   is the property that makes homologation meaningful. Same endpoint serves
   rollback: promote an older deployment.
3. **Aliases API** — keeps a stable `homolog-…vercel.app` alias pointed at
   whichever candidate is currently under validation.
4. **Middleware rewrites to another deployment.** `proxy.ts` can
   `NextResponse.rewrite()` to an absolute URL and inject request headers —
   including `x-vercel-protection-bypass` (the *Protection Bypass for
   Automation* secret, available on all plans, auto-injected as
   `VERCEL_AUTOMATION_BYPASS_SECRET`). This is what makes the one-URL switch
   possible while keeping candidate URLs access-protected.
5. Because candidates are **production-target** deployments, they are built
   with the **production env vars**. What is validated is configured exactly
   like what will serve production — no preview-env drift.

Note: Vercel's first-party versions of the fancy parts (Custom Environments,
Skew Protection, Instant Rollback, Rolling Releases) are Pro/Enterprise
features. This plan reproduces the promote/rollback workflow on Hobby with the
primitives above; upgrading later would simplify, not conflict.

## 3. Architecture

Three independent pointers, one project:

| Pointer | Meaning | Moved by |
|---|---|---|
| **Production** | which deployment `volleyball-eight.vercel.app` serves | *Promote* (console or Vercel dashboard) |
| **Homologation** | which deployment the `homolog-…` alias serves | *Set as homolog* (console; default = newest `main` build) |
| **Your browser** | which of the two YOU see at the one URL | the signed homolog cookie (console: *View homolog* / *Exit*) |

Flow: push to `main` → Vercel builds a staged candidate → console (or a deploy
hook) points the homolog alias at it → validator flips the cookie and walks the
app at the normal URL, amber bar on → validator promotes → domain now serves
that artifact → cookie cleared. Rollback = promote any earlier release from the
history list.

Branch (non-main) pushes keep today's behaviour: ordinary preview deployments,
untouched by any of this.

## 4. Release console — `/admin/releases` (global admin only)

A page in the existing platform console (spec/23), talking to the Vercel API
server-side with a stored `VERCEL_TOKEN`.

**Shows**
- Recent `main` deployments: SHA + commit title, age, build state, and chips:
  `IN PRODUCTION` / `IN HOMOLOG` / `CONTRACT MIGRATION` (see §7).
- Current production release and how long it has been serving.
- Migration state: repo journal vs `drizzle.__drizzle_migrations` — is the
  candidate expecting schema the DB doesn't have yet, or vice versa.
- Release history from the `releases` table (below), with re-promote buttons.

**Actions**
- *Set as homolog* — move the homolog alias to any listed deployment.
- *View homolog* — set the signed cookie; the same URL now serves the
  candidate; banner appears. *Exit homolog* clears it.
- *Promote to production* — calls the promote API. Guarded by:
  - a **LIVE-match check** ("2 matches are LIVE right now — promoting swaps
    the app under their scorers"; see §9),
  - a **pending-migration check** (candidate's journal ahead of the DB ⇒ apply
    migrations first),
  - a **contract-migration acknowledgement** when the candidate contains one,
  - an explicit confirm.
  Every promote/rollback writes a platform-level `audit_log` row (tenantId
  null, the spec/26 convention) and a `releases` row.
- *Rollback* — the same promote call on a previous release.

**New table `releases`** (expand-only migration, fittingly):
`id, deployment_id, sha, message, promoted_at, promoted_by, previous_deployment_id, note`.
Powers the history, rollback targets, and the banner's "am I promoted?" check.

## 5. The homologation banner

- A slim amber bar fixed to the top of **every** surface — including the scorer
  console and tablets, because validating scoring in homolog must be visibly
  homolog. Content: `HOMOLOGATION · <sha7> <commit title> — this is not
  production`, plus *Exit* when in cookie mode.
- Detection is server-side, no client JS:
  - the homolog cookie is present (one-URL proxy mode), **or**
  - the request host ≠ `NEXT_PUBLIC_APP_URL`'s host (direct alias access), **or**
  - `VERCEL_DEPLOYMENT_ID` ≠ the latest `releases.deployment_id` (belt and
    braces for a staged deployment reached any other way).
- The promoted deployment at the canonical domain never renders it.
- Amber, not red — red stays reserved for destructive actions.

## 6. The one-URL switch (mechanics)

- **Cookie**: `hml=<HMAC(secret, expiry)>`, httpOnly, `maxAge` ≈ 4 h, set and
  cleared only by the console's server actions (global admin). If it ever
  leaks, the holder sees the candidate build instead of prod — same app, same
  auth gates, same DB — so exposure is low; HMAC + TTL contain it anyway.
- **proxy.ts** gains a first branch: cookie valid → rewrite the request to
  `https://homolog-….vercel.app<path>` injecting the protection-bypass header.
  Bodies stream through, so Server Actions and API posts work.
- **Matcher widening**: the proxy must now also match `_next/static`, images
  and `/api/*` so those proxy too. To keep today's hot-path discipline (the
  matcher deliberately excludes them from auth work), the handler short-cuts:
  no cookie + newly-matched path → `NextResponse.next()` immediately. The
  scoring path gains one near-zero middleware hop; revisit only if Hobby's
  middleware quota ever matters.
- **Origin checks**: through the proxy, the candidate sees Host = alias host
  but Origin/`x-forwarded-host` = canonical host. Add the canonical host to
  `serverActions.allowedOrigins` in `next.config.ts` and allow it in our own
  `sameOriginOk`. (Both ship in the candidate build — same repo.)
- **Auth**: Supabase cookies are host-scoped to the canonical domain and flow
  through the proxy both ways, so the validator stays signed in seamlessly.
- **Candidate URL protection**: keep Vercel Authentication ON for
  non-promoted URLs. The proxy authenticates itself with the bypass header;
  a human opening the alias directly gets a Vercel SSO prompt (fine — that
  path is for admins). Turning protection off is also defensible (the app has
  its own login and the public surfaces are meant to be public) — decide at
  implementation.
- After a promote, *Exit homolog* is triggered automatically — the cookie
  would otherwise keep proxying to the alias, which is harmless (it points at
  the same, now-promoted build) but confusing.

## 7. One database: the rules that make it safe

The single-DB constraint is the real engineering content of this plan. The
candidate and production run **concurrently against the same schema and
data** — which is precisely what makes homolog validation honest, and
precisely what makes migrations dangerous. We already paid for this lesson:
on 2026-08-11 a branch migration dropped `players` name columns while the
promoted code still selected them, breaking every match page.

**Expand/contract becomes law:**

- **Expand (any release):** additive only — new tables, nullable columns (or
  defaulted), new indexes, backfills. Never drop, rename, retype or
  `SET NOT NULL` anything the currently-promoted code still touches.
- **Contract (a later release):** drops/renames ship only after the release
  that stopped using the object is **in production**. The August incident was
  exactly an expand and contract fused into one release.
- Event-log payloads and realtime message shapes count as schema: additive
  only, since the promoted replayer must tolerate what a candidate writes.

**Enforcement, not just policy:**

- A CI lint over new migration files flags `DROP`, `RENAME`,
  `SET NOT NULL`, `ALTER TYPE`; such a migration fails CI unless annotated
  `-- contract-ok: <why prod no longer touches this>`.
- The console shows a red `CONTRACT MIGRATION` chip on candidates carrying the
  marker; promote requires acknowledging it.
- Runbook: migrations are applied when a candidate enters homolog (manual
  `db:migrate`, as today — a console button can come later). **A full backup
  of all tenants runs first**, using the existing spec/23 machinery (add an
  "all tenants" wrapper). The `MIGRATION_JOURNAL_IDX` / restore-map bump
  discipline stays test-enforced as it already is.

**Residual honesty:** a second database (or Supabase branching) is the
textbook answer for genuinely risky schema work, and this plan deliberately
doesn't buy it. Expand/contract + pre-migration backups + tenancy isolation
are the compensating controls. If a migration ever feels too hot for the
shared DB, that is the moment to revisit — not to bend the policy.

## 8. Homolog data — tenancy is the isolation

- Validation happens in a dedicated **homolog tenant** (either repurpose
  `second-empty-tenant` or provision a fresh `homolog` slug). App-level
  tenancy already isolates every query, so poking at the candidate never
  touches VBC Cheseaux or the demo tenant. Only global admins see it in the
  switcher.
- Side effects are real (candidates run production env): emails go wherever
  the homolog tenant's members point (use our own addresses); the VSR feed
  only fires when `matches.vis_id` is set — leave it unset on homolog matches;
  Stripe is inert.
- **Crons run only against the promoted production deployment** (Vercel
  behaviour), so candidates never double-run reseeds or backups.

## 9. Promote-time skew

Promoting swaps the code under any open browser; the old build's hashed
`/_next/static/*` assets stop resolving at the domain (Skew Protection is a
paid feature). Mitigations:

- The console's LIVE-match warning: promote between matches, not mid-set.
- Optional (Phase 3): a version beacon — layouts poll a tiny `/api/version`;
  when the deployment id changes, show a "new version — reload when
  convenient" toast. The scorer console already survives a reload (state is
  server-side; offline queue persists).

## 10. Inventory of changes

**Vercel settings (no code):** Auto-assign Custom Production Domains → off;
create a Protection Bypass secret.

**Env (Production + Preview, minding the `vercel env add --value` truncation
gotcha):** `VERCEL_TOKEN` (new, sensitive), `VERCEL_PROJECT_ID`,
`VERCEL_TEAM_ID`, `HOMOLOG_COOKIE_SECRET`.

**Repo:** `releases` migration; `/admin/releases` page +
`src/lib/releases.ts` (Vercel API client: list deployments, promote, alias);
the proxy.ts homolog branch + widened matcher; the banner in the root, tenant
and console layouts; `serverActions.allowedOrigins`; migration CI lint;
backup-all wrapper; homolog-tenant provisioning script.

**Unchanged:** scorers, tablets, public boards, PDFs, all tenant-facing
behaviour. Only global admins ever see any of this.

## 11. Rollout

- **Phase 0 — flip the toggle (minutes, no code).** Pushes to `main` stop
  reaching production immediately; promotion happens via the Vercel
  dashboard's Promote button; candidates are reachable at their unique URLs.
  The core ask ("main ≠ prod") is delivered on day one.
- **Phase 1 — release console (~1 day).** `releases` table, `/admin/releases`
  with promote/rollback/set-homolog, the homolog alias, the amber banner
  (host-based detection), audit entries, LIVE-match + migration guards.
- **Phase 2 — one-URL switch (~1 day).** Cookie + proxy branch + origin
  allow-listing + *View homolog*/*Exit* buttons; banner gains cookie
  detection; end-to-end browser pass (the spec/27 QA pattern) across both
  modes, including scoring a match in homolog through the proxy.
- **Phase 3 — optional hardening (~½–1 day).** Migration CI lint,
  automatic backup-before-migrate, version beacon.

## 12. Alternatives considered

- **Two Vercel projects / two domains / second Supabase project** — cleaner
  isolation, rejected against the explicit one-URL/one-DB constraint; also
  doubles env drift and costs the "validate against real data" property.
- **Vercel Custom Environments / Rolling Releases** — Pro/Enterprise; this
  plan reproduces the workflow on Hobby and upgrades gracefully.
- **Feature flags instead of environments** — complementary (ship dark code),
  not a substitute for validating a whole build.

## 13. Decisions to take at implementation time

1. Homolog tenant: repurpose `second-empty-tenant` or provision `homolog`?
2. Vercel Authentication on candidate URLs: keep on (bypass via proxy) or off?
3. Promote ceremony: plain confirm, or type the SHA suffix?
4. Homolog cookie TTL (proposal: 4 h).
5. Should *Set as homolog* auto-follow every push (deploy hook), or stay a
   manual console action? (Proposal: auto-follow latest, manual override.)
