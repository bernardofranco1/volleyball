# 30 — spec/29 follow-ups: the stale-cache blast radius, the deferred register, and the rollout

**Status: PLANNED 2026-08-17. Plan only — no code.** Authored immediately after
spec/29 shipped (branch `feat/spec-29-pro-scoring`, `f05ae22`, unpushed), from
three inputs: the three defects spec/29's implementation *found and fixed*, the
residuals each of those fixes left behind (verified in code during this
planning pass — §1), and spec/29's deliberately-open register. Ends with the
rollout plan for the two unpushed branches (§4), which is where every earlier
"before this goes out" note comes due.

Scope note: the three original defects are FIXED and are not re-planned here.
What this spec plans is (a) their residue, (b) the open register, (c) shipping.

---

## 1. New findings from this planning pass (all verified in code)

### R1 — the stale `scoreAfter*` cache has a blast radius; spec/29 fixed one consumer of five

The Phase-6 fix taught **one** reader — the official-sheet data layer — to
count scores from surviving rallies instead of trusting each event row's
denormalized `scoreAfterA/B` cache. The cache itself is still written once at
append time and never corrected, so after an F13 mid-log cancellation every
surviving later row still carries a score that counted the cancelled points.
Every OTHER reader of that cache was audited for this plan:

| Consumer | How it reads | What it claims to be | Verdict | Phase |
|---|---|---|---|---|
| `scoresheet/official-data.ts` | survivors + counted walk | the official sheet | **fixed** (spec/29 Phase 6) | — |
| `vsr/build.ts:275` | survivors, but `scoreNow` from the cache | the VSR live-feed export — current state | **wrong after a correction** | B |
| `timings.ts:136` | survivors, but per-rally `scoreAfter` from the cache | the timings export | **wrong after a correction** | B |
| `standings.ts:211` | SQL `MAX(scoreAfter*)` over **raw** rows | points ratio → **rankings** | wrong under ANY undo (undone rows still count into MAX); error was ±1-ish before F13, now unbounded | C |
| `competitions.ts loadSetScores` | same `MAX` | list-page set pills; imprecision documented as "one ahead" | degraded past its documented bound by F13 | C |
| `ScoringLog` overlay, admin event-log page, spec/19 log PDF (`scoresheet-pdf.ts`), `match-report-pdf.ts` event lines | raw rows, as-recorded scores | **audit views** of the append-only log | as-recorded is historically truthful — but cancelled rows are **unmarked**, so a post-correction log reads as a score that jumps around | D |
| `FaultCorrection` moment labels | raw, as-recorded | "the fault began here" picker | **correct by design** — the as-recorded score is the score the scorer remembers seeing; do not change | — |

The split matters: current-state documents (VSR, timings) must recompute like
the sheet now does; ranking inputs (standings) must stop aggregating raw rows;
audit views must keep as-recorded values and instead *mark* what was cancelled.
Three different fixes, not one.

### R2 — the tablet's exceptional substitution is still dead on arrival

spec/29 Phase 4 fixed the approval path (it had hardcoded
`isExceptional: false`) — but the request never gets that far:

- `interrupt-requests/route.ts:130` — the quota backstop rejects any
  SUBSTITUTION request when `remaining <= 0`, and *legal subs exhausted* is
  exactly the precondition under which the SubPanel offers the exceptional
  checkbox. The one state where the flag applies is the one state the route
  refuses.
- `TeamTablet.tsx:260` — the tablet's Substitution *button* itself is
  `disabled` when `subsLeft <= 0`, so on the tablet the panel (and its
  checkbox) is unreachable in that state anyway.

Net: exceptional subs work from the scorer console (direct dispatch, engine
validates) and not at all from the tablet. Two gates to open, one route, one
component.

### R3 — the queue migration path strands events across the deploy

Phase 7 moved the queue from `localStorage` to `sessionStorage`, but nothing
migrates: a scorer with events queued under the OLD build who reloads onto the
NEW build loses them silently (the new code never reads the old key), and the
old `vbqueue_*` keys sit in `localStorage` on every scoring device forever.
The bare-array tolerance the new restore code carries is aimed at
`sessionStorage`, where the bare-array shape never existed — it belongs to the
legacy key.

