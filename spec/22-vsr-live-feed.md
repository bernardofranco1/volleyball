# 22 — VSR live feed: action-by-action match logs for VIS

Status: **implemented (generator + export + dispatch hook)** 2026-07-28.
Reference documents: two real VolleyStation Refereeing match logs supplied by
the user — `Match log 26665.vsr` (indoor, VNL 2026 Final — the same match as
the spec/21 indoor reference sheet) and `Match log 505567.vsr` (beach, WCh
2025 Final). They are **NOT** checked into this public repo: they contain
real officials' digital signatures. They live on the analysis machine's home
folder; the mapping below is the durable record.

## What a .vsr file is

A single JSON **snapshot of the entire match**, regenerated as the match
progresses. It is not an event-delta feed: "sending the file to VIS at every
action" means rebuilding the full document after each accepted action and
uploading it again. That matches our architecture perfectly — our append-only
event log can deterministically rebuild the snapshot at ANY sequence.

Top-level shape (both disciplines):

```
{ scout, settings, signatures, approvals, version,
  startDate, competition, matchNumber, division, category,
  teams: {home, away}, officials, visId, spectators, remarks?,
  // indoor extras: city, country, hall, phase, round
  // beach extras:  court, phase, round }
```

`version`: 7 in the indoor reference, 6 in the beach one (format version).
`visId`: the VIS match number — the join key to VIS (26665 / 505567).
`division`: `M|F`; `category`: `S` (senior). `startDate`/times are ISO UTC.

### scout
- `sets[]`: `{ startingLineup, startTime, endTime, duration(min), score:{home,away}, events[] }`
  - beach sets also carry `coinToss: {leftSide, winner, serve}` per set
    (values `home|away`); indoor has one `scout.coinToss = {start:{leftSide,
    serve, winner}}`.
  - `startingLineup`: indoor = 6 jersey numbers in rotation order per team;
    beach = a 6-slot array with the two jerseys at indexes 0 and 4 in
    SERVICE ORDER (`[first, null, null, null, second, null]`).
- `events[]` — ordered union; one object may carry MULTIPLE keys when things
  happen together (indoor: a `rally` bundled with the automatic `libero`
  exchange at rally end). Kinds observed:
  - `rally: {startTime, endTime, point: home|away}`
  - `timeout: {team, time}`
  - `technicalTimeout: {time, approved: true}` (beach)
  - `substitution: {team, in, out, time}` (jersey numbers)
  - `libero: {enters: bool, team, libero: <jersey>, player: <jersey>, time}`
  - `videoChallenge: {team, reason, atScore:{home,away}, startTime, endTime,
     method: "video", response: "correct"|"wrong"}`
- `interruptions[]`, `objections[]`, `undoLog[]` (all empty in both
  references — schemas unknown), `ended: <ISO>`.

### settings
The full ruleset (~60 keys): `variation: "indoor"|"beach"`, winningScore
(sets to win), regularSetWin/decidingSetWin, maxSubstitution, maxTimeout,
timeoutLength[], technicalTimeouts[] (beach `[21]`) + Length + ScoreSum flag,
libero, rotationZones (`[1,6,5,4,3,2]` / `[1,5]`), coinTossEachSet,
pointsToSwitchSides(7)/Deciding(5) (beach), setBreaks[], serveTimer, etc.
Our builder starts from a per-discipline template copied from the reference
files and overrides everything derivable from `TournamentConfig`.

### teams / officials / approvals
- `teams.home|away`: `{code, name, shortName, captain(jersey), players[
  {firstName, lastName, shirtNumber, shirtName, code, position}], libero[
  jerseys], reserve[], staff[{person:{firstName,lastName}, type,
  nationality?}], color}`. `code` values in the references are VIS team
  numbers — we don't have those; we emit our team id (see Open questions).
- `officials`: `referee1/2/3, refereeChallenge, scorer1, scorer2,
  lineJudge1/2` each `{firstName, lastName, level}` → from `match_officials`
  (`level` = level ?? country).
- `approvals`: `roster.captain.{home,away}` + `roster.coach.*` (pre-match)
  and `result.captain.* / referee1 / referee2 / refereeChallenge / scorer1 /
  scorer2` (post-match), each an **SVG string** of the signature. Our
  `match_signatures` strokes are converted to SVG polyline paths in the same
  500×150 viewBox. `signatures: {}` in both references.

## Our mapping (event log → .vsr)

`src/lib/vsr/build.ts` — `buildVsr(report, config)`:
- home = team A, away = team B (fixed mapping).
- Surviving events (same UNDO/REWIND pass as spec/21) walked per set;
  rally `endTime` = the RALLY event timestamp, `startTime` = the previous
  event's timestamp (the engine records rally results as instants — the
  approximation is documented).
