# 19 — Scorer UX hardening, forfeits & shortcuts (July 2026)

Three batches of scorer-console and officiating work, driven by field feedback
and a comparative study of the original beach prototype
(`github.com/bernardofranco1/my-project-name`):

1. **2026-07-21/22 (shipped in `27c9fec`)** — undo at set boundaries, beach
   serve-prompt gating, floating time-out countdowns.
2. **2026-07-23** — forfeit/retirement, deciding-set re-toss, replay-point UI,
   configurable keyboard shortcuts, event-log PDF export.

Everything here is discipline-agnostic unless stated (shared chassis in
`src/engine/core/`, shared UI in `src/components/scoring/shared/`).

---

## 1. Undo: `scope` semantics (the set-boundary fix)

**Problem.** The set-break countdown auto-dispatches `SET_START`, and set
starts add `SERVICE_ORDER` (beach) / `LINEUP_CONFIRMED` (rotation) on top of
the undo stack. "Undo the set-winning point" therefore took several taps
through events with no visible effect — and because the banner Undo buttons
were single-tap, not disabled while pending, and UNDO is non-optimistic,
impatient re-taps silently unwound extra rallies of the finished set.

**Fix — request-time `scope` on the UNDO payload** (never persisted; the
stored `UNDO {targetEventId}` rows are unchanged):

| scope | Behaviour | Used by |
|---|---|---|
| `"point"` | `selectUndoTargets` sweeps **bookkeeping** events (`SET_START`, `SERVICE_ORDER`, `LINEUP_CONFIRMED`) sitting on the stack and removes the last **real** action beneath them in ONE atomic batch (plus its openers/followers). Never crosses **lifecycle** events (`MATCH_CREATED`, `COIN_TOSS`, `MATCH_START`) — with only bookkeeping above a lifecycle event, just the bookkeeping is removed (= cancel set start). | Every scorer-facing Undo button/shortcut |
| `"single"` (default) | Strict one-scorer-event-per-undo (original behaviour). | `CancelSetStart`'s counted loop |

Existing batch rules are preserved inside the sweep: a completed time-out is
undone as END+REQUEST; trailing system auto-emits (`SET_END`, `MATCH_END`,
`SIDE_SWITCH`, `TTO_START`) of the deepest target are removed with it.

**Guard rails around undo** (all in the same change):
- Every banner/overlay Undo is **two-tap armed** and **disabled while a post is
  in flight** (`pending`) — extra taps can no longer queue extra undos.
- At a fresh-set boundary (0-0, set > 1) the armed label is explicit:
  *"Undo last point of set N?"* (`scoring.confirmUndoPoint`).
- The server returns `undone: string[]` (removed event types); the provider
  exposes it as `undoneNotice` (5s auto-clear) and `ScoringShell` shows it as
  a header toast via `describeUndone` — a wrong-target undo is visible at once.
- `resync()` in `match-provider.tsx` has a **monotonic guard**: fetched state
  only applies when `lastSequence >=` the local one (a stale refetch racing an
  in-flight undo used to resurrect the undone point). The post-rejection path
  passes `{force: true}` to restore server authority.

**Accepted trade-off:** fixing a wrongly *confirmed* indoor lineup via repeated
undo at 0-0 is gone (the point-scoped sweep takes the previous set's last
point instead — the armed label warns). Corrections go via substitution or
admin rewind.

Tests: `src/__tests__/lib/undo-scope.test.ts`, plus the pre-existing
`undo.test.ts` contracts (single-step, timeout pairing, CancelSetStart).

## 2. Beach first-server prompt — pre-play only

The `SERVICE_ORDER` prompt (`orderPendingTeam` in `LiveScoreboard.tsx`) renders
only while the set is at 0-0. It still asks at every set start (FIVB 12.2:
service order is declared per set, deciding set included) but never lingers
over a running match. Display falls back to roster order until declared;
`SERVICE_ORDER` remains re-submittable through the API for corrections.

## 3. Floating countdown (time-outs / set breaks)

The full-screen dim+blur `CountdownOverlay` blocker is gone. `FloatingCountdown`
(`shared/CountdownOverlay.tsx`) is a non-blocking card over the court:
`pointer-events-none` throughout (taps pass through), accent border = calling
team's colour (set breaks use the theme primary), digits pulse over the final
5s (`motion-reduce` respected), `role="timer"`.

Per surface:
- **Scorer console** (`PhaseBanners`): the passive clock floats at `top-[34%]`;
  the controls (End time-out / Start next set / Undo) always live in the bottom
  banner. The card carries no buttons by design — ending a time-out stays a
  deliberate thumb-zone action.
- **Public scoreboard** (`ScoreboardDisplay`): card mid-board between the big
  digits; set-break card recaps `Set N · a–b`. Score/sets/serve stay legible.
- **Team tablet**: same swap — request buttons stay usable during time-outs.

Deadlines still derive from server event timestamps; auto-end/auto-advance
timers and the 10s staleness grace are untouched. Design mockup (before/after):
https://claude.ai/code/artifact/b1aca56d-77de-4d4f-bf1d-151052a0925d

## 4. Forfeit & retirement (FIVB 6.4)

New scorer-submitted common event, handled in `reduceCommon` (which now takes
`config`):

```ts
{ type: "FORFEIT"; team: TeamId; reason: "FORFEIT" | "RETIREMENT" }
```

- `team` gives up; the **opponent wins**. `FORFEIT` = default (no-show /
  refusal, 6.4.2); `RETIREMENT` = unable to continue (injury, 6.4.3).
- Points and sets already scored are **kept**. The open set closes for the
  opponent with their score raised to exactly what they needed to win it
  (`max(score, setWinTarget, otherScore + lead)` — at 20-20/target-21 it
  closes 22-20). The winner's `setsWon` jumps to `setsNeededToWin(config)`.