---

## 2. Phases

Sizes: S ≲ half a day, M ≈ a day, L > a day.

### Phase A — tablet exceptional substitution, end to end (S) — closes R2

- **Route** (`interrupt-requests/route.ts`): let a SUBSTITUTION request through
  the quota backstop when `body.isExceptional === true` — the backstop's job is
  stopping a stale tablet from queueing what the team has no allowance for, and
  an exceptional sub is precisely an allowance the team still has. Everything
  else stands: both players validated, engine validation remains the final
  gate at approval (it already accepts `isExceptional` past the cap).
- **Tablet** (`TeamTablet.tsx`): keep the Substitution button enabled at quota
  zero, relabelled ("Substitution — exceptional only"); the SubPanel already
  shows the checkbox in that state and it becomes effectively mandatory there
  (the ordinary confirm stays disabled once `subsUsed >= maxSubs`).
- **Scorer approval UI** (`InterruptNotifications`): show the exceptional flag
  on the pending request, so the scorer approves what was actually asked.
- Tests: route accepts exceptional at quota 0 and still rejects ordinary at
  quota 0; approval emits `isExceptional: true`; panel state at the cap.

### Phase B — one counted-score walk, shared by every current-state document (M) — closes R1 (VSR, timings)

- Extract the running counter Phase 6 in-lined into `official-data.ts` (reset
  on SET_START, +1 per surviving rally, denormalized fallback only while a set
  has no rally events — the imported-match case) into one helper, e.g.
  `survivorsWithScores(events)` beside `survivingEvents`. **Refactor
  `official-data` to consume it too** — the point is one implementation, so the
  sheet, the feed and the timings can never disagree again.
- Consume it in `vsr/build.ts` (replacing the `scoreNow` cache read — the walk
  yields a score for *every* survivor, sanctions and timeouts included, exactly
  as the sheet needs) and `timings.ts` (per-rally `scoreAfter`).
- Acceptance: extend the fault-correction golden fixture to assert the VSR
  feed and the timings export show the post-correction scores — the same
  fixture that caught the sheet.

### Phase C — standings and set pills off the raw-row MAX (M) — closes R1 (rankings)

- **Source of truth:** for FINISHED matches, per-set finals from
  `matches.state_snapshot -> sets` — the snapshot is force-refreshed at every
  set/match boundary and after every UNDO/REWIND/cancellation, so at FINISHED
  it is exactly the replayed truth. Fallback to the current MAX aggregation
  only when a legacy row has no snapshot.
- `standings.ts`: only aggregates FINISHED matches → clean swap.
- `competitions.ts loadSetScores`: finished sets from the snapshot; the
  in-progress set of a LIVE match keeps MAX for freshness (snapshot can lag by
  up to SNAPSHOT_EVERY events), with the doc comment updated to say which sets
  carry which precision.
- Acceptance: a standings test where one cancelled point flips a points-ratio
  tiebreak — MAX gets the ranking wrong, snapshot gets it right. Note for the
  owner (§5): standings are computed on read, so existing competitions may
  visibly re-rank the moment this ships. That is the fix working.

### Phase D — audit views mark cancellations instead of recomputing (S–M)

As-recorded scores in audit views are historically truthful and stay. What is
missing is the reader's ability to see which rows no longer count:

- `ScoringLog` overlay: compute the undone-id set from the UNDO rows it already
  receives; strike through cancelled rows (keep them — it is an audit view) and
  keep rendering the UNDO/REWIND rows themselves.
- spec/19 event-log PDF (`scoresheet-pdf.ts`) and `match-report-pdf.ts`: same
  undone-set computation server-side (the complement of `survivingEvents`);
  annotate cancelled rows ("✕ cancelled"). First step is classifying each of
  the report PDF's three `scoreAfter` sites as audit-line vs current-state —
  any current-state one moves to Phase B's helper instead.