- `TTO_START` → `technicalTimeout`; `TIMEOUT_REQUEST` → `timeout`;
  `SUBSTITUTION` → jerseys via roster; `LIBERO_REPLACEMENT` → `libero`
  (`direction IN/OUT` → `enters`); `VCS_CHALLENGE`+`VCS_RESULT` →
  `videoChallenge` (`upheld` → `correct`, else `wrong`; reason defaults to
  `"other"` — we don't capture the challenge reason yet). ⚠ `correct` is WRONG:
  real logs say `right`, and both live feeds do carry the reason — see Open
  question 4, answered.
- Coin toss: `tossWinner` (spec/21) feeds `winner`; missing → the serving
  team (flagged in Open questions).
- `undoLog` stays `[]`: every snapshot is rebuilt AFTER the undo, so the
  dispatched file always reflects the corrected state — exactly the point of
  full-snapshot semantics.
- **Rally timing (added same day)**: a new `RALLY_START` event (all four
  disciplines, client-submittable, valid only BETWEEN_RALLIES while LIVE)
  anchors the rally's REAL start — the consoles expose an optional "Serve ●"
  tap in the shared live controls. When present, VSR `rally.startTime` and
  the timing export use it; when skipped, the previous event's timestamp
  approximates it (flagged `precise: false` in the timing export). Scoring is
  unaffected either way.
- **Timing export**: `GET /api/matches/[id]/export.timings` — the full
  breakdown per rally / set / break (timeouts, TTOs, medical, video
  challenges, set breaks) computed by `src/lib/timings.ts` from the surviving
  log; final once the match ends. The beach official sheet now prints the
  "Total match duration adjustment for Video challenge" remark from the same
  computation (closes spec/21 G9).
- Sanctions, forfeits, medical: not present in either reference file —
  schema unknown, currently omitted (Open questions).

## Surfaces

1. **Download**: `GET /api/matches/[id]/export.pdf?type=vsr` → JSON,
   `Match log <visId|matchNumber>.vsr` (same authz as the other exports).
2. **Live dispatch**: after every accepted scorer action (point, TO, TTO,
   set/match start & end, substitution, libero, challenge, UNDO — anything
   that appends events), `appendMatchEvent` schedules a post-response
   dispatch: rebuild the snapshot and POST it to `VSR_DISPATCH_URL` with
   `Authorization: Bearer $VSR_DISPATCH_TOKEN`, headers
   `X-Match-Vis-Id` + `X-Vsr-Filename`. Bursts are coalesced per match
   (trailing-edge debounce ~1.5 s) and stale sends are skipped when a newer
   sequence already shipped. Fire-and-forget: a dispatch failure never
   affects scoring (logged via observability).
3. `matches.vis_id` column (migration 0007) + input on the match page — the
   join key; dispatch is skipped (with a log) when unset.

## Open questions for FIVB IT / VolleyStation

1. ⚠ The actual VIS ingestion endpoint + auth for .vsr uploads (the VIS web
   service catalogue has `UploadVolleyLive`/`UploadBeachLive`, which take VIS
   Live XML, not .vsr — is there a dedicated VSR intake, or must we convert
   to the Volley/Beach Live XSD?). `VSR_DISPATCH_URL` is deliberately
   generic until answered.
2. Team `code` / player `code` values (VIS numbers) — source of truth for
   our matches?
3. Schemas for `interruptions`, `objections`, `undoLog`, sanctions inside
   .vsr (none occurred in the reference matches).
4. ~~`videoChallenge.response` positive value (`correct` is our assumption;
   only `wrong` was observed) and `reason` vocabulary (`blockTouch`,
   `ballInOut` observed).~~

   **ANSWERED 2026-08-21 (spec/48 W7), from real `.vsr` logs.** The positive
   value is **`"right"`**, not our `"correct"`: `Match log 26665.vsr` (indoor,
   `version: 7`) carries eight `videoChallenge` events, seven `"wrong"` and one
   `"right"`. The upheld one also carries a field we do not emit —
   `"scoreChange": "assignToOther"` — and the same logs add `requested` and
   `bookmarkedAt` timestamps beside `startTime`.

   The `reason` vocabulary observed across the two logs is `ballInOut`,
   `blockTouch`, `netTouch`, `netReach`, `antennaTouch`, `defenseTouch` — the
   same six VolleyStation's live API sends in `challenge_reason`, which is what
   spec/48's card-label map is keyed on.

   ⚠ **`src/lib/vsr/build.ts:429` still emits `"correct"`** for an upheld
   challenge. Nothing dispatches yet (`VSR_DISPATCH_URL` is unset and Q1 is
   still open), so this is not live-breaking, but it is a known wrong value in a
   file we hand to FIVB IT: fix it with, or before, whatever answers Q1. While it
   is being fixed, `reason` is hard-coded to `"other"` on the same object and
   both feeds now carry the real one (spec/48 §3).
5. Format `version` semantics (7 indoor vs 6 beach observed).
