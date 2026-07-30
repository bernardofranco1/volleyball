# 23 — Multi-tenant operations: global admin, tenant branding v2, subdomains, backups

**Status: IMPLEMENTED 2026-07-30** (all sections; §6 subdomain routing shipped inert behind `NEXT_PUBLIC_ROOT_DOMAIN`, pending a domain purchase). Authored 2026-07-30 from a product-owner brief; decisions below marked *(confirmed)* were answered by the product owner on the same date.

Implementation notes (deltas from plan):
- Both `bernardofranco1@gmail.com` and `admin@volleyball-demo.app` were flagged `is_global_admin` (the demo admin is the documented live-site login). Revoke the demo account before onboarding real tenants: `UPDATE users SET is_global_admin = false WHERE email = 'admin@volleyball-demo.app';`
- Logo upload accepts PNG/JPEG/WebP only (magic-byte sniffed); SVG stays URL-field-only (§5.2 "sanitize vs reject" resolved as reject).
- Storage buckets `backups` (private) and `branding` (public) created 2026-07-30; migration 0008 applied; Test tenant renamed (name "Test", public title preserved via `tenant_branding.title`).

---

## 0. Starting point (what already exists)

The platform is already multi-tenant at the data layer — this spec adds the *operational* layer on top. Shipped today:

- `tenants` table + `tenant_id` FK on every domain table except `tournament_config`, `competition_branding`, `pool_teams` (those hang off `competitions`/`pools`) — `src/db/schema.ts`.
- Isolation via app-level `WHERE tenant_id = …` (RLS enabled deny-all, bypassed by owner connection) — `schema.ts:17-23`, `spec/03-DATABASE.md:369`.
- Per-tenant roles: `user_tenant_roles` (user × tenant × role) already supports membership in multiple tenants — `schema.ts:69`.
- Roles `TENANT_ADMIN | COMPETITION_ADMIN | SCORER | VIEWER` with helpers in `src/lib/authz.ts`.
- Tenant routing under `/t/[tenantSlug]/…`; tenant resolved by `getTenantBySlug` (`src/lib/tenant.ts:42`), cached with tag `tenant:<slug>`.
- Tenant branding: `tenant_branding` (logo **URL**, primary/secondary colors, font, court-color overrides), edited via `BrandingForm` on `/t/{slug}/settings`, applied as CSS vars in `src/app/t/[tenantSlug]/layout.tsx:40-50`.
- Dark/light via CSS vars in `globals.css` + `vbtheme` cookie; tenant primary color is injected *on top of* both themes, so custom colors already survive mode switching.

What is **missing** (the scope of this spec):

| Gap | Section |
|---|---|
| Global-admin concept + tenant CRUD console | §2, §3 |
| Tenant switcher / multi-tenant login flow | §4 |
| Configurable **Title** (replaces "Volleyball Scoring") + logo **upload** | §5 |
| Subdomain-per-tenant routing | §6 |
| Backups: daily full + event-triggered incremental | §7 |
| Test tenant designation for existing data | §8 |

## 1. Confirmed decisions

1. **Subdomains — "plan both, subdomain-ready"** *(confirmed)*: architecture resolves the tenant from the hostname when a custom apex domain is configured, and `/t/{slug}` paths keep working everywhere (they remain the canonical internal form). A custom domain is a later, independent step.
2. **Membership — multi-tenant** *(confirmed)*: users may belong to several tenants with different roles. Already true in the schema; the UI catches up (switcher, login picker).
3. **Backup storage — Supabase Storage** *(confirmed)*: private bucket in the existing project, per-tenant folders, ~30 daily fulls + incrementals since the oldest kept full.
4. **Backup scope — per-tenant logical exports** *(confirmed)*: each tenant exported separately; doubles as a tenant data-export/portability feature.
5. Global admin (Bernardo) has implicit admin in **all** tenants; existing per-tenant permissions unchanged.
6. Current competitions/matches stay in a **Test** tenant (§8).

## 2. Data model changes

One drizzle migration (`drizzle-kit generate` → review → `npm run db:migrate`; never `push` — CHECK-introspection bug, see `spec/17:146`):