- `FaultCorrection` labels: unchanged, with a comment recording that
  as-recorded is deliberate.
- Acceptance: fixture log with a mid-set correction renders the two cancelled
  rallies marked, in the overlay and both PDFs.

### Phase E — legacy queue migration (S) — closes R3

- On provider mount, when the `sessionStorage` key is absent: read the legacy
  `localStorage` key, **delete it immediately** (narrowing the two-tab
  double-adoption window to milliseconds, against a standing hazard), apply the
  same 3-hour age-out, adopt survivors into the session queue and flush.
- Delete stale legacy keys unconditionally (age-out applies to them too).
- One release later: drop the bare-array tolerance from the sessionStorage
  restore path — after this phase it has nothing left to tolerate.
- Acceptance: unit-test the migration decision table (fresh legacy → adopt +
  delete; stale legacy → delete + message; both stores present → session wins).

### Phase F — medical limits: verify, then enforce (M; gated on F-0)

- **F-0 (blocking):** read the actual FIVB 2025–2028 rulebooks — beach and
  indoor — and record the exact rule numbers and limits in this spec before
  any code. spec/29 was right that enforcing a guess is worse than enforcing
  nothing; that stays true in the follow-up. The rulebooks are not in the repo
  (`spec/reference/` has scoresheets only) — product owner to supply, or fetch
  from fivb.com.
- **F-1 (after F-0):** per-discipline defaults in `resolveConfig` (expected
  shape: one recovery per player per match, both codes — *to be confirmed by
  F-0*), one nullable `tournament_config` override column, and validator
  enforcement: reject `MEDICAL_TIMEOUT` with a `playerId` past the cap.
  Without a `playerId` the event stays accepted — recording-first survives,
  and old logs replay unchanged since validation runs only at append.
- **Honest limit:** indoor's precondition ("recovery only when no legal or
  exceptional substitution is available") is not fully checkable engine-side —
  the engine state has lineups, not the full bench. Enforce the per-player
  count; surface the precondition as a console hint; the referee owns it, as
  on paper.
- Console: require the player pick when enforcement is on; show the count.
- Migration ⇒ bump `MIGRATION_JOURNAL_IDX` + `KNOWN_JOURNAL_IDX` (rule stands).

### Phase G — golden fixtures: real text extraction (M–L)

Two tiers, deliberately separated because they have different failure modes:

- **G-0 (blocking, an hour):** check the reference PDFs in `spec/reference/`
  actually carry a text layer. If they are scans, Tier 2 collapses to a manual
  checklist and this spec says so instead of pretending.
- **Tier 1 — self-snapshots (no reference needed):** dev-dependency
  `pdfjs-dist` (legacy Node build); a script extracts `{str, x, y}` items from
  OUR rendered golden PDFs into checked-in JSON snapshots; tests re-render,
  re-extract, and diff. Deterministic (our own fonts), catches any layout or
  content regression, and is the piece that upgrades "byte count + MediaBox"
  into a real net.
- **Tier 2 — reference parity:** extract the FIVB reference sheets once into
  checked-in JSON; assert OUR sheet's label vocabulary covers the reference's,
  zone by zone (labels and ordering — not positions; different fonts make
  geometric equality a lie). Output doubles as the living "what's still
  missing" list that spec/29's register was.
- Acceptance: Tier 1 snapshot tests green on both goldens + both extra
  fixtures; Tier 2 parity report checked in with any accepted gaps annotated.

### Phase H — tablet pre-match signing (M; **gated on a product-owner security decision**)

The design, so the decision has something concrete to approve:

- Signatures API accepts a second auth path: `{token, team}` via
  `validateTabletToken` — same mechanism the interrupt-requests route trusts.
- **Scope, hard-coded:** a tablet token may write exactly two roles —
  `TEAM_{ownTeam}_CAPTAIN_PREMATCH` and `TEAM_{ownTeam}_COACH_PREMATCH` —
  nothing else. The confirmation trio and bench roles stay console-only: they
  finalize results; pre-match signatures attest a roster and never gate
  anything, so their blast radius fits a device we already trust to submit
  lineups. `signerPlayerId` must belong to the token's team; rate-limited per
  session; `deviceInfo` records the tablet session.
