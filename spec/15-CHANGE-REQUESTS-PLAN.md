# 15 — Change-Requests Implementation Plan

Plan to implement the product-owner change-request brief + broadcast scoreboard
templates + a new court-representation requirement against the **current**
version of the platform.

Source materials (committed alongside this plan):
- [change-requests/brief.md](change-requests/brief.md) — the full brief (UI/nav, bugs, data import, scorer/scoreboard, architecture, scope, Appendix A rule engine).
- [change-requests/scoreboards/](change-requests/scoreboards/) — broadcast scoreboard templates (Indoor + Beach, plus White-Label demos) as standalone `.dc.html` Design Components, driven by `--bg / --line / --font / --accent` CSS tokens, + their shared `support.js` runtime.

---

## 0. Three facts that shape the whole effort

1. **"Air volleyball" = the app's existing `LIGHT` discipline.** The app supports four disciplines (`BEACH`, `INDOOR`, `GRASS`, `LIGHT`); the brief names three (`indoor`, `beach`, `air_light`). `air_light` maps onto `LIGHT`.
2. **The Appendix A rule engine is already built.** `src/engine/{indoor,light,beach,grass}` already implement rotation, expected server, court-side switches, timeouts, and TTO, with passing tests. State tracks `courtPositionsA/B`, rotation index, current server, and `teamASide`. So brief §8 is a **validation/audit** task, not a rebuild.
3. **The "arc fault" open question (§7) is answered.** It's `ATTACK_ARC_FAULT` — a real Light/Air fault event tied to Light's front-zone attack-arc rule. Decision: keep or hide the button (treated under §6 scope-removal style if hidden).

---

## 1. Locked product decisions (2026-06-29)

1. **IDs / URLs (§5):** Keep `cuid2` primary keys internally (FKs everywhere — safe). Add short top-level routes `/Scoreboard/{id}`, `/Scorers/{id}`, `/Tablets/{id}/A` that resolve the match directly; tenant is inferred from the match record (no slug in the URL). **No numeric-ID migration**; the visible id stays cuid2.
2. **Scorer auth (§5.3):** Per-match **6-digit numeric PIN** gate on the scorer page, mirroring the existing team-tablet token model. Admin email/password login stays.
3. **Disciplines:** Air = `LIGHT`, relabeled **"Air/Light"** in the UI (not a full enum rename). **Grass receives the same** scoreboard + court treatment so all four disciplines stay consistent.
4. **Dark mode (§1.3):** Light/dark toggle for the **admin/scorer app UI only** — never the broadcast boards (boards stay driven by white-label color tokens).
5. **Remove Challenge (§6):** Hide VCS from all UI + default config off; leave engine code dormant (reversible "for now"), do **not** rip out the engine.

Open (sensible defaults unless changed):
- **Grass board** reuses the beach-style layout (player names; grass is 3–4 players).
- The new **court lives on the scorer page**; add to the public board only on confirmation.

---

## 2. Current-state map (verified by codebase exploration)

| Area | Current state |
|------|---------------|
| Public scoreboard | `src/components/scoreboard/ScoreboardDisplay.tsx` — **BEACH ONLY**. Route `src/app/t/[tenantSlug]/scoreboard/[matchId]/page.tsx`. |
| Court art | `src/components/court/{Beach,Indoor,Grass,Light}Court.tsx`. None render a perspective net-in-middle / teams-facing court. Indoor = two 3×2 grids; Light/Grass = flex rows. |
| Engine | `src/engine/{beach,indoor,grass,light}/{types,reducer}.ts` + `src/lib/match-engine.ts`. Full rotation/serve/side/timeouts/TTO, tested. |
| Tablet → scorer requests | `src/app/api/matches/[id]/interrupt-requests/route.ts` (POST PENDING + fire-and-forget realtime broadcast via `src/lib/realtime.ts`; tablet polls GET every 4s; PATCH approves). Scorer toast `src/components/scoring/InterruptNotifications.tsx` subscribes `match:{id}:scorer`. Realtime gated by `NEXT_PUBLIC_REALTIME_PRIVATE`. |
| CSV import | `src/lib/csv-actions.ts` — three **separate** fns (`importTeams`/`importPlayers`/`importSchedule`) + `src/lib/csv.ts`, UI `src/components/admin/CsvImport.tsx`. Schedule cols: matchNumber, teamA, teamB, courtNumber, scheduledAt, roundName. |
| Roster | `src/lib/team-actions.ts`, forms in `src/components/admin/`. Player `jerseyNumber` nullable, **no unique constraint** (`src/db/schema.ts:174-191`). |
| Branding/theme | `tenant_branding` table → CSS vars in `src/app/t/[tenantSlug]/layout.tsx`; court vars `src/lib/branding.ts`; tokens `src/app/globals.css`. **No per-team color. No dark mode.** |
| Auth | Supabase email/password (`src/lib/auth-actions.ts`, `src/app/(auth)/login`), proxy `src/proxy.ts`. Tablet token `src/lib/match-session*.ts` (12h). **No PIN.** |
| Landing copy | `src/app/page.tsx` — has the "White-label scoring SaaS" badge + "Multi-discipline, multi-tenant…" tagline to remove. |
| Challenge/VCS | Fully built (beach + indoor): engine, tablet button, action bar, config. |
| Countdowns | Serve clock exists (`ServeClockWidget`). **No pre-match or timeout countdown.** |

