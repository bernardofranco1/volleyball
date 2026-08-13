# spec/27 — The management console, rebuilt for a computer screen

**Status: SHIPPED 2026-08-13** (`ccd445a`, `4f2b731`, `80c3181`, `9bf4eb1`).

Implements the design proposal of 12 Aug 2026 in full (all three phases). The
scorer console, team tablets, public scoreboards, results pages and every
PDF/export are deliberately untouched: those are touch-first and TV-first and
already right. This is a presentation-layer rebuild of the surfaces operated
from a desk — dashboard, matches, competitions, schedule, teams, standings,
people, settings, access, audit.

## What was wrong (measured before starting)

- A hard **1024px** content ceiling on every page (settings: 768px), leaving
  ~45% of a 1920px monitor as empty gutter.
- The 28-match schedule page was **~5,000px tall**: ~175px per match, rendered
  as a card with a permanently-open edit form and its own Save button.
- The dashboard rendered **zero rows of data** — three cards duplicating the nav.
- Matches (~80px/row), people (~88px) and competitions (~92px) were stacked
  cards where tables belong. Only standings, the event log and audit used tables.
- Per-row Save buttons everywhere; no batch commit anywhere.
- Access and Audit were reachable only through Settings; no breadcrumbs.

## Six principles

1. **Full-width app frame.** A persistent left sidebar replaces the top pill
   nav; content flows to ~1600px.
2. **Tables are the default** for anything you scan.
3. **Forms appear on demand** — create actions open a drawer; editing happens
   inline in the row.
4. **Batch, not per-row, saves** — inline edits accumulate into one sticky
   "n unsaved changes" bar.
5. **Defaults look like defaults** — config at its discipline default renders
   quiet; overrides are marked and counted.
6. **The dashboard is operational**, not a menu.

## Design system (`src/components/ui/`)

Tokens added to `globals.css`: a third surface level (`--surface-3`),
hover/selected overlays, `--border-strong`, semantic `--success` / `--warning` /
`--danger` (+ `-soft` tints, re-tuned for the light theme), and a
`[data-density]` row-height scale.

Components: `DataTable` (+`Column`, `RowGroup`), `Toolbar`/`FilterChip`/
`SearchBox`, `Drawer`, `BatchEditForm` (the save bar), `AppShell`, `AppSidebar`,
`SettingsNav`, `Page`/`PageHeader`/`Panel`/`StatTile`/`StatRow`, `SelectAll`,
`SelectNav`, `LocalDateTimeInput`, plus a hand-rolled `icons.tsx` (no icon
dependency).

**`DataTable` is a Server Component on purpose.** Sorting and filtering are URL
state, so a filtered view is linkable and costs no client JavaScript. Only row
selection and inline editing are client islands.

## Frame

`AppShell` picks the chrome per route because App Router layouts get no
pathname: `isConsoleRoute()` (paths ending `/live`, or containing `/team/`,
`/scoreboard/`, `/results/`) keeps the original top bar and renders no sidebar.
Everything else gets the console frame. The sidebar is a 64px icon rail from md
to xl, full-width at xl, and below md the existing ☰ panel carries the same
links.

## Per-surface notes

- **Dashboard** — `src/lib/dashboard.ts`: live, today (UTC day), pending
  confirmations, draft competitions with no schedule, and season progress for
  the busiest ACTIVE competition, plus the audit tail. Admin-only panels are
  gated on `ADMIN_ROLES`.
- **Match centre** — day groups with live pinned; chips carry counts from one
  grouped query (`matchStatusCounts`); per-set scores from `loadSetScores`
  (per-set MAX over denormalised event scores, the same aggregate standings
  use); selection + `GET /api/matches/export.csv`; real page numbers.
- **Schedule** — one form for the whole season. `updateMatchSlots` writes only
  the ids listed in the bar's `dirtyIds`, in one transaction, with one audit
  entry. Round reassignment and deletion stay outside the batch table.
  `LocalDateTimeInput` shows local time and submits UTC through a hidden mirror.
- **Competition overview** — tiles + standings snapshot; rules collapse to their
  overrides (`OVERRIDE_LABELS`); danger zone for reverting to draft.
- **Match hub** — two panes: approval/result/log on the left, setup cards in a
  right rail. Set-by-set result; event log filters by event type.
- **People** — 8 columns incl. an "appears in" footprint from `peopleSummaries`
  (two grouped queries per page, not one usage lookup per row). `listPeople`
  now also returns `birthdate` and `hasLogin`.
- **Settings** — section side-nav; the section is a URL parameter.
- **Audit** — `listAuditPage` + `auditActions`: filter by action and free text,
  real pagination, and `GET /api/audit/export.csv` of the current filter. The
  old viewer showed the newest 200 rows and stopped.

## Gotchas this work established

- **Functions cannot cross the Server→Client boundary.** `BatchEditForm`
  originally took a `labelFor(row, field)` callback and a `strings.unsaved(n)`
  formatter; both crashed the schedule page at render. Pass records and a
  `{count}` template instead.
- **Forms cannot nest.** The search box is a `<form>`; wrapping the toolbar in
  the CSV-export form made the browser drop the inner one and React discard the
  server HTML. The export form wraps only the table; the toolbar button reaches
  it via `form={id}`.
- **`onChange` without `checked`/`defaultChecked`** hydrates as a controlled
  input the server never rendered — one select-all checkbox invalidated the
  whole table header. Always mark such inputs `defaultChecked={false}`.
- Neither `tsc`, `eslint` nor `next build` catches any of the three. Drive the
  pages in a real browser: `scripts/qa-temp-admin.ts create` provisions a
  throwaway TENANT_ADMIN (and `destroy` removes it — dev and prod share one
  database, so never leave it behind).

## Data problem it surfaced (fixed, `89b825d`)

The People table's "appears in" column exposed 187 people for 124 humans in the
VBC Cheseaux data: `scripts/seed-lna-season.ts` inserted a fresh `people` row
per officials slot per match. The seed now registers the twelve officials once
up front, and `scripts/dedupe-people.ts` merged the 63 duplicates already
stored (dry-run by default; mirrors the `mergePeople` action). All 75 officials
slots were preserved and the played matches' scoresheets still validate.
