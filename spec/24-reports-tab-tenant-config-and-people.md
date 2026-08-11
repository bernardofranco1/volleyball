# 24 — Reports tab, tenant configuration (reports & disciplines), and people management

**Status: phases A + B + C + F IMPLEMENTED 2026-08-11. Phase D deliberately NOT
run — see below. Phase E blocked on FIVB IT (§7.4).** Product-owner decisions
confirmed 2026-08-11 (§1). VIS field verification done against the vis-connector
repo 2026-08-11 (§7).

Migrations applied: `0009` (tenant_config), `0010` (people, person_roles,
team_staff, nullable person links). Backfill run: 62 roster rows and 4 officials
rows linked to 64 people, and `scripts/backfill-people.ts` is idempotent (a
second run reports 0 to do). Test suite 361 → 418.

**Phase D (dropping `players.first_name/last_name/full_name` and making the
person links NOT NULL) has not been run, and must not be run casually.** It is
irreversible on a live database, and the read paths currently
`coalesce(people.…, players.…)` precisely so both linked and un-linked rows work
— those COALESCEs reference the columns D drops, so D is not just a migration:

1. Remove the COALESCE fallbacks in `listPlayersByTeam`, `loadMatchRosters`
   (`src/lib/competitions.ts`) and `loadMatchReport` (`src/lib/match-report.ts`).
2. Stop writing the name columns in `createPlayer` (`src/lib/team-actions.ts`)
   and `importRoster` (`src/lib/csv-actions.ts`).
3. Re-run the backfill, confirm `select count(*) from players where person_id is
   null` is 0, then `SET NOT NULL` on `players.person_id` and
   `match_officials.person_id`.
4. Only then drop the three name columns, and bump `MIGRATION_JOURNAL_IDX`.

Until then the expand phase is fully functional and strictly additive.

Scope: four features, one spec —

1. A **Reports tab** on the match detail page for finished matches, all disciplines.
2. **Per-tenant report-type selection** (allow-list) on the tenant settings page.
3. **Per-tenant discipline availability** on the tenant settings page.
4. **People management**: tenant-level registry of players, referees, coaches and
   scorers, with competition rosters and match officials migrated to reference it —
   fields shaped for a potential future push integration into FIVB VIS.
5. **Architecture re-evaluation** for concurrent multi-tenant load — 10 tenants
   active at once, multiple matches scored simultaneously with their scoreboards in
   use — and the infrastructure escalation verdict (§9).

Plus the navigation rework these imply (§8).

---

## 0. Starting point (what already exists)

| Area | Today | Where |
|---|---|---|
| Main nav | Hardcoded 4-entry array: Home / Competitions / Matches / Settings. No active state, no role gating (viewers see links that 404) | `src/app/t/[tenantSlug]/layout.tsx:23-28,186-196`, `src/components/MobileNav.tsx` |
| Match detail page | Single long scroll, `ADMIN_ROLES` only, six export buttons in the header row. **No tabs** | `…/competitions/[competitionId]/matches/[matchId]/page.tsx:173-233` |
| Tab primitive | Exists only for competitions (`overview\|teams\|schedule\|standings`) | `src/components/admin/CompetitionTabs.tsx` |
| Report types | URL param only: `?type=official\|sheet\|log\|` (default report) on one route, gated `SCORING_ROLES`; plus `export.vsr`, `export.timings`. Official e-scoresheet renderers exist for BEACH/INDOOR only; GRASS/LIGHT fall back to the generic sheet | `src/app/api/matches/[id]/export.pdf/route.ts:47-73`, `src/lib/scoresheet/{beach,indoor}-official.ts`, `src/lib/scoresheet-pdf.ts:156-159` |
| Per-tenant config | **None.** Only `tenant_branding` and (inert) `tenant_billing`. No feature-flag mechanism; flags exist only per-competition via `tournament_config` | `src/db/schema.ts:41-53,671-685,146-220` |
| Disciplines | 4-value enum on `competitions` (immutable after creation) copied onto `matches`. Chosen only in `NewCompetitionForm`. **No tenant restriction anywhere** | `src/engine/types.ts:3-10`, `src/db/schema.ts:115-117,287-289`, `src/lib/domain.ts:16-19`, `src/components/admin/NewCompetitionForm.tsx:44-47` |
| Finished matches | Tenant match centre with `scheduled\|live\|finished` filter (`finished` = `FINISHED` only; `PENDING_CONFIRMATION`/`ABANDONED` fall out of every bucket) | `src/app/t/[tenantSlug]/matches/page.tsx:19-23`, `src/lib/competitions.ts:190-245` |
| Players | Competition-scoped: `players` → `teams` → `competitions`. No tenant-level person registry, no reuse across competitions, no DOB/nationality/photo | `src/db/schema.ts:245-266` |
| Officials | `match_officials`: 10 FIVB roles, **free-text name/country/level typed fresh per match**, no FK to any person. `source: "IMPORT"` reserved, unused | `src/db/schema.ts:458-494`, `src/components/admin/MatchOfficialsForm.tsx` |
| Coaches | No entity. Coach box on official scoresheets prints blank (spec/21 gap G4) | `src/lib/scoresheet/indoor-official.ts:567-573` |
| Scorer names | Signature capture upserts SCORER/ASSISTANT_SCORER names into `match_officials` | `src/app/api/matches/[id]/signatures/route.ts:327-340` |
| VIS export contract | `match_officials.role` → VSR fields (`FIRST_REFEREE→referee1` … `ASSISTANT_SCORER→scorer2`) | `src/lib/vsr/build.ts:181-186` |