```sql
ALTER TABLE users           ADD COLUMN is_global_admin boolean NOT NULL DEFAULT false;
ALTER TABLE tenants         ADD COLUMN subdomain  text UNIQUE;           -- nullable until chosen
ALTER TABLE tenants         ADD COLUMN deleted_at timestamptz;           -- soft delete (§3.4)
ALTER TABLE tenant_branding ADD COLUMN title      text;                  -- display title (§5.1)

CREATE TABLE backup_runs (
  id           text PRIMARY KEY,                  -- cuid2
  tenant_id    text NOT NULL REFERENCES tenants(id),
  kind         text NOT NULL,                     -- 'FULL' | 'INCREMENTAL'
  trigger      text NOT NULL,                     -- 'CRON' | 'EVENT' | 'MANUAL'
  scope        jsonb,                             -- e.g. {"competitionId": "..."} for incrementals
  status       text NOT NULL DEFAULT 'RUNNING',   -- 'RUNNING' | 'OK' | 'FAILED'
  object_path  text,                              -- Supabase Storage key
  size_bytes   integer,
  row_counts   jsonb,                             -- {"matches": 120, "events": 8412, ...}
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX backup_runs_tenant_started ON backup_runs (tenant_id, started_at DESC);
```

Constraints on `subdomain` (enforced in the action, not as CHECK — see drizzle bug): lowercase `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?`, not in the reserved list `www, admin, api, app, mail, cdn, assets, staging, dev, status, backup, docs`.

## 3. Global admin

### 3.1 AuthZ changes (`src/lib/authz.ts`)

- `isGlobalAdmin(userId)` — React-`cache`d single-row read of `users.is_global_admin`.
- `rolesFor(userId, tenantId)` (authz.ts:43): if global admin, return `["TENANT_ADMIN"]` synthetically. Because every existing gate (`getAuthContext`, `requireRole`, `authorizeMatch`, `gateCompetition`) funnels through `rolesFor`/`hasRole`, **no other permission code changes** — the global admin transparently has full admin in every tenant, and per-tenant permissions for everyone else are untouched.
- `requireGlobalAdmin()` — redirect-to-login / `notFound()` guard for the `/admin` segment.
- The last-admin guard (`access-actions.ts` `adminCount`) keeps counting only real `user_tenant_roles` rows — the global admin is not a member and never appears in the Access page member list.
- Seed: set `is_global_admin = true` for `SEED_ADMIN_EMAIL`'s user (one-off SQL or extension of `src/db/seed.ts`). No UI for granting it in this phase — deliberate: the flag is root-level, changing it stays a deliberate DB operation.

### 3.2 Admin console — `/admin` (new route segment, outside `/t/`)

Neutral platform styling (default tokens, no tenant branding), gated by `requireGlobalAdmin()` in `src/app/admin/layout.tsx`. Two nav sections: **Tenants** and **Backups**.

**`/admin` — tenant list.** One row/card per tenant: logo thumbnail, name, title, slug, subdomain (or "—"), counts (competitions / matches / members), last full backup age (red badge if > 26 h), soft-deleted state. Actions: **Open** (enter tenant dashboard), **Configure**, **Delete**. Primary CTA: **New tenant**.

**`/admin/tenants/new` — creation form.** Fields: name → auto-suggested slug (editable, immutable after creation — slugs are in printed QR codes), subdomain (optional), title, primary/secondary color, logo upload. Live preview panel rendering the tenant header chrome in **both** light and dark mode (§5.3). On submit: insert `tenants` + `tenant_branding`, `recordAudit` into the new tenant's own audit log, redirect to the new tenant's Access page with a hint to invite the first tenant admin (reuses existing `addMember` flow, `access-actions.ts:63`).

**`/admin/tenants/[tenantId]` — configure.** Reuses `BrandingForm` (extended per §5) plus global-admin-only fields: subdomain, slug display (read-only), member summary, backup history for this tenant with **Back up now**. Danger zone at the bottom (§3.4).

### 3.3 Server actions — new `src/lib/tenant-admin-actions.ts`

`createTenant`, `updateTenantConfig` (subdomain + delegating to branding update), `softDeleteTenant`, `restoreTenant`, `runTenantBackup` — all `requireGlobalAdmin()` + `sameOriginOk`-style origin check via the existing form/action plumbing (`action-state.ts` `FormState`), all audited.

### 3.4 Tenant deletion lifecycle

Hard-deleting a federation's season data on a misclick is the nightmare scenario, so:

1. **Soft delete**: type-the-tenant-name confirmation → a **final full backup is taken synchronously and must succeed** → `deleted_at = now()`. `getTenantBySlug` and the subdomain resolver treat `deleted_at IS NOT NULL` as not-found (all tenant URLs go dark immediately); tag `tenant:<slug>` revalidated.
2. **Grace period**: 7 days. Tenant shows as "Deleted — restorable until {date}" in `/admin` with a **Restore** action (clears `deleted_at`).
3. **Purge**: the daily backup cron (§7.3) hard-deletes tenants past grace — children first in FK order (`events`, `match_*`, `pool_teams`, `players`, `teams`, `pools`, `tournament_config`, `competition_branding`, `matches`, `competitions`, `csv_imports`, `audit_log`, `user_tenant_roles`, `tenant_billing`, `tenant_branding`, `tenants`), then storage logo objects. Backup objects are **kept** for the normal retention window.
4. The Test tenant and any tenant with a `LIVE` match cannot be soft-deleted.

