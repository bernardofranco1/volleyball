# 29 — Pro-scoring completion: remaining FIVB-fidelity corrections

Status: **IMPLEMENTED 2026-08-17** — Phases 1–7 shipped on
`feat/spec-29-pro-scoring`, one commit per phase, 543 tests passing. See
§Implementation notes at the end for what was built differently from the plan
and what is deliberately still open.

*(Previously: planned, Phase 0 verification done 2026-08-17. No code yet.)*

Consolidates the gap analysis of
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
| F4 | ~~Per-match court label (`matches.courtLabel`)~~ Render the EXISTING `matches.courtNumber` on the indoor sheet — the beach header "Court" already prints it (`scoresheet/beach-official.ts:113`), and courtNumber is fed by the schedule UI, CSV import and VIS import. No new column (2026-08-17 revalidation §F4) | ~~Beach header "Court" (blank today)~~ indoor hall line (G1 tail) | 6 |
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

*(Amended 2026-08-17 after the second code revalidation — see §Revalidation
below. The roster-row representation is the decision; the engine widening and
the tablet signing pad are superseded.)*

- **Representation decision (F1):** staff are ROSTER ROWS — `players` with
  `role: STAFF` — because that is the path every match surface already eats
  (`loadMatchRosters` → PlayerLite → consoles; match-report → renderers; the
  VSR export already filters `role === "STAFF"` as staff, `vsr/build.ts:154`).
  DB: one `players.staffFunction` column (nullable text enum
  `C1|A1|A2|A3|D1|T|P`), manual DDL per spec/17. The OTHER existing
  representation — the `team_staff` table (HEAD_COACH…MANAGER, written by
  nothing UI-side, read only by people pages/dedupe/backup) — is NOT extended:
  match surfaces never read it. Backfill any team_staff rows into players
  rows at migration time; team_staff stays as-is for the person pages until a
  later cleanup.
- **Picker hygiene (new, required):** PlayerLite carries no `role` today and
  `loadMatchRosters` doesn't select it — so the moment staff rows exist,
  lineup entry, sub panels and the libero panel would offer the coach as a
  player. Thread `role` (+ `staffFunction`) into PlayerLite and filter every
  existing picker to `role === "PLAYER"`; only the SanctionsControl Bench tab
  and the sign-off panel see staff.
