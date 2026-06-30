# 08 — Scoreboard redesign (Indoor court formation + Beach top-bar fix)

Status: **design approved, not yet implemented.** This brief is the source of
truth for porting the approved layout into the React components. An interactive,
pixel-faithful mock of the agreed design lives at
[`scoreboards/scoreboard-redesign-preview.html`](scoreboards/scoreboard-redesign-preview.html)
— open it in a browser and use the toggles (Board · Indoor view · Screen ·
Accent · Logo) to see every state. Match that mock.

Branch for the work: **`feat/indoor-scoreboard-layout`** (cut from `origin/main`).

---

## Why

Two problems with the current broadcast boards, plus a new indoor concept:

1. **Beach (`BroadcastBoard.tsx`)** centres all content vertically on a fixed
   1920×1080 stage, so the "top bar" floats ~30 % down the screen and the layout
   letterboxes on 4:3. It must be a real top bar (pinned to the top edge) and the
   content must fill the screen on both **16:9 and 4:3**, readable from distance
   (this is a venue / GS scoreboard).
2. **Indoor (`IndoorBoard.tsx`)** showed players as side lists, hardcoded several
   accent colours, and wasted space on a logo.
3. New concept: show the indoor players **in court formation** (positions 1–6 as
   jerseys), which reads far better from afar and is truer to the sport.

Design references: the official FIVB venue-brand `.ai` files (VNL + Beach Pro
Tour, 16:9 and 4:3). Palette taken from them: ground `#0E1A2B`, accent
`#E8431F` (VNL/BPT red) / `#F2A01E` (Finals gold), score plates white `#FFFFFF`
with `#1B43E8` blue numerals; condensed bold uppercase type (Saira/Barlow
Condensed — already loaded in the scoreboard route via Google Fonts).

---

## Files

| File | Change |
|------|--------|
| `src/components/scoreboard/BroadcastBoard.tsx` | Rewrite render to fluid, top-aligned (beach/grass/light). Keep the `BoardProps` interface so `ScoreboardDisplay` needs no changes. |
| `src/components/scoreboard/IndoorBoard.tsx` | Rewrite to the court-formation layout below. Keep the side-list as a fallback (see Data). |
| `src/components/scoreboard/ScoreboardDisplay.tsx` | No prop changes expected; verify it still passes `rotationA/B`, colours, sets, timeouts/subs to `IndoorBoard`. |

The route (`src/app/t/[tenantSlug]/scoreboard/[matchId]/page.tsx`) already loads
`rosters`, `branding`, theme and colours — no change expected there.

---

## Shared layout principles (both boards)

- **Full-viewport, fluid.** Root is `position:fixed; inset:0; container-type:size`.
  All sizes in **container-query units** (`cqmin`, etc.) so the board scales
  identically at any size and fills both 16:9 and 4:3 — no fixed 1920×1080 stage,
  no transform-scale, no letterboxing. (The mock uses `cqmin` on a stage element;
  in the app the fixed root is the container.)
- **Real top region pinned to the top**, content distributed to fill height.
- **White-label theming preserved.** Keep driving everything through the CSS vars
  already in the components (`--bg/--line/--font/--accent/--ff/--radius`). The
  accent must colour **every** box, line and highlight (see the bug list below).
- **Colour swatch = team jersey colour.** Use `teamSwatch(color, bg)` from
  `src/lib/colors.ts`. Render it as a clearly visible block (not a thin sliver).
- **Auto-fit text to one line** for names that can be long (see below).

### Auto-fit helper (needed by both boards)

Country names (indoor) and player names (court) must sit on **one line, never
truncated with `…`**. They render at a max size and shrink only as needed to fit
their slot. The components are already `"use client"`, so implement a small
measure-on-layout hook:

```
useEffect(() => { fitAll(); }, [deps...]);     // after render
useEffect(() => {
  const on = () => fitAll();
  window.addEventListener("resize", on);
  return () => window.removeEventListener("resize", on);
}, []);
// fitAll(): for each fit target, start at max font (cqmin→px via min(boardW,boardH)),
// decrement until el.scrollWidth <= slot.clientWidth (floor ~8px).
```

The mock's `fitNames()` is the exact reference algorithm.

---

## Beach board (`BroadcastBoard.tsx`) — target layout

Flex column, `justify-content: space-between`, padding ~3cqmin, fills height.
Top → bottom:

1. **Top bar** — pinned to the top edge. Full-width frame with `border` in the
   accent. Row: `[swatch + team A name] [setsWonA box][setsWonB box] [team B name + swatch]`.
   Team names use the **two-line wrap** treatment (beach = athlete-pair surnames,
   so stacking two lines is correct; cap at 2 lines).
