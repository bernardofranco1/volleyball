# 29 — Pro-scoring completion: remaining FIVB-fidelity corrections

Status: **planned, Phase 0 verification done** (2026-08-17). No code yet. Consolidates the gap analysis of
2026-08-17 (run against origin/main as of 2026-08-14) with spec/21's own
"Remaining" list into one phased plan. Scope excludes, per product owner:
**anything Video Challenge (VCS) related** and **anything serve-clock related**
— both stay on the deferred register at the end.

Baseline note: the analysis was first run against a checkout ~6 weeks stale
(see spec/17 on drizzle-kit; same lesson — verify against origin). Phase 0
exists to prevent planning work that main already ships.

## What main already ships (verified, not in scope)

Official indoor (VSR 3.16.13) + beach (RPS 2-of-3) sheets rendered from the
event log (`?type=official`, spec/21 Phases A–D); result sign-off with
captains + 1st referee, ACCEPT/PROTEST/REFUSED + reasons, result lock
(spec/20); pre-match captain + post-match scorer/assistant signatures;
sanctions panel (fact-only, beach+indoor); `IMPROPER_REQUEST`; 3-step toss
wizards with `tossWinner` + deciding-set re-toss; beach `SERVICE_ORDER`;
forfeit/retirement shortcuts; undo `scope` semantics; timeout countdowns;
tablet sub flow (spec/18); report layer (spec/21 G10).

## Fidelity register

Every remaining correction, the sheet zone it unblocks, and its phase:

| # | Correction | Sheet zone / rule | Phase |
|---|---|---|---|
| F1 | Staff function codes (`C1, A1–A3, D1, T, P…`) on roster staff rows — the person registry itself already shipped (spec/24/25: `people`, `players.personId`, `role: PLAYER\|BENCH\|STAFF`) | TEAMS bench-officials rows (blank today) | 1 |
| F2 | Coach-targetable sanctions | Sanctions grid **C** marks, both sheets | 1 |
| F3 | Coach pre-match signatures (`TEAM_A/B_COACH_PREMATCH`; G7 planned, Phase D shipped captains only) | Beach TEAMS p2 coach signature box | 1 |
| F4 | Per-match court label (`matches.courtLabel`) | Beach header "Court", indoor hall line (G1 tail) | 6 |
| F5 | Venue timezone field + localized time rendering | Every printed time (UTC today) | 6 |
| F6 | Sanctions panel on grass/light consoles | Capture parity (their sheets stay out of scope) | 6 |
| F7 | Golden fixtures (spec/21 Phase E): both reference matches as seeded logs, structured-content + geometry assertions, e2e download test | Whole-sheet proof | 6 |
| F8 | Forfeit/retirement rendering per FIVB convention (team incomplete keeps points as-at-moment; no-show 0-25 / 0-21) + auto remark | RESULTS block, POINTS ladders | 6 |
| F9 | Exceptional-substitution capture UI (engine flag exists) + remark line | Sub boxes + REMARKS | 4 |
| F10 | Libero redesignation / unable-to-play capture + remark line | LIBERO PLAYERS box + REMARKS | 4 |
| F11 | Medical/recovery events printed with score + player | REMARKS | 4 |
| F12 | In-match protest capture (`PROTEST_LODGED`: team, member, score-stamped, short text) | REMARKS + approval protocol (distinct from result-stage PROTEST signature) | 5 |
| F13 | Rotation / wrong-server fault corrections re-render the service-round grid consistently after point cancellation + auto remark | Service-round grids + REMARKS | 3 |
| F14 | Sanction-consequence links (`causedBy`) so a penalty point and its card print as one fact | Sanctions grid ↔ POINTS ladder consistency | 2 |

## Phases

### Phase 0 — Re-baseline (S)
- Fresh clone of origin/main **outside any cloud-synced folder** (OneDrive
  placeholder hydration makes git unusable in `~/Documents`; the stale copy
  there caused the first misread).
