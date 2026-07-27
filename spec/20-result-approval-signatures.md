# 20 — Result approval: scoresheet signatures (beach & indoor)

Status: **implemented** (phase 1). Reference documents: the FIVB *Beach Volleyball
International Scoresheet* (APPROVAL block: officials with name/country + both
captains' post-match signatures) and the FIVB *indoor scoresheet* VSR 3.16
(APPROVAL block with First/Second referee, Scorer, Third/Assistant/Challenge
referee + Level, line judges, and a SIGNATURES box for captains and coaches).

## What the workflow is

After the last rally the match parks at `PENDING_CONFIRMATION` (unchanged). On
the scorer console the match-won banner now offers **Sign & confirm result**;
the court zone — the middle of the screen — becomes a white signing area.

Three signatures are collected **on the scorer's device**, in **any order**:

| Role | Signer | Name comes from |
|---|---|---|
| `TEAM_A_CAPTAIN` | a player of team A | roster (the `isCaptain` player is pre-selected; any player may sign as acting captain) |
| `TEAM_B_CAPTAIN` | a player of team B | as above |
| `FIRST_REFEREE` | the 1st referee | `match_officials.FIRST_REFEREE` when it arrived with the match data, otherwise **typed at the table — the pad stays disabled until a name is entered** |

Each signature is `ACCEPT`, `PROTEST` ("signed under protest") or `REFUSED`
("refuses to sign"). Protest and refusal require a short reason, which is
printed on the scoresheet; a refusal stores no drawing.

The third signature confirms the result in one transaction: `FINISHED`,
`confirmedVia = SIGNATURES`, `confirmedAt/By`. From then on the match is
**locked**: no event, not even an `UNDO`, is accepted.

## Obligation is per competition

`TournamentConfig.resultSignatures` — `REQUIRED | OPTIONAL | OFF`
(`tournament_config.result_signatures`, nullable = discipline default).

- Defaults: **BEACH `REQUIRED`**, **INDOOR `REQUIRED`**, GRASS/LIGHT `OFF`.
- The competition Scoring-rules panel exposes it for beach and indoor only —
  the other consoles have no signing flow, so offering the obligation there
  would create a result that can never be confirmed on the console.
- `REQUIRED` does not block a manager: `confirmMatchResult` still works, but
  with missing signatures it demands a reason, records `confirmedVia = ADMIN`,
  and writes the reason + the missing roles into the audit log.

## What a signature attests to

`resultDigest` = SHA-256 of a canonical fingerprint of the result: match id,
status, winner, sets won, **`lastSequence`**, and every set's score/winner.

Every signature stores that digest and the sequence it was signed at. A
signature whose digest no longer matches the current state is **stale**: the
console shows "Result changed — sign again" and the set is incomplete again.
This is what makes it impossible for an undo to silently re-attribute somebody's
consent to a score they never saw.

## Data model (migration 0005)

- `match_officials` — `(match_id, role)` unique; `name` required, `country` and
  `level` optional (beach prints Country, indoor prints Level), `source`
  `MANUAL | IMPORT`. All ten scoresheet roles are modelled so the later
  "officials arrive with the match data" import writes here with no schema
  change; today only `FIRST_REFEREE` is ever written.
- `match_signatures` — role, `signer_name`, `signer_player_id`, `strokes`
  (jsonb), `intent`, `remarks`, `signed_at`, `signed_sequence`,
  `result_digest`, `captured_by`, `device_info`, `invalidated_at/reason`.
  Partial unique index: one **live** signature per role.
- `matches` — `confirmed_at`, `confirmed_by`, `confirmed_via`.

**Signatures are retained permanently.** A superseded or reopened signature is
marked `invalidated_at` with a reason; nothing is ever deleted.

### Why strokes, not an image

`strokes` holds vector polylines normalised to the pad (`0..1`, ~2–6 KB):
crisp at any print size, drawn into the PDF with plain path operators, no image
pipeline, no Storage bucket, no CDN exposure, and small enough to keep in the
row with the rest of the record.

### Why not an engine event

Signatures are not scoring facts. Keeping them out of the event union keeps them
out of validators, replay, snapshots and — critically — the undo target
selection, where one stray Undo could delete a legal signature. The digest gives
the same binding to the log without that risk.

## Locking and reopening

- `POST /api/matches/[id]/events` returns **409** when a signed result exists.
- `rewindMatchAction` refuses on a signed result and says to reopen first.
- `reopenMatchResult(reason)` (admin, audited as `match.reopen`): invalidates
  **all** signatures with the reason, clears the approval columns, returns the
  match to `PENDING_CONFIRMATION`. Re-signing then requires **all three** again.
- A manager-confirmed result (`ADMIN`, no signatures) is **not** locked — that
  path predates signing and keeps its previous behaviour.

### Pre-existing defect fixed here

`derivedMatchColumns` only parked a match at `PENDING_CONFIRMATION` when the
append path passed an override, so `undoLastEvent` and `rewindMatch` wrote a
bare `FINISHED` and skipped confirmation entirely. That mapping is now the
default, and leaving `FINISHED` clears `confirmed_at/by/via`.

## API

`/api/matches/[id]/signatures` — `SCORING_ROLES` + the per-match scorer PIN
(identical gate to posting an event, because it is the same device).

- `GET` → policy, digest, sequence, `complete`, `missing`, `stale`, officials,
  signatures (metadata only — no strokes).
- `POST` `{role, signerName, signerPlayerId?, strokes, intent, remarks?, expectedDigest}`
  → 422 on a bad payload, 409 on a digest conflict / already-confirmed /
  policy `OFF` / a concurrent signature for the same role.
- `DELETE ?role=` → clears one signature before the set is complete (a re-do).
  Once confirmed, only `reopenMatchResult` can change anything.

## Exports

Three documents come off `/api/matches/[id]/export.pdf`:

| Variant | What it is |
|---|---|
| `?type=sheet` | **The official scoresheet** — the document the officials sign and hand in. Landscape A4, modelled on the FIVB *Beach Volleyball International Scoresheet* and the indoor sheet (VSR 3.16): header (competition / match no. / date / site / court / gender / phase / round), TEAMS with both rosters (captain and libero marked), SET RECORD (start, end, duration, points, winner, time-outs, TTO), RESULTS (per-set points, totals, sets won, winning team, match start/end/total), SANCTIONS, REMARKS (protest and refusal statements), GAME INTERRUPTIONS & COURT SWITCHES, and APPROVAL. Renderer: `src/lib/scoresheet-pdf.ts`. |
| default | The internal match report (unchanged, plus the same approval block). |
| `?type=log` | The chronological event-log record, for protests. |

**Signatures are encapsulated.** Each one is drawn inside its own bordered
square, in the pad's own aspect ratio so the ink fills the box, with the box set
as a PDF clipping region — a signature physically cannot run over a neighbouring
cell. `fitStrokes` (in `match-signatures.ts`) is the single implementation of the
unit-square → page-box mapping and is shared by both documents; it letterboxes so
the ink is never stretched and clamps every point into the box.

**Stroke coordinate contract:** x and y are both `0..1` as a fraction of the pad;
`pad` carries only the aspect ratio. Getting this wrong is what broke the first
version — the pad stored y in `0..1` but drew it in a `0 0 1 0.32` viewBox (ink
below the top third vanished on screen) and the PDF multiplied y as though it were
`0..0.32` (ink sprawled ~3× outside its box, over the rest of the sheet).
`signature-pad.test.tsx` and the `fitStrokes` tests pin both ends.

The layout paginates: blocks check the room left before drawing, rosters longer
than six names split into two columns, and the approval block is never split
across pages. Nothing signature-related is exposed on the public results page or
`results.csv`.

Not yet built: the per-rally point-run grid (the numbered strips where each point
is struck through). Every rally is in the event log with score, server team and
server number, so it is a rendering job with no data work.

## Tests

`src/__tests__/lib/signatures.test.ts` — digest stability and sensitivity
(sequence, set score, winner), completeness/stale detection, stroke validation
(clamping, rounding, size caps, junk-point tolerance), per-discipline policy
defaults and overrides. `src/__tests__/lib/export-log-pdf.test.ts` — the
approval block renders with a signature, a protest remark and a refusal, and an
unsigned/manager-confirmed sheet still renders.

SQL behaviour (partial unique index, re-sign after invalidation, officials
upsert, approval columns) was verified against the live database inside a
rolled-back transaction.

## Not in phase 1

- Officials assignment / import UI (the table is ready; only the writer is
  missing) — including 2nd referee, scorer, assistant scorer, line judges and
  the indoor Level column.
- Coach signatures (both sheets have them).
- FIVB RESULTS-block parity: per-set durations and time-outs are in engine state
  but still discarded by `ReportSet`.
- Offline queueing: a signature needs the network. The drawing survives a failed
  POST in the panel, but nothing is persisted locally.
- Per-signer authentication (referee signing on their own device via a
  `match_sessions`-style token).
