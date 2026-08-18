# spec/35 — AVC template fidelity pass (surgical)

The VIS boards (spec/34) must match the FIVB/AVC Illustrator masters
**exactly** — background, line thicknesses, distances, font sizes. The
template is finished design; there is NO room for interpretation. This spec
turns the user's 2026-08-18 feedback into binding requirements, and — the
important part — replaces eyeballing with **measured geometry and a pixel-diff
gate**, so "exact" is verified, not asserted.

Written for an implementer with no prior context. Deliverables include a
user-validation mock (W9) — the user signs off on the mock URLs, so they are
part of done, not an extra. spec/34's ground rules all
still apply (read them first: read-only VIS, raw-XML POST, PollDelay, no
migrations, no new deps, verification gate). This spec ADDS the fidelity
rules below.

## The five requirements (user feedback, 2026-08-18 — all binding)

1. **The background is the master's own artwork**, not an approximation. The
   official backgrounds are ALREADY EXTRACTED (see "Reference pack") and live
   in `public/board-bg/avc-*.png`. Every gradient approximation currently in
   the components must be deleted.
2. **Flags have no white border/plate.** The flag fills its box edge-to-edge.
3. **Player lists show the CURRENT rotation**: the first row is the player in
   position 1 right now, from VIS. The Mikasa ball + the red row-frame mark
   the serving team's position-1 player ONLY. (The master shows red frames on
   both first rows — that is the template's dummy state; the user has defined
   the live semantics, and the user wins.)
4. **U-shape gains flag + 3-letter FIVB code per side** (see W6 — the one
   deliberate addition to the template, requested explicitly).
5. **No date/time on top of the scoreboard.** The top slot reads `SET n`
   live, `FINAL` after, and stays EMPTY before the match.

## Reference pack (all in-repo, generated 2026-08-18 — do NOT regenerate)