- **Unplayed sets are NOT materialized** — no phantom 21-0/25-0 rows; the
  FORFEIT event itself is the record (log, log-PDF, report). *Open question:
  if FIVB scoresheet conventions require nominal set lines for a walkover,
  add them in this reducer case.*
- Valid from `COIN_TOSS` status onward (a no-show default precedes any toss);
  rejected at `SETUP`/`FINISHED`. Clears any live interruption. Lands the
  match row at `PENDING_CONFIRMATION` like any final point. **Undoable** —
  it's a normal terminal target for `selectUndoTargets`, one undo restores
  the pre-forfeit state.
- UI: `shared/ForfeitControl.tsx` — a low-key dotted-underline trigger under
  every action bar and pre-live banner; modal = team → reason → two-tap armed
  confirm ("Tap again — {opponent} wins the match").

Tests: `src/__tests__/engine/forfeit.test.ts` (beach best-of-3 + indoor
best-of-5: mid-set retirement, two-point lead, no-show, kept sets, timeout
clearing, undo round-trip, validator gates).

## 5. Deciding-set coin toss

FIVB rules require a NEW toss before the deciding set; the platform used to
auto-alternate `firstServer` into it. Now:
- `startNextSet` (PhaseBanners) refuses `nextSetNumber >= config.bestOf`, so
  the set-break auto-advance can never start the decider.
- The set-break banner replaces "Start next set" with `DecidingSetToss` — the
  same two-step interaction as the match toss (who serves → team A's side),
  dispatching `SET_START` with the chosen values. The rewind/undo edge (LIVE
  with an unstarted deciding set) gets the same component.

## 6. Replay point

`REPLAY_POINT` (rally replayed, no score/serve change) was fully supported by
every engine/validator and the API but had no UI. It now has a two-tap armed
"Replay" button in the `LiveScoreGrid` middle column (`Armed` gained a
`"REPLAY"` key) and log labels ("Point replayed").

## 7. Configurable keyboard shortcuts

**Files:** `src/lib/shortcuts.ts` (pure: ids, defaults, persistence) and
`src/components/scoring/shared/shortcuts-context.tsx` (runtime + settings UI).

Defaults (all rebindable):

| Key | Action id | Meaning |
|---|---|---|
| `,` / `.` | pointLeft / pointRight | Point for the team shown on the **left/right** — follows court sides, swaps on side switch |
| `r` | replay | Replay point |
| `u` | undo | Undo (point-scoped) |
| `1` / `2` | timeoutLeft / timeoutRight | Time-out, left/right team |
| `n` | note | Note prompt |
| `enter` | advance | Context primary action (start match/set, end time-out/TTO/medical) |
| `?` | help | Open the settings panel |

Design decisions:
- **Registration follows the screen.** One window listener per console
  (`ShortcutProvider`, wrapped around each discipline's scoreboard). Action
  bars register grid actions only while live (`useShortcut(id, live ? fn :
  null)`); each phase banner renders `<ShortcutAction id run/>` for its own
  advance/undo. A key can only ever fire something the scorer can also see
  and tap.
- **Same arming as touch.** Every destructive handler routes through
  `tapConfirm` — first press arms the on-screen button, second commits.
- **Guards:** typing targets (input/textarea/select/contentEditable), any open
  `[role=dialog]`, Ctrl/Alt/Meta combos, and key auto-repeat are ignored.
  (Shift is allowed — `?` needs it.)
- **Per-device persistence:** `localStorage["vbkeymap"]`, merged over
  `DEFAULT_KEYMAP` on every read (`mergeKeymap` drops corrupt values; actions
  added later automatically get their default key). Deliberately NOT in
  tournamentConfig — scorer stations differ and it must work offline.
- **Settings:** ⌨ button in the scoring header (or `?`): per-action rebind
  ("press a key…", Esc cancels), conflict highlighting, reset to defaults.

Tests: `src/__tests__/lib/shortcuts.test.ts` (normalization, merge, corrupt
storage, conflicts).

## 8. Event-log PDF export

`GET /api/matches/{id}/export.pdf?type=log` — a chronological, human-readable
event log (the document to hand over in a protest): sequence, set, score,
description, actor, UTC time, with set section markers. Descriptions are
spelled out from the payload (`describeLogEvent`: team names, forfeit reason,
challenge outcome…); player ids are not resolved. `ReportEvent` gained the
raw `payload` column for this. English-only, like the match report.
`renderLogPdf` is exported so tests render it with fabricated data (no DB):
`src/__tests__/lib/export-log-pdf.test.ts`. Linked as "Event log (PDF)" next
to the report on the match detail page.

The default (no `type`) response is the existing match report, unchanged.

---

## Prototype-comparison notes (evaluated, NOT adopted)

From the `my-project-name` study — kept here so they aren't re-litigated:

- **Medical assistance awarding the rally to the opponent** (prototype rule):
  the platform's `MEDICAL_TIMEOUT` stays neutral, which we believe is
  rules-correct; the injury-ends-match case is now covered by
  `FORFEIT/RETIREMENT` instead. *Open question for FIVB confirmation.*
- **TTO lock surviving undo** (prototype): the platform deliberately re-arms
  the TTO when the triggering rally is undone (the atomic undo removes the
  rally AND its `TTO_START`) — keep.
- **Ball-mark-check decision detail** (`IN/OUT/TOUCH/INCONCLUSIVE`): the
  platform's `VCS_RESULT` records only `upheld`. Possible future enrichment
  for the log; not needed now.
- Prototype API patterns (process-memory state cache, client-side undo
  targeting, full-log refetch after undo) are all strictly behind the
  platform's snapshot-column / server-side-undo design — nothing to adopt.