---

## 3. Plan by brief section

### §1 UI / Navigation
- **1.1 Landing copy** — edit `src/app/page.tsx`: keep only "Volleyball Scoring Platform"; drop badge + tagline.
- **1.2 Top nav menu** — new nav component in the tenant layout (today: logo + sign-out only).
- **1.3 Light/dark toggle** — app UI only (per decision 4). Build a light theme for admin/scorer surfaces + persisted toggle. Boards excluded.
- **1.4 Team colors** — add per-team color fields (DB + roster UI), a pre-match picker, surface in the interface, with a contrast fallback for clashes (black-on-black etc.).

### §2 Bugs
- **2.1 Duplicate jersey** — add `(teamId, jerseyNumber)` uniqueness + validation in add-player form, CSV import, and server action.
- **2.2 Tablet requests not received** — diagnostic: reproduce, trace broadcast → scorer subscription; prime suspect is the `NEXT_PUBLIC_REALTIME_PRIVATE` channel-privacy gating. Fix delivery (channel/auth) and add a scorer-side polling fallback.

### §3 Data import
- **3.1 Merge players + teams** into one CSV with an ignored `"John Doe"` example first row.
- **3.2 Schedule template** — extend to the 9 brief columns: Match number, Team A, Team B, Court number, **Group**, **Phase number**, **Phase name**, **Match day**, **Match time (local)**. Needs small schema additions (group, phase) + split day/time parsing.

### §4 Scorer & Scoreboard
- **4.1 POINT button follows side** — order scorer A/B buttons by `teamASide` so they track court switches.
- **4.2 Faster scoreboard** — reduce the 5s polling fallback / optimize realtime path (ties to 2.2).
- **4.3 Timeout countdown** on scoreboard, on the requesting team's side — new widget.
- **4.4 Pre-match countdown** (clock-time or duration) on scorer + scoreboard — new (statuses exist, no timer).

### §5 Architecture
- Short URLs `/Scoreboard/{id}`, `/Scorers/{id}`, `/Tablets/{id}/A` resolving cuid2 (decision 1).
- Per-match 6-digit scorer PIN (decision 2).

### §6 Remove Challenge
- Hide VCS from tablet + action bar + config default off; engine dormant (decision 5).

### §7 Arc fault
- Documented (= `ATTACK_ARC_FAULT`). Keep or hide per decision.

### §8 Rule engine
- Reconcile existing engine vs Appendix A (indoor/beach/light/grass); fold findings into `spec/14-RULES-VALIDATION-AND-ANDREW-RECIPE.md`.

---

## 4. Scoreboard templates (the 5 export files)

- Port each `.dc.html` design into a React public-scoreboard component driven by live state: `IndoorScoreboardBoard`, `BeachScoreboardBoard`, `AirScoreboardBoard` (+ Grass on the beach-style board).
- **Customisable colored lines:** wire the template tokens (`--line`, `--accent`, `--bg`, `--font`) to per-competition / per-tenant white-label settings (extend `tenant_branding` / `courtColorOverrides`), with contrast fallback.
- **Air board = Beach board** but **Team name** instead of the two player-name lines, and the **serving ball vertically centered on the team-name line** (beach currently top-aligns it via `alignSelf:flex-start`).
- Replace the beach-only public scoreboard so all disciplines have a board.

---

## 5. Court representation (new requirement)

Rebuild `IndoorCourt` and the Air (`LightCourt`) court (and `GrassCourt`, per decision 3) as a **flat court with the net across the middle and the two teams facing each other**:
- Player positions per half (indoor 1–6, Air 4/5, grass 3/4) read from engine `courtPositionsA/B` + `teamASide`.
- **Rotation reflected live** — clockwise on side-out (engine already computes it); serving position highlighted with the serve ball.
- Honors `teamASide` so the court flips on court changes.
- Lives on the scorer page; add to the public board only on confirmation.

---

## 6. Suggested build order

1. **Quick wins / low-risk:** landing copy (1.1) · duplicate jersey (2.1) · hide Challenge UI (6) · document arc fault (7).
2. **Bug + perf:** tablet requests (2.2) → faster scoreboard (4.2).
3. **Visual core:** scoreboard templates (§4) + court redesign (§5) + Air variant.
4. **Features:** merged CSV (3.1) · schedule template (3.2) · POINT-follows-side (4.1) · timeout countdown (4.3) · pre-match countdown (4.4) · team colors (1.4) · top nav (1.2).
5. **Architecture:** short URLs + scorer PIN (5) · dark-mode app toggle (1.3).
6. **Engine reconciliation** (8) — ongoing.