- Engine (F2): ~~misconduct target widens `playerId` → `personId` +
  `target: PLAYER|STAFF`~~ **no widening needed** — under the roster-row
  decision the existing `playerId` field already reaches staff (a staff
  member's roster-row id IS a players.id). Payloads, `MisconductRecord` and
  old logs are untouched; the sheet prints `C` when the target row's role is
  STAFF. Zero replay-compat surface.
- UI: SanctionsControl gains a Bench tab (filter by role). Coach pre-match
  signature (F3) is captured **on the scorer console**, exactly like the
  shipped captain flow — ~~team tablet signing pad (extends the G7 flow)~~
  G7's tablet capture never shipped: prematch signing lives in
  `usePrematchSignOff` on the scorer console only, the tablet has no
  signature code, and the signatures API requires an authenticated tenant
  session + scorer PIN that a token-authed tablet does not have. Real tablet
  signing = a new token-auth path on the signatures API — deferred, separate
  security decision.
- DB (F3): none — `match_signatures.role` is a TS-only text enum (schema
  comment: "no DB migration needed"); add `TEAM_A/B_COACH_PREMATCH` in code.
  `signerPlayerId → players.id` works for coaches under the roster-row
  decision.
- PDF: TEAMS bench rows with function codes; sanctions grid prints № or `C`;
  beach coach pre-match signature cell.
- Tests: replay compat on old logs; golden render with a coach penalty;
  a STAFF row never appears in lineup/sub/libero pickers.

### Phase 2 — Sanction consequences, guided (M→L) — F14

*(Re-sized M→L 2026-08-17: the set-scoped default this phase needs does not
exist — see the third bullet.)*

Keep fact-only recording as the base (paper procedure); add guidance so the
score cannot drift from the sanction:
- Penalty (misconduct or delay): after recording, one armed chained action —
  "Award point + service to {opponent}" — emitting the **ordinary rally
  event** (`RALLY_WON_A/B`) with an optional `causedBy: <sanctionEventId>`
  field. Replay-safe: rally payloads are field-less today, old replays ignore
  the extra key, and using the normal rally event keeps `isScoringEvent` /
  `computeAutoEmits` (SET_END, MATCH_END, side switches) working untouched.
  Per-competition `sanctionAutoPoint: PROMPT | AUTO | OFF` (default PROMPT) —
  one nullable column on `tournament_config` + a per-discipline default in
  `resolveConfig()`, the established override pattern.
- Expulsion (indoor): must-resolve state — legal or exceptional substitution;
  no legal option → team incomplete for the set. ~~chaining into the existing
  forfeit machinery~~ **There is no existing set-level machinery to chain
  into**: `FORFEIT` in the common chassis ends the MATCH, and `SET_END` is
  auto-emit-only and deliberately not client-submittable (spec/14 §A2 — a
  client must not be able to fabricate results). This phase therefore adds a
  new engine event `SET_DEFAULT { team, reason }` — validated, client-
  submittable, awarding the set to the opponent at the FORFEIT scoring
  convention (opponent raised to exactly the needed score, defaulting team
  keeps points as-at-moment) and flowing into normal set/match progression.
  Beach: expulsion = `SET_DEFAULT`; disqualification = existing match-level
  `FORFEIT`.
- Escalation guard: warn when issuing a sanction lower than the member
  already holds (state already carries `misconductA/B` records — read, don't
  add); repeat improper request → delay-sanction suggestion.
- Tests: penalty-point undo pairs (undo removes both), expulsion-with-no-sub
  → SET_DEFAULT → match continues, escalation warnings.

### Phase 3 — Fault-correction workflows (L) — F13
- New events `ROTATION_FAULT` (indoor) and `SERVICE_ORDER_FAULT` (beach):
  no-score marker events + the chained ordinary rally event for the point
  (same pattern as Phase 2's penalty point). Late discovery → cancellation of
  the at-fault team's points, built on **batched targeted UNDOs** — not
  REWIND (precision added 2026-08-17): FIVB cancels only the faulting team's
  points while the opponent keeps everything scored in the window, and
  REWIND truncates the whole tail. Targeted-UNDO batches are exactly what
  the machinery already supports — `undoLastEvent` writes multi-UNDO batches
  today, the replay survivors pass (`engine/core/factories.ts`) resolves
  arbitrary UNDO sets, and the sheet data layer walks `survivingEvents`, so
  the service-round grid recomputes for free (the acceptance criterion).
  Scorer picks the fault moment in the scoring-log overlay; the correction =
  one batch of UNDOs targeting the faulting team's `RALLY_WON_*` events in
  the window + the fault marker + the chained point.
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
  *(Scope note 2026-08-17: the 5/6-only restriction is enforced in the
  ENGINE VALIDATOR, not just the panel — `indoor/validator.ts:168` fails on
  any index other than 4/5, and its comment asserts the position-1 exclusion
  this item overturns. The change is validator + UI + a new "libero may not
  serve" guard at serve time. Loosening a validator is replay-safe —
  validation runs only at append. `LIBERO_REDESIGNATION` itself is fully
  wired engine-side (reducer case, validator default-OK, CLIENT_SUBMITTABLE);
  only the UI writer is missing, as planned.)*
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

## Revalidation against code — 2026-08-17 (second pass)

A phase-by-phase walk of the implementation plans against the actual schema,
engine and console code (HEAD `04fc18b`). Phase 0's "confirmed still open"
claims all re-verified ✓. The corrections below are already folded into the
phase texts above (marked *amended 2026-08-17*); this section records the
findings and the cross-cutting rules every phase must follow.

**Plan corrections (folded in above):**
1. **F1** — the codebase already had TWO staff representations (`team_staff`
   with a function enum, and `players.role: STAFF` which the VSR export
   already consumes); the original plan would have added a third. Decision:
   roster rows are authoritative for match surfaces; `team_staff` is not
   extended. Plus the picker-hygiene requirement (PlayerLite has no `role` —
   staff rows would appear in lineup/sub/libero pickers).
2. **F2** — no `playerId → personId` widening: staff-as-roster-rows means the
   existing `playerId` already reaches them. Engine untouched.
3. **F3** — tablet coach signing extended a flow that never shipped on the
   tablet (no signature code there; signatures API needs a session + PIN a
   token-authed tablet lacks). Coach signs on the scorer console; tablet
   signing deferred. No DB migration (role enum is TS-only).
4. **Phase 2** — "existing forfeit machinery" is match-level only; "team
   incomplete for the set" needs the new `SET_DEFAULT` event (SET_END is
   auto-emit-only and deliberately not client-submittable). Re-sized M→L.
5. **Phase 3** — "undo/rewind machinery" made precise: batched targeted
   UNDOs, never REWIND (which would erase the opponent's legitimate points).
   Feasibility confirmed — multi-UNDO batches, the replay survivors pass and
   the sheet's `survivingEvents` walk all exist.
6. **F4** — beach already prints Court from `matches.courtNumber`; no
   `courtLabel` column. F4 shrinks to indoor-renderer work.
7. **F10** — the 5/6 restriction lives in the engine validator, not just the
   panel; scope includes the validator and a serve-block guard.

**Verified correct as planned:** F5 (competitions has venue/city/country/hall,
no timezone — column fits); F6 (grass/light payload unions already carry all
four MISCONDUCT events and the common chassis reduces them — genuinely
UI-mount-only); F8 (the FORFEIT reducer already implements the FIVB points
convention — at-fault team keeps points, opponent raised to exactly the
needed score, unplayed sets not materialized — so F8 is rendering + the
no-show 0-25/0-21 ladder + auto remark, as scoped); F9 (`isExceptional`
engine-complete; note the tablet approval path hardcodes
`isExceptional: false` in `interrupt-requests/route.ts`, so the tablet flow
needs the payload flag + approval UI); F12 (`interrupt_requests.requestType`
enum is TS-only — adding a protest kind is code-only); F7 (both reference
PDFs are checked in under `spec/reference/`); Phase 2's `sanctionAutoPoint`
and `causedBy` shapes (existing config-override pattern; rally payloads are
field-less so an optional key is replay-safe).

**Cross-cutting rules for every phase (easy to miss, each has bitten before):**
- Every new client-originated event type MUST be added to `CLIENT_SUBMITTABLE`
  in `api/matches/[id]/events/route.ts` — otherwise the console gets a 422.
  New auto-emitted events must NOT be (spec/14 §A2).
- Every migration bumps `MIGRATION_JOURNAL_IDX` (`backup-policy.ts`) AND
  `KNOWN_JOURNAL_IDX` (`scripts/restore-backup.mts`) — test-enforced, drifted
  silently once before. Currently both 18 with journal entries 0000–0018 ✓.
- Rollout per spec/28: migrate + validate each phase on homolog
  (`db:migrate:homolog`, the homolog URL), then `db:migrate:prod` + promote.
  Everything in F1–F14 is expand-only (new nullable columns, new optional
  payload fields, new event types), so one-click rollback holds throughout —
  keep it that way.
- New event types also touch: the discipline payload unions, `ScoringLog`
  display, and (only if they score directly) `isScoringEvent` — avoided by
  the marker+chained-rally pattern Phases 2/3 now share.

**Recommendation (sequencing, not correctness):** F7's golden fixtures gate
phases 1–5 but are built in Phase 6 — i.e. after everything they gate. They
need no new features (seed both reference matches as event logs against
today's renderers). Building them FIRST gives every later phase a regression
net; as sequenced, Phase 3's L-sized rewind work lands without one.

Prod consistency (Vercel, project `volleyball`):
- ~~Production = deployment `24abc2e` ("review findings" merge, 2026-08-14), promoted via the spec/28 release console.~~ **Wrong — corrected 2026-08-17.** `/api/version` on the production domain reports `00e89e7`: the `24abc2e` production build exists and is READY but was never promoted (staged builds don't take the domain — spec/28 §3.2). So prod is 3 commits behind the code this plan was verified against, missing the 2026-08-14 review fixes (dashboard membership gate, promote safety nets, last-admin guard). The plan itself is unaffected — spec/29 targets code on main — but promote `24abc2e`+ before relying on those guards, and before any spec/29 phase ships.


## Implementation notes — 2026-08-17

Built phase by phase; each commit message carries the detail. The plan
corrections in §Revalidation all held up in the building. What is worth
recording here is the handful of things the code decided that the plan could
not, and the two places where the work found a defect rather than added a
feature.

### Found while building (not in the plan)

- **The sheet's scores were a stale cache.** `official-data` read each event
  row's denormalized `scoreAfter*` columns. That is correct while undo only
  ever removes events from the TAIL — which was true until F13's late-discovery
  correction, whose whole purpose is undoing points in the MIDDLE of a set.
  Every surviving rally after a cancelled one carried a score that still
  counted it, so the printed ladder would have disagreed with the printed
  result. Scores are now counted from the surviving rallies, with the
  denormalized value kept as the fallback for imported matches that have no
  rally events at all. The fault-correction golden fixture is what caught it.
- **The tablet could not make an exceptional substitution.** The approval route
  hardcoded `isExceptional: false`, so a team's request became an ordinary
  substitution that the engine then rejected as over the per-set limit —
  exactly when a team most needs one (F9).
- **The offline queue was shared across tabs** (Phase 7 audit). It lived in
  `localStorage` with no coordination: two consoles on one match both restored
  and both flushed the same queue — every queued point scored twice — and a tab
  going idle deleted the other tab's unsent events. Now per-tab
  (`sessionStorage`, which still survives reload and navigation) and stamped,
  so a queue older than 3 hours is discarded with a visible message instead of
  replayed into a match that has moved on.
- **Bench officials would have broken scoring** if added without the picker
  work — see §Revalidation §1; the `courtRoster`/`staffRoster` filters and the
  beach `roster.length !== 2` case were the load-bearing part of F1.

### Deliberately still open

- **Medical limits are recorded, not enforced** (F11). Recoveries are captured
  per player, tallied and printed, and repeats are flagged on the sheet — but
  no cap is applied. The per-discipline limits differ and this spec requires
  them verified against the 2025–2028 rulebooks rather than assumed; that
  verification has not happened, so enforcing a guess would be worse than
  enforcing nothing. Marked in `baseReducer.ts` where it would go.
- **Golden fixtures assert content and geometry, not a PDF diff** (F7). The
  reference PDFs in `spec/reference/` remain the layout source of truth, matched
  by eye in spec/21. Extracting their text to diff automatically is separate
  work; a byte-count check presented as one would be worse than the honest gap.
- **Tablet signature capture** (F3). Coaches sign on the scorer console like
  captains. Real tablet signing needs a token-auth path on the signatures API —
  a security decision, not a UI one (§Revalidation §3).
- **Grass/light sheets.** F6 gave those consoles capture parity — the events
  reach the log — but neither discipline has an official sheet, which stays out
  of scope.

### Sequencing, in hindsight

F7's goldens were built in Phase 6 as scheduled, and they immediately caught a
Phase-3 defect that had been sitting in the tree for three commits. The
recommendation in §Revalidation stands and is now evidence rather than opinion:
build the goldens in front of the work they protect.
