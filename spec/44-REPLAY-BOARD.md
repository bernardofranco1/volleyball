# spec/44 — The replay board: an always-running match for validating any screen

**Status: PLANNED — not yet implemented.** Written 2026-08-20 for an
implementing agent. **Implement spec/43 first** — this spec consumes its
event parser and its enforcement property test.

Prerequisite reading: spec/34 (client/store/route), spec/35 W9 (the static
mock and why it is embedded), spec/37 (cadence), spec/42/43 (rotation).

## 1. Purpose

A board URL that is permanently mid-match, **never touches VIS**, and replays
a real previous match on a loop — so any screen, any state (warm-up, live
rally, timeout, substitution, set break, match point, finished) can be
validated at any moment, offline, without waiting for a real fixture.

The existing mock (spec/35 W9) is one frozen frame and bypasses the whole
pipeline. The replay is the opposite: a moving clock through a full real
match, driven through the SAME store pipeline as a live board — cadence
transitions, stabiliser, spec/43 enforcement, CDN headers — so it validates
the machinery, not just the pixels.

## 2. The donor match and its clock

Donor: **match 27550** (Qatar vs Venezuela, 2026-08-19, 0–3). Chosen
deliberately: its feed contains the real-world imperfections — nine missed
rotations, one on-court wrong-server (set 1 rally 15), a libero legally at P1
while receiving (set 1 rally 13), substitutions including libero exchanges,
timeouts, challenges — so the replay exercises everything spec/42/43 exist
for. Total 130 rallies over 3 sets.

The full capture (`GetVolleyLive Options="65535"`, ~292 KB) carries a real
millisecond clock, all offsets relative to `Match@BeginDateTime`:

- `Set@BeginTimeOffset` — 0 / 3 060 000 / 4 500 000 for sets 1–3;
- `Rally@TimeOffset` (serve) and `Rally@EndTimeOffset` (rally end);
- `Timeout@TimeOffset`, `Substitution@TimeOffset`.

No timing is synthesised: **an event enters the replay feed when virtual time
passes its `EndTimeOffset` (rallies) or `TimeOffset` (everything else)** —
which reproduces VIS's real behaviour of appending a rally after it ends.

## 3. Fixture

1. Script `scripts/gen-vis-replay-fixture.mjs` (model on the existing
   `scripts/gen-vis-mock.mjs`): one read-only `GetVolleyLive` of the donor
   with `Options="65535"`, then trim and embed:
   - **keep**: `Match` attrs; `Tournament`; `Pool`; both `Team` blocks with
     full `Player`/`VolleyballPlayer` rosters; each `Set` with its attrs, its
     set-level `LineUp` rows (they carry `NoLibero1/2`), and its complete
     `Events` stream (`Rally` with `Action`/`LineUp`/`Substitution` children,
     plus `Substitution`, `Timeout`, `ChallengeRequest`, `ChallengeResult`,
     `TeamPoint` between rallies);
   - **drop**: every `PlayerStatistics` and `TeamStatistics` row (match- and
     set-level) — §4 recomputes the only statistic the board renders;
   - for `PlayerStatistics` keep a minimal roster-shaped remnant per player:
     `NoPlayer`, `NoShirt`, `NoTeam` (the board's jersey/points mapping needs
     these three; verify against `board-data.ts` before trimming further).
   - Output: `src/lib/vis-live/replay-capture.ts` exporting the XML as a
     string constant, embedded like `mock.ts` so bundling carries it and the
     replay can never touch VIS.
2. The generator script itself is committed; regenerating for a different
   donor later is one command. It must refuse any envelope that is not `Get*`
   (copy the guard).

## 4. The frame engine — `src/lib/vis-live/replay.ts`

Pure function, no `Date.now()` inside (callers pass time):

```ts
/** What GetVolleyLive would have answered at `t` ms after first serve-ish. */
export function replayXml(tMs: number, opts?: { chaos?: boolean }): string
export const REPLAY_MATCH_NO = -27550;      // impossible as a real VIS number
export const REPLAY_LABEL = "REPLAY · 27550 QAT-VEN";
```

Frame construction at virtual time `t` (ms), from the embedded capture:

| element / attribute | rule at time t |
|---|---|
| `VolleyLive@Version` | `cycleIndex * 1_000_000 + includedEventCount` — monotonic while anything changes, stable when nothing does, so the spec/43 Version handshake works against the replay too |
| `VolleyLive@PollDelay` | keep the captured value (20) |
| `Match@BeginDateTime` | the WALL-CLOCK instant this cycle's play phase started (§5), ISO-8601 UTC — this is what drives `mapVolleyLive`'s UPCOMING/LIVE inference, untouched |
| `Match@EndDateTime` | present ONLY in the finished phase (copy captured value's role, any fixed timestamp ≤ now works); absent otherwise |
| `Match@Status` | OMIT during pre/play phases (the mapper then falls back to Begin/EndDateTime inference); restore the captured value in the finished phase |
| `Match@MatchPointsA/B` | sets completed at `t` (a set is complete when its final captured rally is included) |
| `Match@NbRallies` | rallies included at `t` |
| other `Match` attrs | verbatim from capture (`NoTeamA/B`, referees, spectators…) |
| `Team`, `Player`, `Tournament`, `Pool` | verbatim, always |
| `Set` rows | only sets with `BeginTimeOffset ≤ t`, in order |
| `Set@PointsTeamA/B` | the last included rally's scores; `0/0` if the set has no included rally yet |
| `Set@NoServingTeam` | before the set's first included rally: the team of the set's rally-1 serve action (this reproduces the real pre-first-rally semantics spec/42's `noteFirstServer` depends on — do not skip it); afterwards: the team of the winner of the last included rally |
| `Set@NbTimeoutTeamA/B`, `NbSubstitutionTeamA/B`, `NbChallenge*` | recomputed = count of that team's included events |
| `Set@Duration`, `NoTeamAtLeft/Right`, `BeginTimeOffset` | verbatim (spec/37 established the mapper must not read Duration as a break signal; emitting it live-style is faithful) |
| set-level `LineUp` rows | verbatim |
| `Events` children | those with (`EndTimeOffset` for Rally, else `TimeOffset`) `≤ t`, in document order, verbatim including all Rally children |
| `PlayerStatistics` (match-level) | one row per rostered player: `NoPlayer`, `NoShirt`, `NoTeam`, and `TotalPoints` = count of that player's included `Action`s with `Note="3"` — **verified exact** against VIS's own totals for all 56 players of 27550+27547; no other stat attrs |

**Chaos mode** (`opts.chaos`), for stabiliser validation: deterministically —
no randomness — for the first 1 500 ms after each included rally's
`EndTimeOffset`, emit the PREVIOUS rally's `LineUp` children on the newest
rally (simulating the feed's observed rewrite window). Nothing else changes.
The pipeline under test must hide this from the rendered board.

## 5. The clock — stateless, per-instance-identical, nothing scheduled

```ts
export const REPLAY_EPOCH_MS = Date.UTC(2026, 7, 20);  // fixed, committed
export const REPLAY_SPEED = 4;         // virtual ms per wall ms during play
const HOLD_UPCOMING_MS = 120_000;      // board shows warm-up / pre-match
const HOLD_FINISHED_MS = 120_000;      // board shows the final result
// playWallMs = ceil(captureSpanMs / REPLAY_SPEED), captureSpanMs = last
// event's EndTimeOffset. cycle = HOLD_UPCOMING + playWall + HOLD_FINISHED.
```

`phaseAt(nowMs)`: `p = (nowMs - REPLAY_EPOCH_MS) mod cycle` →
UPCOMING while `p < HOLD_UPCOMING`; play with
`t = (p - HOLD_UPCOMING) * REPLAY_SPEED`; finished otherwise.
`Match@BeginDateTime` for the frame = `nowMs - p + HOLD_UPCOMING`, as ISO.

Properties this buys, all deliberate: every serverless instance computes the
identical frame from wall clock alone (no store, no coordination); nothing
runs when no board is open (the spec/37 philosophy — no cron, no warmer);
at 4× speed a rally lands every few seconds and a full cycle is ~30 min, so a
validator never waits long for the state they need. `?speed=1` (query param
threaded to the engine) gives real-time when the cadence itself is under
test; speed is part of the frame computation only, never stored.

## 6. Wiring — through the real pipeline, not beside it

Files: `src/lib/vis-live/store.ts`, `src/app/api/vis/board/[matchNo]/route.ts`,
the board pages, the status page.

1. **Refactor first**: extract from `getBoard`'s full-payload branch a
   `buildBoardFromXml(matchNo, xml, { audit: boolean }): VisBoardData` that
   contains everything between "xml in hand" and "board built" — set
   extraction, `noteFirstServer`, spec/43 enforcement, stabilise, map, and
   (when `audit`) the fire-and-forget shadow. `getBoard` calls it with
   `audit: true`; behaviour byte-identical.
2. `getReplayBoard(now, {chaos, speed}): Aged<VisBoardData>` in the store:
   compute `replayXml(phase)`, call `buildBoardFromXml(REPLAY_MATCH_NO, xml,
   { audit: false })`, cache in the same `boards` map keyed by
   `REPLAY_MATCH_NO` with the same cadence-derived TTL. **`audit: false` is a
   hard requirement — the replay must never write a `vis_rotation_log` row**;
   fiction in the evidence table would poison the spec/42/43 verdicts. Guard
   it in `shadowRotation` too (`matchNo === REPLAY_MATCH_NO → return`), belt
   and braces.
3. Route: accept the literal segment `replay` exactly as `mock` is accepted
   today (before the numeric regex), forwarding `?chaos`/`?speed`. Cache
   headers: same cadence-derived `s-maxage` as a real board — the CDN layer is
   part of what the replay validates. (The mock's `no-store` stays as is.)
4. Pages: wherever the `mock` id renders a board, `replay` renders one too —
   both the plain board and the U-shape. Public URL on the board host:
   `https://fivb-live-scoreboards.vercel.app/Scoreboard/vis/replay`.
5. Status page (spec/41): one pinned row for the replay board — phase, virtual
   score, cycle position — labelled clearly as REPLAY so nobody mistakes it
   for a live match. Reuse `visStoreSnapshot`; `REPLAY_MATCH_NO` being
   negative makes it trivially distinguishable.
6. The allowlist is NOT consulted for `replay` (same as `mock`); do not add
   the sentinel to the allowlist.

## 7. Tests

All pure and offline; the frame engine takes `t` explicitly so nothing sleeps.

1. **Golden frames** at fixed offsets, asserting the `mapVolleyLive` output
   (status, scores, sets, serving side, six on court): pre-match hold;
   1 s before the first rally (UPCOMING→LIVE edge, `NoServingTeam` = first
   server with zero rallies); just after rally 1; during set 1's first
   timeout; the substitution gap before set 1 rally 14; the wrong-server
   rally 15; inside the set 1→2 break (inSetBreak true, MatchPoints credited);
   match end (FINISHED, 0–3); after wrap-around (UPCOMING again).
2. **Full-cycle sweep**: step `t` through one cycle at 500 ms virtual
   resolution; assert for every frame — XML parses; scores monotonic within a
   set; set sequence 1→2→3; `Version` non-decreasing within the cycle;
   board status matches the phase schedule; **the spec/43 no-exception
   property holds on the enforced board: the serving side's P1 equals the
   next recorded serve action's player, every frame, including across the
   nine feed-missed rotations** — this makes the whole 27550 pathology a
   permanent regression suite for the rotation stack.
3. **Chaos sweep**: same sweep with `chaos: true`, asserting the PIPELINE
   output (post-stabiliser/enforcement) is frame-for-frame identical to the
   non-chaos sweep — the rewrite window must be invisible on screen.
4. **NoChanges interaction**: two consecutive `replayXml` calls inside one
   quiet window produce identical `Version`; the store path treats the second
   as unchanged (`changedAt` stable).
5. **Purity/determinism**: `replayXml(t)` twice → identical strings; two
   different "instances" (fresh module state) at the same wall time → equal
   frames.

## 8. Acceptance criteria

- `/Scoreboard/vis/replay` on the board host renders a match that is always
  in some phase of the loop, with zero VIS traffic (verify: no `visRequest`
  call for `REPLAY_MATCH_NO` — assert via a unit test on the store path, and
  once manually with the network tab).
- Zero rows ever written to `vis_rotation_log` for the replay (assert in a
  test that the audit hook is not reached).
- Tests §7 green; all existing tests green; the mock is untouched and still
  serves its frozen frame.
- The status page shows the replay row, labelled REPLAY.
- No migration, no cron, no new environment variable.

## 9. Standing hazards for the implementing agent

Identical to spec/43 §10, plus:

- The embedded capture makes the bundle bigger by ~150–250 KB after trimming;
  this is the accepted cost (the mock already carries ~260 KB) — do not
  "optimise" it onto a network fetch, which would defeat the offline purpose.
- `REPLAY_EPOCH_MS` is a committed constant; never derive it from
  `Date.now()` at module load, or instances will disagree about the phase.
- The replay flows through real cadence TTLs: during its play phase an open
  board polls every second, like a real match. That is the point; do not
  special-case it slower.
