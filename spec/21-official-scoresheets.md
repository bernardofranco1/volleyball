# 21 — Official FIVB e-scoresheets (indoor & beach)

Status: **phases A (partial) + B + C implemented** (2026-07-28). Live as
`GET /api/matches/[id]/export.pdf?type=official` ("Official sheet" button on
the match page) for BEACH + INDOOR; other disciplines fall back to the
spec/20 block-structure sheet. Shipped: venue/category columns (migration
0006) + competition-form fields, officials editor (`saveMatchOfficials` +
`MatchOfficialsForm`), `IMPROPER_REQUEST` event (all disciplines),
`tossWinner` on COIN_TOSS/SET_START (3-step toss wizards),
`src/lib/scoresheet/{official-data,primitives,indoor-official,beach-official}.ts`
with embedded Liberation Sans (fonts/), UNDO/REWIND-aware survivor pass,
genderLabel bug fix, 5 new tests (250 total green). **Remaining**: Phase D
pre-match captain/coach + scorer/assistant signature capture (cells render
blank until then); G4 staff/coach sanctions + bench function codes; G9 VCS
duration; per-match court label; reference-match golden fixtures (Phase E
full slice). Times print as UTC pending a venue-timezone field.

Reference documents (checked into `spec/reference/`):

- `fivb-indoor-scoresheet-vnl2026-final.pdf` — FIVB Volleyball Scoresheet
  **VSR 3.16.13** (VNL 2026 Final, Türkiye 3:1 Brazil, Macao). One A4
  landscape page.
- `fivb-beach-scoresheet-wch2025-final.pdf` — FIVB **Beach Volleyball
  International Scoresheet** "RPS – 2 out of 3 sets" (VolleyStation; Beach
  World Champs 2025 Final, Tina/Anastasija LAT 2:1 Nuss/Brasher USA). Two
  pages: sets 1–2, then set 3 + teams/results/approval/remarks.

These are the gold standard. Every mark on them is either entered at match
setup, written at a precise game moment **with the score at that moment**, or
derived at match end — which maps 1:1 onto our append-only event log. The
guiding principle of this spec: **the sheet is a deterministic rendering of
the event log**; new *capture* is only needed where the log has no source for
a printed datum.

## Decisions (agreed 2026-07-28)

1. **Adaptive layout** — the FIVB visual language always; panel count, ladder
   length, service-round rows and switch boxes adapt to `tournament_config`
   (best-of-3 indoor, custom set points, etc.). A match played under FIVB
   standard config renders as an exact replica.
2. **Signatures** — implement **pre-match captain (+ beach coach)** signatures
   at lineup/roster confirmation, and **scorer + assistant scorer** post-match
   signatures. 2nd/3rd/challenge referee and line judges print as blank cells
   (name printed when assigned, signature area empty).
3. **Deliverable: PDF on demand** — generated from the event log at any
   moment; mid-match it renders the sheet "as of now". No live HTML view (may
   come later).
4. Beach TEAMS-block asterisk `*` = **the player who served first in set 1**
   (confirmed). Captain stays circled; the two marks are independent.

**Visual prototype**: `spec/reference/scoresheet-preview-prototype.js` — a
standalone pdfkit script (run with `node`) that renders both sheets from mock
data mirroring the reference matches. It validates the layout system (point
ladders, service rounds/rows, score-stamped boxes, switch rail, ✕-marks,
signature boxes, Liberation Sans for full Unicode) and is the starting point
for the Phase C primitives. Note: the built-in Helvetica AFM fonts are
WinAnsi-only and garble Turkish characters — the real renderer must embed a
TTF (Liberation Sans) instead of the current `scoresheet-pdf.ts` approach.

## 1. Sheet anatomy → data source

Notation conventions shared by both sheets:

- **POINTS ladder** — pre-printed 1..N per team per set; slash each point as
  scored, **circle the set-winning point**, strike through the unused tail.
- **Score-stamped boxes** — timeouts, substitutions, sanctions, court switches
  all record the score at the moment (convention: acting/requesting team's
  score first on team-scoped boxes; `A:B` on neutral boxes).
- **✕ marks** — dead boxes (receiving team's first service round, unused
  court-switch rows) are crossed out, never left blank.

### 1.1 Indoor (VSR 3.16.13, A4 landscape, 1 page)