- Verify in code, not spec: exceptional-sub UI presence; libero panel
  position-1 handling + `LIBERO_REDESIGNATION` reachability; medical per-player
  accounting; what admin rewind exposes; offline/queue behaviour of the
  scorer client beyond the monotonic resync guard.
- Output: tick-list appended here; anything already done gets struck.

### Phase 1 — Staff function codes & coach-targetable sanctions (S-M) — F1, F2, F3
- DB: one `players.staffFunction` column (role enum + person registry already
  exist); migration (manual DDL per spec/17); bench-officials roster UI.
- Engine: misconduct target widens `playerId` → `personId` +
  `target: PLAYER|STAFF`, nullable/optional so old logs replay unchanged.
- UI: SanctionsControl gains a Bench tab; team tablet pre-match coach
  signing pad (extends the G7 flow).
- PDF: TEAMS bench rows with function codes; sanctions grid prints № or `C`;
  beach coach pre-match signature cell.
- Tests: replay compat on old logs; golden render with a coach penalty.

### Phase 2 — Sanction consequences, guided (M) — F14
Keep fact-only recording as the base (paper procedure); add guidance so the
score cannot drift from the sanction:
- Penalty (misconduct or delay): after recording, one armed chained action —
  "Award point + service to {opponent}" — emitting the rally event with
  `causedBy: <sanctionEventId>`. Per-competition
  `sanctionAutoPoint: PROMPT | AUTO | OFF` (default PROMPT).
- Expulsion (indoor): must-resolve state — legal or exceptional substitution;
  no legal option → team incomplete for the set, chaining into the existing
  forfeit machinery. Beach: expulsion = team incomplete for the set;
  disqualification = match.
- Escalation guard: warn when issuing a sanction lower than the member
  already holds; repeat improper request → delay-sanction suggestion.
- Tests: penalty-point undo pairs (undo removes both), expulsion-with-no-sub
  → set forfeit, escalation warnings.

### Phase 3 — Fault-correction workflows (L) — F13
- New events `ROTATION_FAULT` (indoor) and `SERVICE_ORDER_FAULT` (beach):
  point + service to opponent; late discovery → cancellation of points scored
  while at fault, built on the undo/rewind machinery (scorer picks the fault
  moment in the scoring-log overlay; engine replays with the correction).
- Guard rails per spec/19: two-tap arm, `undoneNotice`-style toast, mandatory
  reason; cancelled points listed in the confirmation.