| Path | What |
|---|---|
| `public/board-bg/avc-scoreboard.png` | Official background, scoreboard master, 1920×1080, lossless (the master's own "Background" layer rendered alone) |
| `public/board-bg/avc-set.png` | Same for the set-stats master |
| `public/board-bg/avc-ushape.png` | Same for the U-shape master |
| `public/board-art/mikasa-ball.png` | The master's own ball icon, circle-masked to alpha, 222 px |
| `spec/reference/avc/full4x-*.png` | The three FULL masters at 4× (288 dpi; 1 render px = 0.25 design px) — the diff targets |
| `spec/reference/avc/*.measure.json` | Machine-measured bounding boxes of every accent-red and plate-white component, **in design px (1920×1080)** |
| `spec/reference/avc/measure.py` | The measuring script (pure python, no deps) — rerun on any render to re-derive geometry |
| `spec/reference/avc/extract-backgrounds.py` | How the backgrounds were pulled (pikepdf layer toggle), for reproducibility |
| `src/__tests__/fixtures/vis/volley-live-rotation-finished.xml` | Real `GetVolleyLive Options=2584` payload for match 27062 — carries per-rally LineUps (98/74/98 per set) |

Font: `pdffonts` on the masters shows exactly ONE embedded face —
**AncorliRegular** — which is already self-hosted (`--font-ancorli`). Every
piece of lettering on these boards is Ancorli; no second face exists.

## Geometry authority

`spec/reference/avc/*.measure.json` is the single source of truth. Key
values already read out of the scoreboard master (design px; y from top):

| Element | x | y | w × h | Notes |
|---|---|---|---|---|
| Big score plate L | 738.5 | 140.5 | 214.5 × 190.5 | white; plate gap ≈ 13.5; red frame ≈ 12 around the pair |
| Big score plate R | 966.5 | 140.5 | 215 × 190.5 | |
| Big red digits | — | 174.5 | ≈ 96 × 120.5 | digit cap box → font size |
| Sets plate L / R | 813 / 965.5 | 343.5 | ≈ 140 × 133 | small red digits ≈ 62 × 78 |
| Flag box L / R | 489 / 1301 | 171.5 | 130 × 130 | flag FILLS the box — no plate, no border (Japan's white field in the master is the flag itself) |
| Team name cap height | — | ≈ 210 | ≈ 52 | uppercase Ancorli |
| Serving row frame | 97 / 1361 | 445.5 | 462 × 98 | red; ONLY on the serving side at runtime (req. 3) |
| Jersey plate | 109 / 1737.5 | 457.5 | 73.5 × 74 | 6 rows, row pitch **93.2** |
| Ball icon | ≈ 575.5 | ≈ 468.5 | 52.5 ⌀ | inner end of the serving row; use `mikasa-ball.png` |
| PTS column | 647.5 / 1168.5 | 382 | 103 × 629.5 | header + 6 cells, shared borders |

For every remaining element (ladder, counters, the whole Set screen, the
whole U-shape) read the corresponding `.measure.json` — red components are
frames/rails/highlight boxes, white components are plates, digits and text
boxes. Where a text SIZE is needed, match the rendered glyph height to the
measured white text-box height (e.g. team names ≈ 52 px caps).

## Work items

**W1 — official backgrounds.** `vis-board-theme.ts` gains per-screen
background paths (scoreboard/set/ushape → the three `avc-*.png`). Components
paint `theme.bg` under the image and DELETE the radial-gradient
approximations. `?bg=` stays as an override; the per-competition
`/board-bg/<competitionId>.jpg` convention stays but now falls back to the
official AVC asset instead of a gradient.

**W2 — borderless flags.** In `VisBoard` and `VisSetStats`: the flag `<img>`
becomes the whole box (130 × 130 on the scoreboard, per measure.json on the
set screen), `object-fit: cover`, no background plate. Missing asset →
3-letter code on a `theme.bg` box, same size.

**W3 — live rotation.** `BOARD_OPTIONS` 2072 → **2584** (adds bit 512:
Events/Rally/LineUp stream). In the mapper, the lineup for each team is the
**LAST** `LineUp` element for that team inside the CURRENT set (they are
chronological; the last one reflects rotations AND substitutions AND the
libero — verified: 98/74/98 LineUps per set in the fixture, last ≠ first).
Position 1 = the current right-back = the server when that team serves.
Serving marker (ball + red row frame) renders on the serving team's
position-1 row only. Pin with the new fixture: team A set 1 first LineUp
`229343,229350,233926,223514,229657,229658` vs last
`229350,233926,223514,229657,234263,229343`. Keep tolerating payloads with
only registered lineups (old fixture) — first == last there.

**W4 — scoreboard geometry pass.** Reposition/resize every element of
`VisBoard` to the measured values (table above + JSON). Line thicknesses:
derive each frame's stroke from the JSON (outer box minus inner plate) — no
free-handing. Digit/text sizes from the measured boxes. Then run the diff
gate (W8) and iterate until it passes.

**W5 — top slot.** Remove the scheduled-time label entirely (and the
`scheduledFallback` plumbing if now unused): `SET n` / `FINAL` / empty.

**W6 — U-shape flag + code.** Add to each rail, ABOVE the big score plate
(the rail is 150 px wide; use flag 150 × 100 at y ≈ 12, code in Ancorli
≈ 40 px caps centred beneath at y ≈ 118, white on background — no plate).
Follows the same physical-side mapping as the rail. This is the single
deliberate addition to the master, explicitly requested; keep it visually
quiet and aligned to the rail column. Codes come from `Team@Code` (these ARE
the FIVB codes).

**W7 — Set-screen geometry pass.** Same treatment as W4 using
`full4x-AVC-VenueBrand-Set-RGB-16-9.measure.json` (16 red / 69 white
components): header cluster, the four bars, value plates, label sizes, the
top-centre logo slot.

**W8 — the pixel-diff gate (what makes this surgical).** Add
`scripts/diff-board.mjs` (playwright + the pure-python or JS PNG reader):

1. Build a REPLICA fixture that reproduces the master's dummy data exactly:
   BRAZIL v BRA-flag, JAPAN v JPN-flag, SET 3, big 2|0, sets 2|0, ladder
   25/10 · 25/10 · 25/10 · 25/10 (I–IV), all counters 1, six rows of
   "PLAYER NAME" jersey 1 / PTS 1, serving team A (ball + red frame row 1
   left; ALSO render the right row-1 frame in replica mode only, to match the
   master's dummy state).
2. Screenshot the board at 1920×1080 with the API intercepted to the replica.
3. Downsample the 4× master by 4 and diff: a pixel matches when
   max(|ΔR|,|ΔG|,|ΔB|) ≤ 32 (antialiasing allowance). Require **≥ 96 %**
   matching pixels overall and **≥ 92 %** inside each element's measured box.
4. Print per-element match rates; the failing element names its own fix.
   BRA/JPN flag interiors may be excluded (different flag sources), the box
   POSITION may not.

**W9 — validation mock (user acceptance vehicle).** The user validates the
whole fidelity pass against ONE real match rendered as if live: **VIS match
21546 — Japan v Poland, VNL 2025 quarterfinal** (Poland 3-0: 25-23, 26-24,
25-12; full rosters, per-rally rotations, team stats, and a court switch —
Japan is at the LEFT in set 3, so the U-shape side mapping is visible). The
payload is captured in
`src/__tests__/fixtures/vis/volley-live-mock-21546.xml` (Options 2584,
2026-08-18) — serve THAT, never live-fetch 21546.

- `src/lib/vis-live/mock.ts`: embeds the fixture XML (generate a TS module
  with the XML as a JSON-escaped string — do not fs.read at runtime, bundling
  must carry it) and exports `mockBoard()`: the payload transformed so the
  latest stage reads as LIVE — strip `Match@EndDateTime` and the LAST set's
  `Duration`. Result: status LIVE, set 3 at 12-25 (match point pending),
  serving side real (`NoServingTeam` = Poland), current rotation = last
  LineUps, ladder sets 1-2 decided, stats populated.
- Routes accept the literal id `mock` alongside digits:
  `/api/vis/board/mock` returns the transformed payload (`Cache-Control:
  no-store`, allowlist bypassed for this one literal — it never touches VIS);
  the board page special-cases it (skip the schedule-membership check);
  `/Scoreboard/vis/mock` short URL redirects into
  `comp_vis_1670`'s board path with id `mock`.
- The notice slot (bottom-right) shows `MOCK · 21546 JPN-POL` on every screen
  so the mock can never be mistaken for a real feed.
- Validation URLs for the user (all on production after promote):
  `/Scoreboard/vis/mock` (scoreboard, live state) ·
  `/Scoreboard/vis/mock?screen=stats` (set-break screen) ·
  `/Scoreboard/vis/mock?layout=ushape` (U-shape; note Japan on the LEFT rail)
  · `/Scoreboard/vis/mock?layout=ushape&window=black` (standalone).
- Tests: mapper over the mock fixture (codes JPN/POL, setsWon 0-3, set-3 last
  LineUp differs from first, `teamAAtLeft === true` in set 3) and the
  transformation (EndDateTime + last Duration stripped ⇒ LIVE, serving "B").

**W10 — gate & wrap.** spec/34 gate (tsc/lint/test/build) + updated fixture
tests + a short "implemented" note appended to this file. Do not promote —
the user reviews the diff numbers first.

## Impediments

None. The three suspected blockers were all cleared on 2026-08-18:
the template font is AncorliRegular (already hosted); the backgrounds are
extractable losslessly from the masters' own "Background" layers (done, in
repo); live rotation exists in VIS (bit 512, fixture in repo). The only
judgment call is W6's placement, which the template does not prescribe —
flagged to the user as such.