## 4. Tenant switcher & login flow

**Switcher.** In the tenant header (`t/[tenantSlug]/layout.tsx:73-88`), the logo + wordmark becomes a dropdown trigger when the user has > 1 membership or is global admin (otherwise unchanged — single-tenant users never see it). Menu: the user's tenants (logo, name, their highest role as a caption), current one checked; global admins see **all** tenants plus a separator and "Manage tenants →" linking to `/admin`. Selecting navigates to `tenantUrl(tenant, "/dashboard")` (§6.3). Tenant context stays 100 % URL-derived — one tenant at a time, no ambient state to leak across tenants.

**Login destination** (`auth-actions.ts:50-54`, currently `LIMIT 1` via `getUserPrimaryTenantSlug`):
- global admin → `/admin` (or `redirectTo` if present);
- exactly one membership → that tenant's dashboard (unchanged);
- several → new `/select-tenant` page: branded tenant cards (logo, title, role). Chosen tenant stored in a `lastTenant` cookie, which becomes the default on the next login (straight through, switcher available to change).

## 5. Branding v2 — title, logo upload, color preview

### 5.1 Title

`tenant_branding.title` — the product name as this tenant's users see it. Display rule: `title ?? tenant.name`. Applied at:
- header wordmark (`t/[tenantSlug]/layout.tsx:88`);
- browser tab: new `generateMetadata` in the tenant layout (`title.template: "%s | {title}"`), overriding the root `"Volleyball Scoring Platform"` (`app/layout.tsx:17`) for all tenant pages including public scoreboard/results;
- login page keeps the neutral platform name (it isn't tenant-scoped — unless reached via a subdomain, §6.2, in which case it shows that tenant's title/logo).

`TenantBranding` interface + `getTenantBySlug` select list + `DEFAULT_BRANDING` (`tenant.ts:11-32`) gain the field; `updateBranding` (`branding-actions.ts:14`) validates length ≤ 60.

### 5.2 Logo upload (first Supabase Storage use in the project)

- New **public-read** bucket `branding` (private write; the app writes via the existing service-role client, `src/lib/supabase-admin.ts:7`).
- New action `uploadTenantLogo` in `branding-actions.ts`: TENANT_ADMIN (or global admin), accepts png/jpeg/webp/svg ≤ 1 MB, sniffs magic bytes (svg: sanitize or serve with `Content-Disposition`/`content-type` that prevents script execution — decide at implementation; simplest safe default: rasterize-or-reject svg), stores at `branding/{tenantId}/logo-{contentHash}.{ext}`, writes the public URL into `tenant_branding.logo_url`, deletes the previous object, revalidates `tenant:<slug>`.
- The existing URL text field stays as an "advanced" escape hatch. CSP already allows `img-src https:` (`next.config.ts:13`).

### 5.3 Colors — preserving dark & light

Keep today's model (single `primary`/`secondary` injected as CSS vars over both themes — already mode-safe). Additions:
- **Dual live preview** in `BrandingForm`: side-by-side light/dark mini-render of the header + a button + a score chip, updating as colors change.
- **Contrast validation** in `normalizeHex` flow: warn (not block) when primary fails WCAG AA against either theme's background token.
- Per-mode color overrides (`primary_dark` etc.): **deferred** — the var-injection point (`layout.tsx:40-50`) makes it a cheap later addition under `[data-theme="light"]` scoping if a real tenant needs it.

## 6. Subdomain routing (subdomain-ready dual mode)

### 6.1 Configuration