What is missing → section: match-page tabs + report surface (§3), tenant config storage
+ settings UI (§2, §4, §5), discipline enforcement (§5), people registry + migration
(§6), VIS field mapping (§7), nav fixes (§8).

---

## 1. Confirmed decisions (product owner, 2026-08-11)

1. **Reports tab lives on the match detail page only** — no new top-level Reports hub.
   *(confirmed)*
2. **Per-tenant report selection is an allow-list**: tenant config holds the set of
   enabled report types; the Reports tab offers only those. Official e-scoresheet
   auto-falls back to the generic sheet for GRASS/LIGHT, as the export route does
   today. *(confirmed)*
3. **People: full migration to a central registry.** Rosters and match officials
   become references to tenant-level `people`; free-text person entry is removed from
   the UI. All person edits happen in one place. *(confirmed)*
4. **Report access: all tenant roles** (including VIEWER) can open a finished match's
   Reports tab and download the enabled report types. Technical exports (event-log
   PDF, VSR JSON, timings JSON) stay behind `SCORING_ROLES`. *(confirmed)*

Assumptions made without confirmation — flagged, reversible:

- **A1** Disabling a discipline blocks *new* competition creation only; existing
  competitions/matches in that discipline stay visible and functional.
- **A2** The Reports tab is shown for `FINISHED` matches; for `PENDING_CONFIRMATION`
  it shows the same list with the existing "NOT FINAL" watermark behaviour; hidden for
  earlier statuses. `ABANDONED` included (forfeit sheets are still records).
- **A3** Line-judge slots on the officials form draw from people with role REFEREE
  **or** SCORER (VIS has no line-judge entity either — §7.3).
- **A4** Default tenant config enables **all four disciplines and all six report
  types** — zero behaviour change for existing tenants until an admin narrows it.

---

## 2. Data model changes

Workflow: `drizzle-kit generate` → review SQL → `npm run db:migrate`. **Never
`drizzle-kit push`** (CHECK-introspection bug, spec/17:146). Current head is `0008`;
this spec produces `0009` (expand) and, after backfill verification, `0010` (contract).

### 2.1 `tenant_config` (new, 1:1 with tenants — same pattern as `tenant_branding`)

```sql
CREATE TABLE tenant_config (
  tenant_id            text PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled_disciplines  jsonb NOT NULL DEFAULT '["BEACH","INDOOR","GRASS","LIGHT"]',
  enabled_report_types jsonb NOT NULL DEFAULT
    '["OFFICIAL_SCORESHEET","SCORESHEET","MATCH_REPORT","EVENT_LOG","VSR_LOG","TIMINGS"]',
  updated_at           timestamp NOT NULL DEFAULT now()
);
```

- Missing row ⇒ defaults (mirror the `DEFAULT_BRANDING` pattern in `src/lib/tenant.ts`).
- Arrays validated in the server action against `DISCIPLINES` (`src/lib/domain.ts`) and
  a new `REPORT_TYPES` const (§4.1); never trust raw jsonb at read time — parse through
  a zod-style guard in the read helper.
- Read helper joins into the cached `getTenantBySlug` bundle (tag `tenant:<slug>`), so
  `updateTag('tenant:<slug>')` on save invalidates it — same as branding.

### 2.2 `people` (new)

Fields deliberately shaped to VIS person data (§7). Units are human units (cm/kg) —
VIS's 1/1000-mm scaling is a connector concern, not a storage concern.

```sql
CREATE TABLE people (
  id              text PRIMARY KEY,                    -- cuid2
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name      text,
  last_name       text,                                -- nullable: VIS has players with no surname (§7.5)
  display_name    text NOT NULL,                       -- shirt/scoreboard label ≈ VIS TeamName; NEVER a surname fallback (§7.5)
  gender          text CHECK (gender IN ('M','W')),    -- VIS PersonGender; numeric mapping [TO CONFIRM] (§7.4)
  birthdate       date,
  federation_code text,                                -- 3-letter (NOR, ITA, …), as VIS uses
  height_cm       integer,
  weight_kg       integer,
  position        text CHECK (position IN
    ('SETTER','WING_SPIKER','MIDDLE_BLOCKER','LIBERO','UNIVERSAL','OPPOSITE')), -- VIS PlayerVolleyPosition 1–6
  spike_reach_cm  integer,                             -- VIS VolleyHighSpike / BeachHighSpike
  block_reach_cm  integer,                             -- VIS VolleyHighBlock / BeachHighBlock
  handedness      text CHECK (handedness IN ('LEFT','RIGHT')),  -- NULL = unknown; VIS 3/4 (§7.5)
  photo_url       text,
  referee_level   text,                                -- free text until FIVB confirms GetReferee fields (§7.4)
  vis_person_no   integer,                             -- VIS person `No`; THE join key for any future sync
  notes           text,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now(),
  deleted_at      timestamp                            -- soft delete, matches tenants pattern
);
CREATE INDEX people_tenant_idx ON people(tenant_id);
CREATE INDEX people_tenant_name_idx ON people(tenant_id, last_name, first_name);
CREATE UNIQUE INDEX people_tenant_vis_uq ON people(tenant_id, vis_person_no)
  WHERE vis_person_no IS NOT NULL;
```