- UI: signing pad in `TeamTablet` at lineup confirmation — G7's original
  wording, finally on the device it named. Scorer console capture stays as the
  fallback (shipped in spec/29 Phase 1).
- **The decision for the owner (§5):** direct write under that scope, or an
  approval flow through interrupt-requests. Recommendation: direct write — an
  approval step for a signature adds a scorer interaction to the pre-match
  rush while protecting a record that cannot change any result.

### Phase R — rollout of everything currently unpushed

Order matters (shared-DB rule: never migrate ahead of the code — 2026-08-11):

1. **Merge `fix/homolog-shared-resources` → main** (spec/28 hardening; no
   migrations). First because it is pure safety and everything after benefits.
2. **Fold Phases A + B into `feat/spec-29-pro-scoring`, then merge → main.**
   A and B are defects *of* that branch — shipping F13 with a VSR feed and
   timings export known to contradict the corrected sheet defeats F13's own
   acceptance criterion. C is pre-existing (MAX was wrong under plain undo all
   along) and may follow on its own train; D/E likewise.
3. **Homolog:** push → preview build; `npm run db:clone:homolog -- --execute`;
   `npm run db:migrate:homolog` (applies 0019–0021 to the clone's journal).
4. **Homolog QA** (browser, spec/27 pattern), one check per spec/29 phase:
   staff on roster → TEAMS block + pickers clean; penalty → prompt → point;
   expulsion → SET_DEFAULT → match continues; fault correction → grid + VSR
   + timings agree (Phase B's point); exceptional sub from console AND tablet
   (Phase A's point); protest from both; timezone on a printed sheet; the
   two-tab offline test.
5. **Promote:** *Prepare release* on the validated SHA; `npm run
   db:migrate:prod`; *Promote*. This also finally delivers the stranded
   2026-08-14 review guards (production still serves `00e89e7`).
6. Rollback story: every migration in flight (0019–0021, Phase F's later one)
   is expand-only → one-click rollback preserved throughout.

---

## 3. Sequencing summary

```
A, B ──► fold into feat/spec-29-pro-scoring ──► Phase R (merge → homolog QA → promote)
C ─────► immediately after the merge (own train; ranking-visible — announce)
D, E ──► next train, small
F ─────► F-0 rulebook verification first; F-1 after
G ─────► G-0 text-layer check first; Tier 1 before Tier 2
H ─────► only after the §5 security decision
```

Standing process rule, now backed by evidence (the goldens caught the stale
cache three commits after it landed): **fixtures land before the features they
gate.** Phase B's acceptance extends the same fixtures *first*.

## 4. Explicitly out of scope

- VCS/video-challenge and serve-clock anything (spec/29's deferred register,
  product-owner exclusion — unchanged).
- Grass/light official sheets (capture parity shipped; sheets stay out).
- Rewriting the `scoreAfter*` cache columns in place after a cancellation.
  Considered and rejected for now: the columns are a denormalized display
  cache, but batch-updating historical rows blurs the append-only property the
  whole engine leans on, and Phases B–D remove every reader that misuses the
  cache — after which staleness is harmless. Revisit only if a new consumer
  genuinely needs cheap per-row scores.

## 5. Decisions for the product owner

1. **Phase H security model:** tablet direct-write for own-team pre-match
   roles (recommended), approval-flow, or keep console-only?
2. **Phase F sources:** supply the FIVB 2025–2028 rulebook PDFs (or approve
   fetching from fivb.com) so F-0 can cite rule numbers instead of memory.
3. **Phase C visibility:** standings may re-rank existing competitions when
   the fix ships (computed on read). Ship silently or with a note to tenants?
4. **Phase R timing:** the promote also delivers the 2026-08-14 security
   guards; if spec/29 QA drags, consider promoting the already-built `24abc2e`
   production artifact first so those guards stop waiting on feature work.