New env `NEXT_PUBLIC_ROOT_DOMAIN` (e.g. `volleyscore.com`). Unset ⇒ everything behaves exactly as today (pure `/t/{slug}` mode). When set: Vercel gets the apex + wildcard `*.{root}` domains (dashboard/DNS step, documented in README; wildcard needs the domain's nameservers on Vercel).

### 6.2 Proxy resolution (`src/proxy.ts`)

New first step, before the existing logic: if `host` = `{label}.{ROOT_DOMAIN}` and `label` isn't reserved (§2 list):
1. Resolve `label` → tenant slug via `GET /api/tenants/resolve?subdomain={label}` — a new Node route handler doing the DB lookup (proxy is edge, no DB; matcher already excludes `/api/*` so no recursion), responding with `Cache-Control: s-maxage=300, stale-while-revalidate=60`. The proxy additionally memoizes in a module-level Map (per-instance, 60 s TTL) so steady-state adds no fetch.
2. Unknown/deleted label → rewrite to a small "no such tenant" page (404).
3. Known → **rewrite** `/{path}` → `/t/{slug}/{path}` (internal; the browser URL stays `https://{label}.{root}/…`, satisfying the "link ends in .com" requirement). Requests already prefixed `/t/…` on a subdomain host are redirected to the canonical bare form to avoid duplicate URLs.

The rest of the proxy (public-path detection, optimistic auth) then operates on the rewritten path unchanged.

### 6.3 URL generation & sessions

- New helper `tenantUrl(tenant, path)` in `src/lib/tenant.ts`: `https://{subdomain}.{ROOT_DOMAIN}{path}` when both are configured, else `/t/{slug}{path}`. Used by the switcher, `/select-tenant`, share/QR links, and anywhere `NEXT_PUBLIC_APP_URL` is used to build tenant-facing absolute URLs today. In-tenant navigation stays relative, so pages work identically under both URL forms.
- **Auth cookies**: when `ROOT_DOMAIN` is set, pass `cookieOptions: { domain: ".{ROOT_DOMAIN}" }` to the Supabase clients (`supabase.ts`, `supabase-browser.ts`, proxy) so one session spans the apex (`/admin`) and every tenant subdomain — required for the global admin to hop tenants without re-login. `sameOriginOk` (`http.ts:18`) is unaffected (writes happen within one host), but verify during implementation.
- Changing a tenant's subdomain is global-admin-only (it's infrastructure); old subdomain simply stops resolving (no redirect chain to maintain — acceptable at this scale, note in admin UI).

## 7. Backups

**Layer 0 (context, not built here):** Supabase's own daily project backups / PITR remain the disaster-recovery floor. This feature adds *per-tenant, restorable-in-isolation, app-controlled* backups on top *(confirmed scope)*.

### 7.1 Export format

One gzipped JSON document per run, written by a shared `exportTenant(tenantId, scope?)` in new `src/lib/backup.ts`:

```jsonc
{
  "formatVersion": 1,
  "migrationJournalIdx": 7,          // from drizzle meta — guards restore against schema drift
  "kind": "FULL",                    // or "INCREMENTAL"
  "tenantId": "…", "exportedAt": "…",
  "scope": null,                     // or {"competitionId": "…"}
  "tables": {
    "tenants": [...], "tenant_branding": [...], "tenant_billing": [...],
    "users": [...],                  // members only: id, email, name
    "user_tenant_roles": [...],
    "competitions": [...], "tournament_config": [...], "competition_branding": [...],
    "pools": [...], "pool_teams": [...], "teams": [...], "players": [...],
    "matches": [...], "events": [...], "match_officials": [...],
    "match_signatures": [...], "match_sessions": [...], "csv_imports": [...],
    "audit_log": [...]
  }
}
```

All rows id-preserving (restores keep printed QR/scorer links valid). The three tables without `tenant_id` are reached via joins (`tournament_config`/`competition_branding` through `competitions`, `pool_teams` through `pools`). **Coverage test** (§9) introspects the drizzle schema and fails if a future table with `tenant_id` is missing from the export list — the classic silent-backup-rot failure mode.

### 7.2 Storage & retention

Private Supabase Storage bucket `backups` (service-role write, no public access; downloads via 60-minute signed URLs from the admin console only).

```
backups/{tenantId}/full/{YYYY-MM-DD}.json.gz
backups/{tenantId}/incremental/{ISO-ts}-{competitionId}.json.gz
```

Retention, enforced at the end of the daily cron: keep the newest **30 fulls** per tenant; delete incrementals older than the oldest kept full. Every run (including failures) is a `backup_runs` row.

### 7.3 Daily full — cron