```sql
CREATE TABLE person_roles (
  id        text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('PLAYER','REFEREE','COACH','SCORER')),
  UNIQUE (person_id, role)
);
CREATE INDEX person_roles_tenant_role_idx ON person_roles(tenant_id, role);
```

A person can hold several roles (a coach who referees). Role-specific attributes
beyond `referee_level` wait for the FIVB field lists (§7.4) — do not invent columns.

### 2.3 `players` → roster entries referencing people (expand → backfill → contract)

**0009 (expand):**

```sql
ALTER TABLE players ADD COLUMN person_id text REFERENCES people(id);
```

**Backfill script** (`scripts/backfill-people.ts`, run once per environment, idempotent):
one `people` row per existing `players` row (no fuzzy dedupe — merging is a later,
human-driven feature; VIS itself ships `MovePlayerReferences` for exactly this reason).
`display_name` ← `full_name`; `first_name`/`last_name` copied; role `PLAYER`. Then
`SET NOT NULL` on `players.person_id`.

**0010 (contract), only after the UI reads via the join everywhere:**

```sql
ALTER TABLE players DROP COLUMN first_name, DROP COLUMN last_name, DROP COLUMN full_name;
```

`players` keeps: `id, team_id, tenant_id, person_id, jersey_number, is_captain,
is_libero, role` — it is now a pure roster-membership row (jersey/captain/libero are
per-competition facts and stay here; VIS agrees: shirt number lives on the tournament
*registration*, not the person — §7.5).

### 2.4 `match_officials` → references + print snapshot

```sql
ALTER TABLE match_officials ADD COLUMN person_id text REFERENCES people(id);
```

Backfill: create a person per distinct `(tenant_id, name)` among existing rows —
referee-type roles ⇒ role REFEREE, SCORER/ASSISTANT_SCORER ⇒ SCORER, line judges ⇒
REFEREE (A3) — then `SET NOT NULL`.

**Keep `name`, `country`, `level` as a snapshot of what was printed on the scoresheet
at match time.** The scoresheet is a historical record; renaming a person later must
not silently rewrite an already-signed sheet. The officials form (§6.3) fills the
snapshot from the picked person at save time. (Player names, by contrast, read live
through the join — a reprint after a person edit will reflect the edit; accepted
consequence of decision 3, listed in §10.)

### 2.5 `team_staff` (new — coaches on the bench, spec/21 gap G4)

```sql
CREATE TABLE team_staff (
  id        text PRIMARY KEY,
  team_id   text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id),
  function  text NOT NULL CHECK (function IN
    ('HEAD_COACH','ASSISTANT_COACH','ASSISTANT_COACH_2','DOCTOR','TRAINER','MANAGER')),
  UNIQUE (team_id, function)
);
```

Function list mirrors VIS `VolleyTeam` staff fields (`HeadCoachName/CtryCode`,
`AssistCoachName`, `Assist2`, `Doctor`, `Trainer`, `Manager` — §7.3), so a future
VIS push has a 1:1 target. Head coach flows into the scoresheet coach box and the VSR
staff block.

---

## 3. Reports tab (match detail page)

### 3.1 Route structure

Convert the match page into a tabbed shell, same pattern as `CompetitionTabs`:

- `…/matches/[matchId]/page.tsx` — **Overview** tab = the existing page, unchanged
  content, still `ADMIN_ROLES`.
- `…/matches/[matchId]/reports/page.tsx` — **Reports** tab, new, gated
  `requireMatchRole(matchId, VIEW_ROLES)` (decision 4). Separate route (not `?tab=`)
  precisely so the two tabs can carry different authz.