2. **Competition logo** — centred; reserve its height even when absent (space held).
   Keep the logo on beach (the references feature it prominently).
3. **Set indicator** — `■ SET N ■` (accent squares either side), centred. Show
   `Final` when finished.
4. **Score row** — grid `1fr auto 1fr`: huge BigScore A · centre set ladder ·
   huge BigScore B. Ladder = per-set `scoreA | setNumber(boxed) | scoreB`, only
   played/current sets; current set box filled accent; loser side dimmed.

---

## Indoor board (`IndoorBoard.tsx`) — target layout (court formation)

**No logo on indoor** (removed to maximise court size).

Flex column, padding ~2.6cqmin. Top → bottom:

1. **Team + score band** (flex none): `[team A: swatch + country name] [centre] [team B: country name + swatch]`.
   - **Country names: single line, centred, auto-fit** (max ~9cqmin, shrink to
     fit). Verified with "Dominican Republic" on 16:9 and 4:3.
   - **Centre** = small `Set N` label (accent) over two big current-score plates
     (white, accent border, blue numerals) over two small sets-won plates.
2. **Court area** (the focus):
   - **One court, net (solid white line) in the centre.** Team A = left half,
     Team B = right half.
   - **Realistic proportions:** the whole court is locked to **2:1** (two 9×9 m
     halves). Height-capped (~56cqmin tall in the mock) so it reads short & wide,
     not a tall panel. Make it as big as the space allows.
   - **Positions 1–6 placed as on court.** Front row (4·3·2) nearest the net;
     back row (5·6·1) toward the outside. **3 m line** = a **dashed** line on each
     side, placed 1/3 of the half-court in from the net (back zone is twice the
     depth of the front zone — `flex:2` back vs `flex:1` front).
   - **Each player = a jersey (number on the shirt) + name underneath.** Jersey
     filled in the team colour; number auto-contrasts black/white. Shirts small,
     **names bigger** and auto-fit to one line (no `…`). Verified with
     "Worapeerachayakorn".
   - **Libero** = **transparent jersey outlined in the team colour**, number in
     team colour, small "LIBERO" tag.
   - **Serving player** carries a ball badge on the shirt.
3. **Below the court:**
   - **Time-outs + subs are per-team, on the sides** — vertical stacks flanking
     the court (Team A left, Team B right), each with labelled boxes
     (`used/max`).
   - **Set ladder** centred under the court (`I · II · III · IV`, scoreA · scoreB
     per set; current set filled accent; past-set **winner score highlighted in
     the accent**, loser dimmed).

### Accent must drive everything (bug fixed in the mock)

In the old indoor board these were **hardcoded** and ignored the accent — do not
reintroduce: player-row / cell outlines, serving-row tint (derive from accent via
rgba), stat-box outlines, jersey-number box outline, and the past-set
winner-score highlight. All must recolour with the accent.

---

## Data requirements & fallbacks

- The court view needs the **live rotation** (who occupies positions 1–6) and the
  **libero designation** per team. The indoor engine tracks `courtPositionsA/B`
  (and libero state) — wire the jerseys from there; mark `serving` from the
  current server.
- **Fallback:** if a roster has no positions yet (lineup not submitted / not an
  indoor set), fall back to the **side-list** layout (kept available). Do not
  crash on missing rotation.
- **Per-player PTS is intentionally omitted** — the engine doesn't track it. Do
  not fake it. (The VNL "stats" board — ATTACKS/BLOCKS/SERVES/OPP ERRORS — is out
  of scope until those stats exist.)

---

## Open questions to confirm before/while implementing

1. **Position mapping orientation** — mock places front row top→bottom as 4·3·2,
   back as 5·6·1, mirrored per side. Confirm against the engine's
   `courtPositions` indexing and FIVB convention; adjust if the server should
   always land back-right.
2. **Player name display** — currently surname only. Option: `"11 · A. Surname"`.
3. **Keep the side-list as a user-selectable mode**, or only as the
   no-rotation fallback? (Mock keeps it as a toggle for comparison.)
4. **Logo on beach** — kept. Confirm it should stay (removed only on indoor).

---

## Acceptance check

Open `scoreboards/scoreboard-redesign-preview.html`, flip Board × Screen ×
Accent × Logo, and match it in the React components. Then verify in-app on a real
indoor match with a submitted lineup (court view) and one without (list
fallback), on a 16:9 and a 4:3 display.