| Zone | Content | Source |
|---|---|---|
| Header | Competition, Pool/Phase; City, Country, Hall; Match No., Date, Time; Division ✓ (M/F/Mixed), Category ✓ (Senior/Junior/Youth/Kid); teams banner with Ⓛ/Ⓡ from toss | setup + `COIN_TOSS` |
| Set panels 1–4 (two mirrored team panels each; left panel = team on left side that set) | START/END time; Ⓢ/Ⓡ circle; service order I–VI (starting six); substitutes (sub № under starter's column, score at change, circled + second score on return); service-round grid rows 1–8 (team's cumulative score each time it loses serve, written in the current server's box; ✕ in round-1/pos-I for receiving team; final point circled); POINTS 1–48; "T" boxes with timeout scores | `SET_START/END`, `LINEUP_CONFIRMED`, `SUBSTITUTION` + score denorms, rally events + replayed rotation, `TIMEOUT_REQUEST` |
| Set 5 panel | Three sub-panels: first server, receiver, **Change side** (team + points at change at 8, continued rounds, 1–30 ladders) | same + `SIDE_SWITCH` (score-stamped) |
| Sanctions | W/P/E/D grid: mark, who (jersey № or **C** for coach), team L/R, SET, SCORE | misconduct/delay events — needs coach-targetable misconduct |
| Improper request | ✕ in offending team's circle (once per team per match) | **new event** |
| RESULTS | per set T·S·W·P per team + duration; totals; match start/end/total time; WINNER + set score | derived |
| TEAMS | rosters № + name, captain **circled**, LIBERO PLAYERS box, bench officials with FIVB function codes (C1, A1–A3, D1, T, P…) | roster + **staff entities** |
| APPROVAL | 1st/2nd/3rd referee, scorer, assistant scorer, challenge referee — name, **Level**, signature; line judges 1–4; captains' signatures L/R | `match_officials` + `match_signatures` |
| REMARKS | free text (e.g. temperature/humidity) | `NOTE` events / manual |
| Footer | version tag (ours: app version + result digest, mirroring `VSR 3.16.13`) | build info |

### 1.2 Beach (RPS 2-of-3, 2 pages)

| Zone | Content | Source |
|---|---|---|
| Header | Competition; Match No., Site, Beach, **Court label** ("CC"), Date, Gender, Phase, Round; teams Ⓐ/Ⓑ + pair name + country | setup + toss (A/B) |
| Set panels (top = first-serving team, orders **I & III**; bottom = receiver, **II & IV**) | player № per order slot; per-player service rows 1–21 (team score each time that player's service turn ends, final point circled); TEAM-POINTS 1–44; Time-Out box (score when taken); **Formal warning** + Misconduct (Pen/Pen/Exp/Disq) rows per player **and Coach row C** (score in cell); Delay sanctions (Warn/Pen/Pen/Pen); **Court switch column A:B** (score at every switch, TTO flag on the 21-total-points switch in sets 1–2, every-5 cadence in set 3, unused rows ✕); start/end time | `SERVICE_ORDER`, rally events (`serverPlayerNumber` is populated for beach), `TIMEOUT_REQUEST`, misconduct/delay events, `SIDE_SWITCH`, `TTO_START`, `SET_START/END` |
| TEAMS (p2) | № 1/2 + FAMILY NAME First, captain circled, `*` on set-1 first server, coach row; **captain + coach pre-match signatures** | roster + `SERVICE_ORDER`(set 1) + new pre-match signatures |
| RESULTS (p2) | per set Timeouts/Wins/Points per team + duration; totals; match start/ending time; **Total match duration** = wall-clock end−start (≠ Σ set durations); winning team + set score | derived |
| Coin toss (p2) | **Winner of Coin Toss: Set 1 _ / Set 3 _** (pre-match + pre-deciding-set tosses) | `COIN_TOSS` — needs `tossWinner` |
| Improper request (p2) | two circles, crossed when charged | **new event** |
| APPROVAL (p2) | 1st/2nd referee, scorer, assistant scorer — name, **Country**, signature; line judges 1–4; captain post-match signatures | `match_officials` + signatures |
| REMARKS (p2) | free text + "Additional information attached" ☐; e.g. *"Total match duration adjustment for Video challenge: 00:00:24"* | `NOTE` + VCS timing |

## 2. Gaps to close (capture, not rendering)

Everything score-shaped is already derivable by replay. The genuine gaps:

| # | Gap | Change |
|---|---|---|
| G1 | Venue detail | `competitions`: `city`, `country`, `hall` (indoor) / `site`, `beachName` (beach); `matches.courtLabel` text alongside `courtNumber` |
| G2 | Category | `competitions.category` enum `SENIOR\|JUNIOR\|YOUTH\|KID` (nullable) |
| G3 | Officials assignment | UI + API writing `match_officials` for all 10 roles with `level`/`country` (table exists; today only the 1st-referee sign-off writes to it) |
| G4 | Coach & bench staff | staff rows (`players.role = STAFF`) gain `staffFunction` code (`C1,A1,A2,A3,D1,T1..,P1..`); misconduct payload accepts staff target (`playerId` → `personId`, or a `target: PLAYER\|STAFF`) |
| G5 | Coin-toss winner | `COIN_TOSS` payload + `SET_START` re-toss gain `tossWinner: TEAM_A\|TEAM_B` (nullable for back-compat) |
| G6 | Improper request | new event `IMPROPER_REQUEST {team}` — scorer console button; max 1/team/match enforced by engine; no point/sanction effect, printable only |
| G7 | Pre-match signatures | new `match_signatures` roles `TEAM_A_CAPTAIN_PREMATCH`, `TEAM_B_CAPTAIN_PREMATCH`, `TEAM_A_COACH_PREMATCH`, `TEAM_B_COACH_PREMATCH`; captured on team tablet at lineup confirmation; digest binds to roster+lineup sequence, not result |
| G8 | Scorer-bench signatures | roles `SCORER`, `ASSISTANT_SCORER` in the post-match sign-off flow (optional per `resultSignatures` policy) |
| G9 | VCS duration | emit `VCS_RESULT` with `durationSecs` (or pair `VCS_CHALLENGE`/`VCS_RESULT` timestamps); print beach duration-adjustment remark automatically |
| G10 | Report layer | widen `ReportSet`/`loadMatchReport` (`src/lib/match-report.ts`) to expose per-set lineups, service rounds, subs w/ scores + returns, timeout scores, sanction records, side switches, improper requests, coin-toss info, liberos; make replay failure **loud** (today `sets: []` silently) |

Known bugs fixed in passing: `genderLabel` in `src/lib/scoresheet-pdf.ts`
tests `MALE/FEMALE` but the enum is `MEN/WOMEN/MIXED` (prints "—" today);
the 8-row interruption cap in the current sheet becomes obsolete.

Indoor caveat: `events.serverPlayerNumber` is denormalized **null** for
indoor (`src/engine/registry.ts:177`) — service-round attribution must be
recomputed by engine replay from `rotationIndexA/B` + `courtPositionsA/B`
(data is present; do NOT backfill the column).

## 3. Implementation phases

### Phase A — data foundations
- Migrations for G1/G2/G4 columns + `match_signatures` role extension (manual
  DDL — drizzle-kit push crashes on CHECK introspection, see spec/17).
- Engine: `IMPROPER_REQUEST` event (all disciplines), `tossWinner` on
  `COIN_TOSS`/re-toss, staff-targetable misconduct, `VCS_RESULT.durationSecs`.
  All payload additions nullable/optional → old logs replay unchanged.
- Officials assignment UI on the match admin page (all roles, name +
  level/country, `source: MANUAL`); staff function codes on team roster UI.

### Phase B — report layer
- Widen `ReportSet` with everything in G10; compute **service rounds**
  (indoor: per rotation column, per round; beach: per player) during replay.
- Surface config-derived layout params (ladder max, switch cadence, rows).

### Phase C — renderers (pdfkit, existing stack)
- `src/lib/scoresheet/primitives.ts`: point ladder (slash/circle/strike),
  score-stamped box grid, ✕-marks, checkbox row, circled text, signature box
  (reuse `drawSignatureInBox` / `fitStrokes`).
- `src/lib/scoresheet/indoor-official.ts`: VSR layout — header, 4+1 set
  panels (set-5 change-side variant), sanctions/improper, results, teams +
  liberos + bench, approval, remarks. Adaptive: N set panels from `bestOf`,
  ladder from `setScore`+overrun margin, service-round rows from set length.
- `src/lib/scoresheet/beach-official.ts`: 2-page layout — per-set panels with
  per-player service rows, switch column with TTO flag, page 2 blocks.
- Served as `GET /api/matches/[id]/export.pdf?type=official` (existing
  `?type=sheet` kept until parity is proven, then retired).
- Mid-match rendering: all completed marks drawn, current set partially
  filled, unplayed elements pre-printed (that *is* the paper behaviour).

### Phase D — signature workflow
- Team tablet: after lineup confirmation → captain (and beach coach) signing
  pad (pre-match roles, G7); scorer console fallback.
- Post-match sign-off (`ResultSignOff.tsx`) gains scorer + assistant scorer
  steps per policy; result lock/digest semantics unchanged.

### Phase E — verification
- Seed fixtures reconstructing **both reference matches** as event logs
  (indoor: TUR 3:1 BRA incl. subs, timeouts, set scores 23-25/25-23/26-24/25-21;
  beach: LAT 2:1 USA incl. TTOs, switches, timeouts, re-toss).
- Golden tests: render both official sheets from fixtures, assert structured
  content (text extraction + geometry spot checks) against the references.
- Extend the e2e suite with an official-sheet download + content check.

## 4. Out of scope (this spec)
- Live HTML e-scoresheet view (decision: PDF-on-demand only, revisit later).
- Grass/Light official sheets (the primitives are built to be reused).
- Rally-detail statistics (attack/block/ace attribution) — the official
  sheets do not require them.