New `src/components/admin/MatchTabs.tsx` (`Tab = "overview" | "reports"`), rendered by
a shared match header extracted from the current page (team names, status badge,
competition · discipline · round · court · time). The Overview tab link is hidden for
viewers (they'd 404); for viewers the header shows the Reports tab only.

### 3.2 Reports tab content

For each **enabled** report type (tenant allow-list ∩ discipline availability), one
row: label, format badge (PDF/JSON), description, download link to the existing export
URLs. Grouping:

- **Match reports** (visible to all tenant roles): Official e-scoresheet
  (`?type=official`; label switches to "Scoresheet (generic layout)" for GRASS/LIGHT),
  Scoresheet (`?type=sheet`), Match report (`?type=` default).
- **Technical exports** (rendered only for `SCORING_ROLES`): Event log (`?type=log`),
  VSR log (`export.vsr`), Timings (`export.timings`).

Visibility per status: A2. The six export buttons in the Overview header are
**removed** (replaced by the tab) — one home for reports, not two.

### 3.3 Export route changes (`src/app/api/matches/[id]/export.pdf/route.ts` + vsr/timings)

1. Authz split: `?type=` ∈ {official, sheet, default} ⇒ `authorizeMatch(id,
   VIEW_ROLES)`; `?type=log`, `export.vsr`, `export.timings` ⇒ `SCORING_ROLES`
   (unchanged).
2. Enforce the tenant allow-list server-side: map `?type=`/route → `ReportType`; if
   not enabled for the match's tenant → 404. UI hiding is not enforcement.
3. No renderer changes. GRASS/LIGHT official fallback already exists at the route.

### 3.4 Reaching reports

- Matches list (`matches/page.tsx:72-77`): for `FINISHED` matches, the card link for
  **every** role goes to the Reports tab (admins get the tab switcher there anyway).
- Fix while in the file: `listTenantMatches` `finished` filter becomes
  `IN ('FINISHED','ABANDONED')` and a `pending` state stops falling through the cracks
  (`src/lib/competitions.ts:210-214`) — otherwise abandoned matches have reports but
  no way to be found.

---

## 4. Per-tenant report types (tenant settings)

### 4.1 Domain

`src/lib/domain.ts`:

```ts
export const REPORT_TYPES = ["OFFICIAL_SCORESHEET","SCORESHEET","MATCH_REPORT",
  "EVENT_LOG","VSR_LOG","TIMINGS"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
```

Mapping to export URLs lives beside it (single source for the tab, the settings form
and the route guard).

### 4.2 Settings UI

New **Reports** section on `…/settings/page.tsx` (TENANT_ADMIN): six checkboxes with
short descriptions, saved via `updateTenantConfig` server action in a new
`src/lib/tenant-config-actions.ts` (validate against `REPORT_TYPES`, `recordAudit`,
`updateTag('tenant:<slug>')`). Guard: at least one of the three match-report types
must stay enabled (an empty Reports tab for all tenants is a misconfiguration).

Same form exposed on the global-admin tenant page (`/admin/tenants/[tenantId]`),
next to `TenantConfigForm` — admin console stays English-only.

---

## 5. Per-tenant disciplines (tenant settings)

### 5.1 Settings UI

New **Disciplines** section on the same settings page + admin tenant page: four
checkboxes over `DISCIPLINES`, min one enabled. Saved through the same
`tenant-config-actions.ts`.

### 5.2 Enforcement points (all four must land together)

| Where | Change |
|---|---|
| `NewCompetitionForm.tsx:44-47` | Options = enabled disciplines only; if exactly one, render it fixed |
| `createCompetition` server action | Reject a disabled discipline (server-side truth; the form is cosmetic) |
| `CompetitionFilters.tsx:73`, `matches/page.tsx:179-183` | Filter dropdowns list enabled disciplines ∪ disciplines actually present in existing data (A1 — legacy competitions stay reachable) |
| `db:seed:demo` (`src/lib/demo-seed.ts`) | Seeds only enabled disciplines for the target tenant |

Per A1, nothing else changes for existing data: engines, scoring, exports for a
disabled discipline's existing matches keep working.

---

## 6. People management

### 6.1 New surface: `/t/[slug]/people`

- **Nav entry "People"** (i18n key `nav.people`), visible to `ADMIN_ROLES`.
- Directory page (`ADMIN_ROLES`): search (name, `ILIKE` over first/last/display),
  role filter chips (Players / Referees / Coaches / Scorers), paginated 50/page
  (reuse `MATCHES_PAGE_SIZE` pattern). Row: name, roles, federation, VIS no badge.
- Person editor (`people/[personId]/page.tsx`): all §2.2 fields + role checkboxes +
  where-used panel (rosters, officials slots, team staff — read-only list). Photo:
  URL field in v1; file upload reuses the branding-bucket magic-byte pattern later.
- Server actions in `src/lib/people-actions.ts` (`createPerson`, `updatePerson`,
  `softDeletePerson` — blocked while the person is referenced by a non-finished
  match), reads in `src/lib/people.ts`. Audit every mutation.

### 6.2 Rosters become pickers (`…/competitions/[competitionId]/teams`)

- `AddPlayerForm` → person autocomplete (people with role PLAYER, this tenant) +
  inline "New person" mini-form (first/last/display name only; details later in the
  editor). On add: insert `players` row with `person_id` + jersey/captain/libero.
- Inline roster row edit keeps jersey/C/L; name edits move to the person editor
  (link on the row). `team-actions.ts` `updatePlayer` drops name params.
- **CSV roster import** (`csv-actions.ts:188`): per row, match an existing person on
  exact `(first_name, last_name)` within the tenant (case-insensitive); else create
  one. Report "matched N / created M" in the import summary. No fuzzy matching (§10).
- Engine/PDF read paths (`listPlayersByTeam`, `loadMatchRosters`,
  `match-report.ts` rosters) switch to the `players ⋈ people` join. Contract
  migration 0010 only after these are green.

### 6.3 Officials become pickers (`MatchOfficialsForm.tsx`)

- Each of the 10 role rows: person autocomplete filtered by role (REFEREE roles →
  referees; SCORER/ASSISTANT_SCORER → scorers; line judges per A3) + inline create.
- `saveMatchOfficials` (`match-admin-actions.ts:263`) writes `person_id` and copies
  `name` (display), `country` (federation_code), `level` (referee_level) into the
  snapshot columns. Free-text fields disappear from the form.
- Signature-time scorer upsert (`signatures/route.ts:327-340`): if an officials row
  exists, update snapshot name only; if none, create a person with role SCORER from
  the typed name, then the row. Keeps the sign-off flow one-screen.
- VSR mapping (`vsr/build.ts:181-186`) unchanged — reads the snapshot.

### 6.4 Team staff / coaches

Coach picker on the team roster page (people with role COACH) writing `team_staff`.
Head coach feeds: scoresheet coach box (`indoor-official.ts:567-573`,
`beach-official.ts:308-311`) and VSR staff/`rosterApprovals` (`vsr/build.ts:80,105`).
This closes spec/21 gap G4 for the data side (bench function codes on sanctions remain
out of scope here).

---

## 7. VIS field verification (done 2026-08-11, against `~/vis-connector`)

Question asked: *will all fields per group pre-exist in VIS, ahead of a potential
integration pushing people from our system into VIS?* Answer per group:

### 7.1 Players — **fully verified ✅**

Every `people` field maps to a documented or production-proven VIS field:

| ours | VIS (indoor master `GetPlayer`) | VIS (beach live `Player`) |
|---|---|---|
| `vis_person_no` | `No` | `No` |
| `first_name` / `last_name` | `FirstName`/`LastName` (alias `…Player`) | `FirstName`/`LastName` (required) |
| `display_name` | `TeamName`/`TeamNamePlayer` | `TeamName` (required) |
| `gender` | `Gender` | — (via team/event) |
| `birthdate` | `Birthdate` (xs:date) | `Birthdate` |
| `federation_code` | `FederationCode` | — (inherited from `Team/@FederationCode`) |
| `height_cm` / `weight_kg` | `Height` / `Weight` (×10⁻⁴ / ×10⁻⁶ scaling in connector) | same |
| `position` | `VolleyPosition` (enum 0–6) | n/a |
| `spike_reach_cm` / `block_reach_cm` | `VolleyHighSpike` / `VolleyHighBlock` | `BeachHighSpike` / `BeachHighBlock` |
| `handedness` | `Handedness` (empirical 1/3/4) | — |
| `photo_url` | `PortraitPhotoUri`, `NoPhoto`, `PhotoUrl` (registration) | — |
| roster `jersey_number`, `is_captain`, `is_libero` | tournament registration: `NoShirt`, `IsCaptain`, `IsLibero` | `Team/@NoShirt1/2` |

Write requests exist: `SavePlayer` (40006), `SaveVolleyPlayer` (58004),
`SaveTournamentPlayer` (74002), `SavePerson` (39002), `MovePlayerReferences` (40005).
Payload shapes are **not** documented — see §7.4.

### 7.2 Referees — **identity verified, professional fields not**

Documented (live-feed XSDs, required): `No`, `FirstName`, `LastName`,
`FederationCode`, `Gender` — all covered by `people`. The registration record behind
`GetReferee`/`SaveReferee` (level, languages, categories, availability) is **not in
the public docs**; our `referee_level` free-text column is a placeholder until FIVB IT
supplies the field list. Full module exists in VIS: get/list/save/delete, ID cards,
per-year match counters, event nomination (`NominateEventReferee` 25005), match
evaluations (57xxx).

### 7.3 Coaches and scorers — **the two weak spots, by VIS design**

- **Coaches:** `GetCoach`/`GetCoachList`/`RegisterCoach`/`SaveCoach` (14000–14003)
  exist but have zero documented fields. In match data, bench staff are **name +
  country-code strings with no person IDs** (`HeadCoachName/CtryCode` etc. on
  `VolleyTeam`). Beach has no coach fields at all.
- **Scorers:** **VIS has no scorer entity and no scorer request.** Indoor
  `VolleyMatch` carries scorer/assistant-scorer/line-judge×4 as flat
  first/last/country **strings**; beach not even that. The nearest entity is
  `GetOffical`/`SaveOfficial` (37xxx — typo is real in the API), fields undocumented.
- Consequence: our scorer (and partially coach) registry is **local-first**. It can
  populate VIS's string fields on match upload, but cannot round-trip people as
  entities unless FIVB confirms `SaveOfficial`/`SaveCoach` semantics.

### 7.4 Blockers to resolve with FIVB IT before any VIS push is specified

1. Field lists for `GetReferee`/`SaveReferee`, `GetCoach`/`SaveCoach`,
   `GetOffical`/`SaveOfficial` (server returns only permitted fields; discovery
   requires credentials or docs).
2. `SavePerson` (39002) semantics: is Person the master record with role extensions
   on one shared `No` space? (No `GetPerson` exists in the 326-request catalogue.)
3. Write payload shapes for the `Save*`/`Nominate*` requests. **Never probe writes
   against production VIS** — a guest write probe erased a real match result on
   2026-07-29 (vis-connector `docs/INCIDENT-2026-07-29-337016.md`). Docs or FIVB
   only.
4. Gender numeric↔letter mapping (`0|1` vs `M|W`) and the authoritative handedness
   enum.
5. A sandbox event + write-scoped service account for validation.

### 7.5 VIS quirks already baked into this design

- `display_name` is a separate column because VIS's `TeamName` is a shirt label, not
  a surname — treating it as one corrupted names in production (stats-hub incident).
- `last_name` is nullable: real VIS players exist without one.
- Registration `No` ≠ person `No` in indoor data; we only ever store the **person**
  `No` in `vis_person_no`.
- Human units in our DB; VIS 1/1000-mm / 1/1000-g scaling stays in the connector.
- `handedness` NULL = unknown (VIS code 1); LEFT = 3, RIGHT = 4 (empirical).

---

## 8. Navigation rework

Nav becomes: **Home · Competitions · Matches · People · Settings** — Reports stays
inside the match page (decision 1).

Fixes shipped with it (`layout.tsx:23-28,186-196` + `MobileNav.tsx`):

1. **Role-gate the entries.** VIEWER: Home, Matches. SCORER: + nothing else.
   ADMIN_ROLES: + Competitions, People. TENANT_ADMIN: + Settings. Nav entries gain a
   `roles` field; the layout already has the auth context to filter.
2. **Active state** via `usePathname()` prefix match (the nav must become a client
   component or pass the path down — follow `CompetitionTabs`' styling).
3. Dashboard cards (`dashboard/page.tsx:9-13`) mirror the same role-filtered list,
   adding People.
4. i18n: `nav.people`, `match.tabs.*`, `settings.reports.*`, `settings.disciplines.*`,
   `people.*` keys in all 5 locales (`src/lib/i18n/messages.ts`).

Settings page section order: General · Branding · **Disciplines** · **Reports** ·
People & security.

---

## 9. Architecture re-evaluation — 10 tenants, concurrent matches, concurrent scoreboards

Requested 2026-08-11. Grounded in a full trace of the runtime path (citations below)
and the deployed infrastructure as of 2026-08-11: Vercel **Hobby** personal team
("Bernardo Franco's projects", region `dub1`, confirmed via the Vercel API), Supabase
tier `[TO CONFIRM — likely Free]`, and `.env` showing **no Upstash, no Sentry DSN, no
SMTP** configured.

### 9.1 How live data actually flows today

- Writes: one **API route** per rally (`POST /api/matches/[id]/events`), ≈7 DB round
  trips + 1 Supabase Auth HTTP call + 1 rate-limit check each (`src/lib/authz.ts:29-74`,
  `src/lib/match-engine.ts:68-201,517-523`). Event-sourced state with a snapshot every
  5 events, so reads replay only the tail.
- Fan-out: after the write, the server POSTs a **signal-only broadcast**
  (`{lastSequence}`) to Supabase Realtime over HTTP (`src/lib/realtime.ts:19-61`);
  clients then refetch `GET /api/matches/[id]/state`. No `postgres_changes`, no WAL
  coupling — the right shape for fan-out.
- Clients: public scoreboard = 1 websocket + **10 s polling backstop**; team tablet =
  1 websocket + 15 s backstop + a **4 s interrupt poll**; scorer console = 1 websocket
  (2 channels) + 25 s backstop that correctly uses the cheap `?since=` → 204 path
  (`ScoreboardDisplay.tsx:123-157`, `TeamTablet.tsx:80-132`,
  `match-provider.tsx:306-345`).
- DB access: postgres.js singleton, **`max: 5` connections per warm instance,
  `max_pipeline: 0`** — mandatory since the 2026-07-30 production incident where
  pipelining wedged Supavisor transaction-pooler connections permanently
  (`src/db/index.ts:19-35`, spec/23:9). Excess concurrency queues in-process.
- Everything renders `force-dynamic`; the only CDN-cached endpoints are tenant
  resolve and finished-competition results.csv. **`/state` — the highest-volume
  endpoint — has no cache header** (`state/route.ts`).

### 9.2 Verdict per scenario

**S1 — 10 tenants' users working concurrently (admin/browsing, no live matches):
fine as-is, no headroom concern.** All queries are tenant-scoped and indexed, the
tenant lookup is cached (60 s, tagged), and Vercel scales instances horizontally.
Nothing to do.

**S2 — 10–20 matches live at once across tenants, scoreboards = venue displays
(1–3 per match): the architecture holds; the plan tiers don't.** Aggregate write
load is trivial (~20 matches ≈ under 1 rally/second total ⇒ ~10 DB queries/s on the
hot path). ~60–120 realtime connections sits under even the Free-tier cap (200).
The real exposures at S2 are operational: the tablet 4 s poll (2 queries/tick ⇒
~1,200 queries/min at 20 matches × 2 tablets — §9.3.4), the nightly backup cron's
50 s sequential budget failing at 10 tenants (`cron/backup/route.ts:22`,
spec/23:205), the ~2-emails/hour Supabase mailer fallback during user onboarding
(`src/lib/email.ts:6-7`), and Vercel Hobby's licence itself (§9.4).

**S3 — S2 plus public spectators on their phones (say 100 viewers/match ⇒ ~2,000
clients): not fine as-is.** Four constraints bind, none architectural — all are
endpoint/configuration-level (§9.3).

### 9.3 Binding constraints, worst first

1. **Public boards never use the `?since=` fast path.** `ScoreboardDisplay.tsx:100`
   and `TeamTablet.tsx:59` fetch the full state every backstop tick; the 204 path
   exists (`state/route.ts:33-39`) but only the scorer console uses it. Per viewer
   that's ~8 uncached invocations / ~16 DB queries per minute; at 2,000 viewers
   ≈ **270 req/s and ~530 DB queries/s** against `max: 5`-per-instance pools.
2. **Supabase Realtime concurrent-connection cap** — 200 Free / 500 Pro included,
   then ~$10 per 1,000 peak connections. spec/00 states its scale thresholds in
   *matches*; the binding unit is *connections (viewers)*. Beyond the cap joins fail
   silently and the polling backstop becomes the only path — i.e. the load transfers
   to exactly the endpoint in (1).
3. **`/state` rate limit is per venue-NAT IP** (30/10 s per `ip:match`,
   `state/route.ts:29`) — ~10 spectators on one venue Wi-Fi already trip it, 429ing
   legitimate viewers. And with no Upstash configured the limiter is per-instance
   in-memory, so the effective limit is nondeterministic and fails open.
4. **Tablet interrupt poll**: 4 s interval, unrate-limited, 2 queries/tick, and it
   keeps polling after the match finishes (`TeamTablet.tsx:123-132`).
5. **Backup cron** (§9.2) and **`authorizeMatch`'s Auth HTTP round trip** on every
   authed request (`authz.ts:29-35` uses `getUser()`; the proxy already switched to
   local JWKS `getClaims()` — `src/proxy.ts:284-295`).

### 9.4 Infrastructure escalation — the answer

**No re-architecture is needed.** Event-sourced engine + snapshot cache +
signal-broadcast-then-refetch is the correct shape for this load profile; single
region `dub1` colocated with Supabase `eu-west-1` is right. What needs to move is
plans, config and a handful of endpoints:

| Item | Now | Needed | When |
|---|---|---|---|
| Vercel | **Hobby** (personal team) | **Pro, ~$20/mo.** Hobby's licence is non-commercial — running FIVB/tenant events on it is a terms problem before it is a capacity one. Pro also lifts cron limits (Hobby = daily-only schedules; today's two daily crons only just comply) and function-duration headroom for the backup cron | **Before any real tenant use (S1)** |
| Supabase | `[TO CONFIRM — likely Free]` | **Pro, ~$25/mo** (+ compute add-on only if pooler saturates — not expected at S2). Free pauses after 7 days' inactivity, caps DB at 500 MB (the event log grows), 200 realtime connections, 2M realtime msgs/mo | **Before S2** |
| Upstash Redis | absent (in-memory fallback) | Configure it (free tier suffices) so rate limits are shared and deterministic | Before S2 |
| SMTP (e.g. Resend) | absent (~2 emails/h fallback) | Needed to onboard 10 tenants' users | Before S1 onboarding |
| Sentry DSN | absent — all swallowed-error captures are no-ops | Enable before scale; otherwise realtime/backup/limiter failures are invisible | Before S2 |
| Realtime headroom | 200 connections | **Decide the spectator strategy** (open item): (a) keep websockets and pay peak-connection overage (~$10/1,000 above Pro's 500), or (b) public spectators default to `?mode=poll` + a CDN micro-cache on `/state` (`s-maxage=1, stale-while-revalidate`), reserving websockets for venue displays/scorer/tablets. (b) is cheaper and degrades more predictably; needs expected viewer numbers to choose | Before S3 |

Steady-state cost: **≈$45–50/mo for S1/S2** (Vercel Pro + Supabase Pro + free
Upstash/Resend tiers), matching what spec/00:25-34 already envisioned; S3 adds either
realtime overage or Vercel usage on the poll path — both tens of dollars at these
numbers, not hundreds.

### 9.5 Code work that beats infrastructure spend (new Phase F)

**Status: IMPLEMENTED 2026-08-11.** Measured against the pre-change build on the
same machine and DB (production build, real Supabase, beach match at sequence 105):

| Measurement | Before | After |
|---|---|---|
| `/state` backstop probe | full 200, 1811 bytes, 138.8ms median | **204, 0 bytes, 69.6ms median** |
| Board backstop request | `GET /state` → 200 every 10s | `GET /state?since=105` → 204 |
| Third-party font requests on a board | 3 (googleapis + gstatic) | **0** |
| Board page load (networkidle, warm, median of 3) | ~1284ms | ~1250ms (unchanged, within noise) |
| Font files fetched by a board | 2 self-hosted + 3 third-party | 4 self-hosted, same origin |

A stale probe (`?since=0`) correctly still returns full state, so a board can
never be left behind by the cheap path. The board renders pixel-identically —
verified by screenshot and by measuring rendered glyph width against a forced
system font (484px vs 768px system, i.e. the webfont is genuinely applied).
Regression tests: `src/__tests__/lib/state-probe.test.ts`,
`src/__tests__/lib/ratelimit-public.test.ts` (18 tests).

Two traps found while implementing, both worth remembering:
- **F7 first attempt silently broke the boards.** Applying next/font's generated
  class on a wrapper in the scoreboard route rendered the class names but never
  loaded their CSS module, so `var(--font-saira-condensed)` resolved to nothing,
  the whole `font-family` declaration became invalid at computed-value time, and
  every board silently inherited the app font. The variables must be declared on
  `<html>` in the root layout. Cheap to miss: the board still *works*, it just
  stops looking like a board.
- **next/font preloads every instantiated face**, which had a board fetching 11
  woff2 files to render in one family — worse than the stylesheet it replaced.
  All four families are now `preload: false`; the browser fetches a face when an
  element first uses it, so admin pages download none.

- **F1** `?since=` on the scoreboard and tablet backstop fetches — collapses most
  S3 load to 204s. One-line-ish change per component.
- **F2** CDN micro-cache on full `/state` responses (`s-maxage=1,
  stale-while-revalidate=2`) so simultaneous spectator polls coalesce at the edge.
- **F3** Rate-limit rework: per-client key (not per-NAT-IP) or a much higher
  per-IP ceiling on `/state`; wire Upstash.
- **F4** Tablet poll: stop on `FINISHED`, widen 4 s → 10 s, add a limiter.
- **F5** `authz.ts` switches `getUser()` → local `getClaims()` as the proxy did —
  removes 20–80 ms of Auth HTTP from every rally and poll.
- **F6** Backup cron: one tenant per invocation round-robin (or raise
  `maxDuration` on Pro) so 10 tenants fit the budget; replace blocking `gzipSync`.
- **F7** Self-host the scoreboard fonts (currently a render-blocking Google Fonts
  request on every venue display load, `scoreboard/[matchId]/page.tsx:96-99`).

### 9.6 Validation

No load-testing artifact exists (e2e is 3 functional specs, `workers: 1`). Before
the first multi-tenant event: a k6/artillery script simulating S2 and S3 against a
staging Supabase project, watching pooler client count, `/state` p95, realtime join
failures and 429 rate. Run manually, not in CI.

---

## 10. Implementation phases (each independently shippable)

- **Phase A — tenant config foundation.** §2.1 table (migration 0009 part 1), read
  helper + cache wiring, settings + admin-console sections for disciplines and report
  types, enforcement (§3.3 item 2, §5.2). No visible change for default config.
- **Phase B — match tabs + Reports tab.** §3 routes, `MatchTabs`, export authz split,
  matches-list link + finished-filter fix, removal of the header export buttons.
- **Phase C — people expand.** §2.2/2.3/2.4/2.5 tables + nullable FKs (rest of 0009),
  backfill script, People directory + editor, pickers in rosters/officials/staff,
  read-path joins, CSV import matching.
- **Phase D — people contract.** Migration 0010 dropping player name columns; delete
  dead code paths. Only after C has soaked on the demo tenant.
- **Phase E — VIS mapping deliverable.** No app code: the §7.4 questions go to FIVB
  IT; answers land as an update to §7 and a vis-connector spec for the write slice
  (`VIS_ALLOW_WRITES` gating per vis-connector `VIS-API-NOTES.md:160-168`).
- **Phase F — concurrency hardening + infra escalation** (§9.4/§9.5). Independent of
  A–E; F1–F5 and the plan upgrades come before the first real multi-tenant event,
  F6/F7 opportunistic. Order inside F: plan upgrades → F1 → F3 → F5 → rest.

Commits reference this spec: `feat(reports): … (spec/24)`.

## Testing

- Unit: `tenant_config` guard parsing (bad jsonb → defaults), report-type→URL map
  exhaustiveness (`Exhaustive<>` pattern as `domain.ts` uses for disciplines), CSV
  import person-matching (match vs create), backfill idempotency.
- Authz: VIEW_ROLES on official/sheet/report exports; SCORING_ROLES still required
  for log/vsr/timings; disabled report type → 404 even with a direct URL; disabled
  discipline rejected by `createCompetition`.
- E2E (playwright, existing suite): viewer logs in → matches list → finished match →
  Reports tab → downloads enabled PDFs, sees no technical exports; admin narrows
  allow-list → tab and route respond.
- PDF snapshot: coach box now populated on indoor official sheet when head coach set.

## Out of scope (this spec)

- Actual VIS read/write integration (vis-connector P3/P5 territory; blocked on §7.4).
- Person merge/dedupe tooling (needed eventually; VIS precedent
  `MovePlayerReferences`) and photo file upload.
- Public (unauthenticated) report downloads on the results page.
- Bench function codes on sanctions (spec/21 G4 remainder), stats.

## Open items (decide during implementation)

- A1–A4 above, if the owner wants different behaviour.
- **Expected public viewers per match** — decides the S3 spectator strategy
  (websockets + overage vs poll + CDN micro-cache, §9.4 last row).
- Confirm the current Supabase plan tier (§9.4 assumes Free).
- Whether reprint-mutability of player names on old scoresheets (§2.4) needs a
  roster-name snapshot at confirm time instead.
- Whether `people.deleted_at` should cascade-hide from pickers only, or also from
  where-used panels.

---

## Phase D — IMPLEMENTED 2026-08-11 (migration 0012)

`players.first_name`, `last_name` and `full_name` are gone; `players.person_id`
and `match_officials.person_id` are NOT NULL. A roster row is now purely a
membership: person + jersey + captain/libero.

Prerequisites done in the same pass, because the drop breaks without them:

- Read paths (`listPlayersByTeam`, `loadMatchRosters`, `loadMatchReport`, the team
  tablet) went from `coalesce(person, row)` to an inner join.
- `createPlayer`, `updatePlayer` and `importRoster` stopped writing names.
  `updatePlayer` now owns only the jersey and the C/L flags; the roster row links
  to the person editor for the name, because editing it on the roster would have
  changed one competition's copy.
- The roster page's inline first/last inputs were removed for the same reason.
- `POST /signatures` resolves the signer to a person before its transaction —
  signing at the table is the one path where an official can appear without an
  admin entering them first, so a typed name becomes a person rather than
  failing the signature.
- `demo-seed` creates people (with placeholder emails) and links rosters to them.
- `scripts/backfill-people.ts` lost the one-time backfill: with the columns gone
  and the links NOT NULL an unlinked row is unrepresentable, so the code could
  not run. It survives in git history for the pre-0012 restore case.

A dump of the dropped columns was taken before applying (62 player rows, 4
officials rows) — the drop is irreversible and the data is not in the backup
retention window yet.

Verified: 434 tests, clean build, and the roster/board/scoresheet paths exercised
against the live database.