- PDF: auto-composed remark ("Rotation fault {team} at {score}, N points
  cancelled"); acceptance = service-round grid consistent after correction.
- Tests: late-discovery cancellation across a side switch; golden fixture.

### Phase 4 — Injury & libero completeness (M) — F9, F10, F11
- Exceptional substitution surfaced in SubPanel + tablet flow (spec/18
  pattern); offered only when legal subs are exhausted/unavailable; not
  counted toward the per-set limit.
- Medical accounting: per-player recovery counters (beach one per player per
  match; indoor 3-min recovery only when no legal sub — exact limits verified
  against the 2025-2028 rulebooks during build, not assumed).
- "Unable to continue" → one flow: exceptional sub → if impossible, team
  incomplete → existing retirement shortcut.
- Libero: allow position-1 replacement (serve still blocked), expose
  `LIBERO_REDESIGNATION`, "libero unable to play" declaration.
- **Remarks composer** (shared module, both renderers): standardized remark
  lines from typed events — exceptional sub, forced sub after expulsion,
  recovery, libero redesignation, forfeit, protest, fault correction — each
  with set/score/timestamp. Free-text NOTE stays alongside. Keeps the rule:
  the sheet is a deterministic rendering of the log.
- Tests: each terminal path yields a correct RESULTS block + locked result.

### Phase 5 — In-match protest capture (S) — F12
- `PROTEST_LODGED` event (team, member, score, set, timestamp, short text),
  captured on console + team tablet request; prints via the remarks composer;
  distinct from the result-signature PROTEST status.

### Phase 6 — Scoresheet fidelity completion (S-M) — F4–F8
- `matches.courtLabel`; venue timezone field + localized rendering of every
  printed time; sanctions panel on grass/light consoles.
- Golden fixtures: seed both reference matches (indoor TUR 3:1 BRA; beach
  LAT 2:1 USA) as event logs; render and diff against the checked-in
  reference PDFs (text extraction + geometry spot checks); e2e download test.
- Two extra fixtures beyond the references: one forfeit, one fault
  correction.
- **Exit gate for phases 1–5**: both reference sheets + both extra fixtures
  render clean.

### Phase 7 — Offline resilience hardening (S, audit) — mostly built
Phase 0 found the offline queue already shipped in `match-provider.tsx`
(localStorage `vbqueue_{matchId}`, `queuedCount`, monotonic resync guard).
Remaining: audit edge cases only — multi-tab on one match, queue TTL/replay
after long disconnects, scoresheet download while queued events exist.

## Sequencing

0 → 1 → 2 (needs 1's staff targets) → 3 → 4 → 5/6 in parallel → 7.
F7 goldens gate everything above them.

## Deferred register (excluded by product owner, kept for completeness)

- **G9 / VCS duration** — `VCS_RESULT.durationSecs` (or pair the
  challenge/result timestamps) + the beach "Total match duration adjustment
  for Video challenge" remark. Last printed datum with no log source. Slots
  into Phase 6 when challenge work resumes.
- **Serve clock** — nothing serve-clock-shaped prints on either sheet; no
  action.
- Knowingly blank cells that stay blank: 2nd/3rd referee and line-judge
  signatures (name-only, per the paper sheets).

## Phase 0 verification — done 2026-08-17

Run against a fresh clone (`~/dev/volleyball`, HEAD `ba73c28`) and the Vercel
deployment list. Result: **the plan is consistent with main and with prod**,
with two items smaller than planned (F1, Phase 7 — amended above).

Confirmed still open, in code:
- F2 — misconduct payloads are `playerId: string` only (`engine/core/baseReducer.ts:102-105`); `SanctionsControl` picks roster players only.
- F3 — no `*_COACH_PREMATCH` roles in `match-signatures.ts` / `PrematchSignOff`.
- F4/F5 — no `courtLabel`, no timezone field in `db/schema.ts`.
- F6 — `SanctionsControl` mounted in `LiveScoreboard` (beach) + `IndoorScoreboard` only.
- F7 — `official-scoresheet.test.ts` covers data layer + renderers structurally; no reference-match golden fixtures.
- F9 — `isExceptional` exists in the engine only; no UI writer.
- F10 — libero panel offers positions 5/6 only (`IndoorActionBar.tsx:253`); `LIBERO_REDESIGNATION` appears only in `ScoringLog` (display), no writer.
- F11 — no per-player medical counters in `baseReducer`.
- F12/F13/F14 — `PROTEST_LODGED`, `ROTATION_FAULT`, `SERVICE_ORDER_FAULT`, `causedBy`: zero hits in `src/`.

Found already built (plan amended):
- Person registry + roster `role: PLAYER|BENCH|STAFF` (spec/24/25) → F1 reduced to the `staffFunction` column + surfacing.
- Offline queue + resync guard in `match-provider.tsx` → Phase 7 reduced to an audit.
- Engines share `engine/core/baseReducer.ts` → F12/F13/F14 events land once in core, all four disciplines inherit.
- Admin `RewindToHere` exists → Phase 3 builds on it as assumed.

Prod consistency (Vercel, project `volleyball`):
- Production = deployment `24abc2e` ("review findings" merge, 2026-08-14), promoted via the spec/28 release console — identical to the code this plan was verified against. The only later commit on main is this spec (`ba73c28`, docs-only, built as candidate, not promoted). Nothing in prod contradicts the plan; nothing in the plan assumes code prod lacks.