`vercel.json` gains a second cron: `0 3 * * *` → `GET /api/cron/backup` (before the 05:00 reseed, so the Test tenant's day is captured pre-wipe). Handler mirrors `api/cron/reseed/route.ts`: `Bearer CRON_SECRET`, `maxDuration` as high as the plan allows (60 now; raise with Fluid/Pro). Iterates non-deleted tenants sequentially with a time guard — if the budget nears exhaustion, remaining tenants are recorded as `FAILED("time budget")` and surface in the console rather than silently skipped. Also performs retention pruning and grace-period purges (§3.4).

### 7.4 Incremental — event-triggered

*(confirmed trigger set: match status changes; competition or match creation.)* Unit of increment = a **competition-scoped snapshot** (the competition subtree: config, branding, pools, pool_teams, teams, players, matches, events, officials, signatures). This is a differential *snapshot* rather than a row-delta log — restorable standalone, immune to missed-delta corruption, and cheap at this data size.

- New `scheduleIncrementalBackup(tenantId, competitionId)` invoked inside `after()` (the post-response pattern already used for realtime broadcasts, `match-engine.ts:388-402`) from:
  - `derivedMatchColumns` callers **only when the derived status actually changed** (`appendMatchEvent`, `undoLastEvent`, `rewindMatch` — never on plain rallies);
  - `confirmMatchResult` / `reopenMatchResult` (`match-admin-actions.ts:89/:175`) and the signatures-complete transition (`api/matches/[id]/signatures/route.ts:348`);
  - competition creation (`competition-actions.ts:52`) and match creation (`schedule-actions.ts:42/:200`, `tournament-actions.ts:292/:398`, `csv-actions.ts:153`).
- **Debounce 5 min per competition** (a set ending fires many status changes in a burst): skip if the latest `backup_runs` incremental for that competition started < 5 min ago and is `RUNNING|OK`. No new infra needed; Upstash optional later.
- The Test tenant is excluded from event-triggered incrementals (nightly reseed churn would generate noise); its daily full still runs.

### 7.5 Restore & console

- `scripts/restore-backup.mts` (repo script, run manually — **restores are never triggered from the production app**): reads a backup file, verifies `migrationJournalIdx` compatibility, upserts in FK order into a target `DATABASE_URL`; `--dry-run` prints row counts. Serves three cases: single-tenant disaster restore, tenant portability, and staging-from-prod.
- `/admin/backups`: run history (tenant, kind, trigger, status, size, duration), per-tenant **Back up now**, signed-URL download. Failure of a cron full also goes to Sentry (`observability.ts`).

## 8. Test tenant

The existing demo tenant (slug `volleyball-scoring`, re-slugged from `fivb-demo` on 2026-07-28) **is** the Test tenant — all current competitions and matches already belong to it, so no data moves. Changes:
- rename `name` → `"Test"` (title stays "Volleyball Scoring" via `branding.title` so its public boards look unchanged); slug stays `volleyball-scoring` (printed QR codes; the `fivb-demo` 308 in `proxy.ts:23-27` remains intact);
- nightly reseed cron keeps targeting it (decision: keep the demo reseed until a first real tenant exists, then revisit);
- excluded from incremental backups (§7.4) and from deletion (§3.4).

## 9. Testing

- **Unit** (vitest, `src/__tests__/lib/`): global-admin `rolesFor` synthesis + `requireGlobalAdmin`; subdomain validation (reserved list, charset) and resolver behavior for unknown/deleted tenants; `tenantUrl` in both modes; export **coverage test** (schema-introspection vs export table list, §7.1); export row-count correctness against a seeded tenant; incremental debounce; retention pruning math; soft-delete guards (LIVE match, Test tenant, final-backup-must-succeed).
- **E2E** (playwright): admin creates tenant → appears in list → open → branding (title/colors) visible in header and tab title in both themes → switcher hops back; manual backup → `OK` run row appears.
- **Manual on preview**: wildcard-domain flow can only be fully exercised once a real domain exists — until then, subdomain resolution is covered by unit tests + a preview-deploy check with `curl -H "Host: x.{root}"`.

## 10. Build order (each step independently shippable)

1. **Migration + global admin** — schema changes (§2), authz synthesis, seed flag. Small, unlocks everything.
2. **Admin console + tenant CRUD + Test-tenant rename** — §3, §8 (without deletion purge job).
3. **Switcher + login flow** — §4.
4. **Branding v2** — title, logo upload (first Storage bucket), color preview — §5.
5. **Backups** — bucket, exporter + coverage test, cron full, event incrementals, retention, console page, restore script — §7. (Independent of 3-4; can be built second if backups are the priority.)
6. **Subdomain routing** — §6 behind `NEXT_PUBLIC_ROOT_DOMAIN`, inert until a domain is bought; then the Vercel domain/DNS step + cookie-domain switch.
7. **Deletion lifecycle** — soft delete, grace, purge in cron — §3.4 last, once backups are proven.

## 11. Open items (non-blocking, decide during implementation)

- Domain purchase + name; whether the Vercel plan allows cron `maxDuration` > 60 s (matters only once tenants × data volume grows).
- SVG logo handling: sanitize vs reject (§5.2).
- Whether the nightly demo reseed survives the arrival of the first real tenant.
- Per-mode (dark/light) primary-color overrides — deferred (§5.3).
- Granting `is_global_admin` via UI — deliberately out of scope (DB-only operation).
