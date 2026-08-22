# spec/48 — Motion for the TV overlay, and the feed upgrades that drive it

Status: APPROVED for implementation 2026-08-21 (motion reviewed live by the
owner against WAAPI demos; the demo page is the motion contract — private
artifact "AVC Bug in Motion"). Baseline: spec/47 as shipped, prod `1e17dc1`.

Two workstreams. **Motion** (W1–W4): the spec/47 graphics stop popping and
start moving — a serve-ball V-flight on side-out, an odometer roll on the
score, slide-from-under reveals for every extension. **Feed** (W5–W6): parse
the challenge data both feeds already carry, so the challenge graphics
auto-trigger with team and category instead of being operator-typed.

No migration. No venue-board changes. Ships on the board host.

---

## 0. Contracts that must not break

1. **`ScoreBug` stays pure** — no hooks, no window, no clock (file header,
   `src/components/tv/ScoreBug.tsx:19-21`). It must render identically on the
   server. All motion is therefore client-side overlay/enhancement in
   `TvViewer`'s stage; `ScoreBug` may gain dumb props only.
2. **The pixel gates pass UNMODIFIED** on the idle state:
   `python3 spec/reference/avc-tv-gfx/validate-bug.py`,
   `node scripts/check-tv-bug.mjs`,
   `python3 spec/reference/avc-tv-gfx/check-render.py`.
   Every animation here is transient; idle geometry is untouched. Do not edit
   the gates or the measured constants in `bug-geometry.ts` /
   `extension-geometry.ts`.
3. **e2e first-frame assertion** (`e2e/tv.spec.ts`): the bug is populated on
   the first painted frame. SSR output must not change.
4. **The director stays pure.** `direct()` (`src/lib/tv/director.ts`) and its
   17 tests do not change for motion; enter/exit presence is a view concern in
   `TvViewer`. (W5/W6 may extend director state for the challenge category —
   see below — with new tests, never edits that weaken existing ones.)
5. **Reduced motion**: every animation gates on the house
   `prefersReducedMotion()` pattern (see `BroadcastBoard.tsx:49-54`) — states
   jump, layout identical.
6. Repo rules: read `AGENTS.md` first (this Next.js is NOT the trained-on
   version — read `node_modules/next/dist/docs/` before writing app code);
   no mirror tests; fixtures before features.

## 1. The approved motion constants (the contract)

Durations/easings were reviewed live and approved 2026-08-21. Change nothing
without a new review. Philosophy: deliberate, not rushed; exits always faster
than entrances.

### M1 · Serve-ball V-flight on side-out — 850 ms

Trigger: a genuine A↔B flip of the serving side between two *delayed* frames
(previous-value ref; skip on mount, skip when serve is null — set break —
skip when unchanged). Beach reference: `BroadcastBoard.tsx:277-313`.

Geometry: slots x 846.5 / 1049 (`ART.ball`), vertex at the axis (x 960)
dipped **+58 px** below the resting y. Departure x is **computed by mirroring
the destination about the axis** — never read from a possibly-mid-flight rect
(beach commit `0f72e61`). Cancel any in-flight animation BEFORE measuring.

```js
ball.animate([
  { transform: `translate(${fromX}px, 0) rotate(0deg)`,
    easing: "cubic-bezier(.55,0,.85,.5)" },                       // gravity dive
  { transform: `translate(${midX}px, 58px) rotate(180deg) scale(1.15,.85)`,
    offset: .5, easing: "cubic-bezier(.15,.5,.4,1)" },            // bounce
  { transform: "translate(0,0) rotate(360deg)" },                 // decelerating rise
], { duration: 850 });
```

**Single vertex, NO dwell keyframes.** A contact-dwell variant (extra
keyframes holding the vertex) was demoed and REJECTED by the owner — it broke
the flight. Do not reintroduce.

Implementation: `ScoreBug` gains `ballHidden?: boolean` (default false — SSR
unchanged). New client `ServeBallFlight` in a third SVG layer above the bug
renders the same `/tv-gfx/bug-ball.png`, hides the static ball for the
flight, animates, unhides. `transform-box: fill-box; transform-origin:
center` so rotation spins in place.

### M2 · Score odometer roll — 650 ms

Trigger: score cell value change between delayed frames. Direction follows
sign: increment rolls in from ABOVE; decrement rolls back from below (undo /
challenge overturn). Beach reference: `RollingScore`,
`BroadcastBoard.tsx:200-255`.

```js
outgoing.animate(
  [{ transform: "translateY(0)", opacity: 1 },
   { transform: `translateY(${dir * 115}%)`, opacity: 0 }],
  { duration: 650, easing: "cubic-bezier(.5,0,.7,.4)" });
incoming.animate(
  [{ transform: `translateY(${dir * -115}%)` }, { transform: "translateY(0)" }],
  { duration: 650, easing: "cubic-bezier(.25,.5,.25,1)" });
```

SVG: a `<clipPath>` rect per game-score cell (≈ cx±56, y 941–999) so digits
appear from behind the bar's top edge. Re-arm rule from beach: cancel + hard
remove any leftover outgoing node — a multi-point jump from one poll produces
ONE roll to the final value. Watch 9→10 re-centring (advance-box centring,
`bug-geometry.ts:148-157`): the clip must fit two digits.

Scope: the two game-score cells only. Client `RollingCell` overlay in
`TvViewer`; static `ScoreBug` cells get a visibility prop flipped only after
the overlay has mounted with identical values; hydrated idle state must be
pixel-identical to SSR.

### M3 · Substitution block + key-moment strap — outward slide, two-step

Hidden position `translateX(±410)` (fully under flag + plate; dock = flag
outer edge, 525/1395). Two-step reveal:

- **Plates** (both bands + the travelling 2 px rule): in 650 ms
  `cubic-bezier(.16,.84,.28,1)`; out 480 ms `cubic-bezier(.55,.06,.68,.19)`.
- **Content** (shirts, names, arrows — one group per row): starts **+160 ms**
  after the plates, drift 26 px from the bug's direction + fade, 420 ms
  `cubic-bezier(.2,.7,.25,1)`. Exit: content fades 260 ms while the plate
  slides back.

The jersey silhouettes (`Shirt`, `BugExtensions.tsx:208-257`) ride the
content step — no independent jersey animation (pop/spin rejected as
off-brand). Optional, only if trivial: a single 400 ms directional nudge on
the green in-arrow toward the outgoing row, once per reveal.

`KeyMomentStrap`: same 650 ms outward slide, one piece (no two-step). It is
state-derived (no hold timer): slides in when true, out when false.

### M4 · Time-out tab + challenge alert tab — vertical rise, 450 ms

Hidden `translateY(+36)` (inside the bar band, covered). In 450 ms
`cubic-bezier(.2,.8,.3,1)`; out 360 ms ease-in. The early takedown on a score
change (director rule `director.ts:145-156`) uses the same exit. Pip strike:
260 ms opacity tick.

### M5 · Challenge card — bar hand-off

Bug fades out over its existing 180 ms (`ScoreBug.tsx:71`) WHILE the card
rises `translateY(40)→0` + fade 320 ms. Verdict change REVIEW→verdict: 350 ms
crossfade between two stacked plates (navy under, accentBlue `#3C81BC` or red
`#E81C37` over — animate opacity, never gradient fill). Exit: card sinks +
fades 320 ms, bug fades back 180 ms.

## 2. Groundwork (W1)

- **G1 paint order**: today the extensions SVG paints ABOVE the bug
  (`TvViewer.tsx:269-270`). Swap the sibling order (extensions first, bug
  second) so docked panels genuinely emerge from under the bar; add a THIRD
  SVG layer above the bug for the ball flight and the challenge card. The
  no-re-rasterisation rationale survives (still separate SVGs). If the swap
  breaks anything unexpected, fall back to per-panel reveal clips — same
  look, more code; document the choice.
- **G2 presence lifecycle**: extensions are bare ternaries — nothing can
  animate out. Add a small presence wrapper in `TvViewer` (~40 lines, no
  library): when the director drops a graphic, keep the last element mounted
  in a "leaving" state for its exit duration, then unmount.
- **G4 rehearsal + tests**: extend `?demo=` with `sideout` and `point`
  (`demoGraphics()`, `director.ts:269-326`). New unit tests: flip detection
  (incl. set start, serve-null), roll re-arm (multi-point jump = one roll,
  decrement direction), presence enter/leave timing. Suite baseline: 1045
  tests / 90 files, all green before and after.

## 3. Feed upgrades

### W5 — VolleyStation challenge fields (additive parse)

The match row carries `challenge_team` ("home"/"away"), `challenge_reason`
(observed "netTouch"), `challenge_time`, `challenge_phase` (vocabulary
UNOBSERVED — treat as opaque string, never switch on it), and
`challenge_bookmarks`. A populated example is committed:
`src/__tests__/fixtures/vs/matches.json` match `2504866`.

- Add the five fields to `VsMatch` (`src/lib/vs-live/types.ts`).
- Surface through `mapVsBoard` into `VisChallenge`, which gains
  `category?: string` (a raw feed reason) and keeps its shape otherwise.
- Delete the collapse at `src/lib/vs-live/board-data.ts:162-169` that
  synthesises `challengesRequested === challengesRefused` (it makes REQUESTED
  and SUCCESSFUL unreachable on a VS board). Preferred signal for "in
  flight": `challenge_team` non-null; counters remain the outcome fallback.
- `challenge_count` is REMAINING `[home, guest]` (spec/45 inversion trap).
- Category auto-fill map (feed reason → card label), operator hotkeys 1–6
  still override, and the whole graphic stays hand-drivable (fields may never
  populate on some events — spec/47 open Q5):
  `ballInOut→BALL IN / OUT`, `netTouch→NET TOUCH`, `blockTouch→TOUCH ON
  BLOCK`, `antennaTouch→ANTENNA TOUCH`, `defenseTouch→FLOOR TOUCH`,
  `netReach→NET REACH` (new label); unknown reason → no auto-fill.
- **Gate**: a test drives fixture match 2504866 through the store/signals and
  asserts a REQUESTED challenge for "away" with category "NET TOUCH" —
  currently impossible.

### W6 — VIS live challenge parse (lift from replay to live)

`ChallengeRequest` (`@NoTeam`, `@Type` 1–8, `@RequestedFrom`,
`@PointsTeamA/B`) and `ChallengeResult` (`@Outcome`, `@PointsTeamA/B` = score
AFTER, i.e. the explicit point assignment) are in the XML the live path
already fetches; today only `replay.ts` parses them.

- Parse both in `src/lib/vis-live/events.ts` alongside the existing rally
  parse; feed `tv-signals` an explicit challenge (team, type, outcome, points
  after) with the counter state machine kept as fallback.
- Type labels: 1 AntennaTouch, 2 AttackLineFault, 3 BallInOut, 4 BlockTouch,
  5 CenterLineFault, 6 NetTouch, 7 ServiceLineFault, 8 FloorTouch (XSD enum;
  3/4/6 observed in our captures).
- **⚠ Outcome numeric↔name mapping is UNVERIFIED** (XSD name order does not
  reconcile with observed scores). Safe rule, use it: *result points differ
  from request points ⇒ upheld*. The repo's `2 = upheld` note
  (`replay.ts:85`) is consistent with that rule in every capture. Note also
  `replay.ts:562-564` buckets `Outcome="1"` as refused while the 27550
  capture shows it reassigning a point — do not copy that line blind; on the
  live path use the points rule. Leave replay.ts itself alone unless tests
  force the issue (it has its own counter-calibrated behaviour).
- **Gate**: the 10 request/result pairs in
  `src/__tests__/fixtures/vis/volley-live-events-27549.xml` / `-27550.xml`
  reproduce team, type label, and post-challenge score in unit tests.

## 4. Order of work, each landing green

W1 groundwork → W2 roll (M2) → W3 flight (M1) → W4 slides (M3–M5) →
W5 VS fields → W6 VIS parse → W7 docs.

W7: write the "shipped" deltas back into THIS file; fix spec/47's "There is
no challenge TYPE in any feed" paragraph (contradicted by both feeds — cite
the fixture and the XSD); note for spec/22: real `.vsr` logs answer its open
Q4 — positive `videoChallenge.response` is `"right"` (our writer
`src/lib/vsr/build.ts:429` emits `"correct"`; fixing build.ts is OPTIONAL
here, a note is required).

## 5. Verification before shipping

1. `npx vitest run` — full suite green (baseline 1045).
2. The three pixel gates (§0.2) — unmodified, green.
3. `npx tsc --noEmit`, lint.
4. e2e `tv.spec.ts` if a local run is practical; at minimum the first-frame
   assertion logic must be reasoned about and untouched.
5. Visual: `/tv/replay?demo=…` for every graphic incl. new `sideout`/`point`;
   the replay board (a real match, spec/44) must show flights on side-outs
   and rolls on points — including a roll-DOWN at its challenge overturns.
6. Reduced-motion spot check.

## 6. Shipping (board host)

House path, spec/47 precedent (promoted with `--project board` only):

1. Commit to `main` in logical spec/48 commits, push.
2. Promote: `DB_SCHEMA=public npx tsx --env-file=.env.local
   scripts/promote-prod.mts <sha> --by bernardo.franco@fivb.com --project
   board --execute`. No migrations, board project skips tenant backups.
3. Verify live: board-host `/tv/replay` renders, a `?demo=` graphic animates,
   `/m/replay` venue board unaffected.
4. Check `/admin/releases` shows the release row.

Weekend context: a read-only capture (`~/vs-captures/`) is recording live AVC
matches through Mon 06:00 UTC to pin `challenge_phase` vocabulary — W5
deliberately treats the field as opaque so nothing here depends on it.

---

## 7. Shipped — the deltas from what is written above

Written after the fact, in the order the work landed. Every constant in §1 went
in verbatim; everything below is a decision this spec did not make for us, or a
place where it was wrong.

### Motion (W1–W4)

1. **G1 paint order is set with `z-index`** (extensions 1, bug 2, motion 3),
   **not** by swapping the siblings. Both browser gates find the bug with
   `querySelector("svg")` — the FIRST one — and e2e uses `locator("svg").first()`,
   so reordering the siblings has them measure the empty extensions layer and
   report a **vacuous PASS**, which §0.2 forbids fixing by editing the gates. Same
   paint order, same DOM, same server output, less code than per-panel clips.
2. **Reveal clips are used as well**, for the outward panels only — the fallback
   §2 G1 allows. Forced: "hidden under the bar" is only true inside the bar's
   band, and the substitution's upper row sits at y 894–938 with nothing to hide
   behind. The clip is on a STATIC outer group; on the moving group it would
   travel with it.
3. **`ballHidden`/`scoreHidden` flip once at hydration**, not per flight. Both
   ride the same `useHydrated` handshake with a `false` server snapshot, so there
   is never a frame with two balls, two digits, or none. Verified pixel-identical
   against the static cells.
4. **Both substitution rows' content starts at +160 ms** — §1 M3's literal
   constant. No per-row stagger was invented.
5. **The presence reducer is clock-free**: `react-hooks/purity` rejects
   `Date.now()` during render, so the transition is adjusted during render and
   the deadline is the hook's single `setTimeout`.
6. **M3's optional 400 ms nudge on the green in-arrow was left out.** §1 gates it
   on "only if trivial"; it needed a fifth animation target inside a marked-up
   subtree.
7. One regression, found only in the browser: the odometer digits and the flying
   ball live in the motion layer, so they did not follow the bug DOWN — the score
   sat over the challenge card and survived the operator's `H`. They now carry the
   bug's own visibility with its own 180 ms fade.
8. Suite baseline was **1050 tests / 90 files** when the work started, not the
   1045/90 §2 states: five tests had landed in between.

### Feed (W5–W6)

9. **`VisChallenge` is now DECLARED as well as inferred**, and the interface says
   so. §3 asked for `category?: string` and got it — the feed's RAW word
   (`"netTouch"`, `"BlockTouch"`), never a card label; `categoryFor`
   (`lib/tv/director.ts`) does that translation, keyed lower-case so both feeds'
   spellings of one event land on one label.
10. **`challengesRequested` is 0 on a VolleyStation board**, not derived. Deleting
    the collapse (§3) leaves nothing to derive it FROM: an upheld challenge costs
    its team nothing, so a spent allowance is a refusal and the request count is
    simply absent from the payload. Zero is the honest figure and only
    `tv-signals` reads the field.
11. **`TvSignalState` gains `declaredKey`** — `side:status:category:scoreA:scoreB`.
    A declaration persists after it is answered (VIS keeps a decided challenge in
    the event stream for the rest of the set), so "is this news?" has to be "is
    this a different declaration from last time?". The score is in the key because
    a declaration carries no id; the cost is that two identical challenges by one
    team at one score would read as one, which loses a graphic rather than
    inventing one.
12. **A PENDING declaration is announced on the very first frame**, unlike the
    counters. It is present tense — the feed is saying a challenge is in flight
    NOW — and that is as true for an instance seeing its first frame as for one
    that watched the request land. A DECIDED declaration on a first frame stays
    silent, exactly like the counters.
13. **A refusal counter is read BEFORE the declaration**, and the category is
    carried across the verdict so a card already on air does not lose its label as
    it turns red or blue. Likewise the score moving under a still-declared request
    is read as the correction landing, because VolleyStation may take a poll to
    clear `challenge_team`.
14. **`ChallengeCategory` gains `"NET REACH"` through a separate
    `FEED_ONLY_CATEGORIES`**, so the operator's hotkey row stays 1–6 as they
    learned it while the card can still print a label only the feed asks for.
15. **The three VIS line faults auto-fill nothing** (`AttackLineFault`,
    `CenterLineFault`, `ServiceLineFault`). Each is arguably FOOT FAULT and none is
    certainly it; the card says UNDER REVIEW until an operator decides.
16. **What is on air on the VIS path is scoped by the SCORE, not by a timer.** VIS
    rewrites the disputed rally to the corrected score, so during a review the set
    stands at the REQUEST's points and after the ruling at the RESULT's, and the
    next rally moves it off both. `declaredChallengeOf` declares only inside that
    window; the store's machine holds the decided card for its own beat from
    there. This also means a request the feed never resolved cannot strand a
    REQUESTED card on air.
17. **`@Outcome` is recorded and read by nothing.** The points rule agrees with
    the sets' own `NbChallengeAccepted*`/`NbChallengeRefused*` tallies on **nine**
    of the ten reference pairs. The tenth is the `Outcome="1"` §3 warns about
    (27550 set 3, team A): the set counts a refusal while the result moves a point
    from B to A, 13-14 → 14-13. We follow the points, because the score the
    overlay sits beside has visibly changed. `replay.ts` was left alone, as
    instructed.
18. **`SetEvents.challenges` is required, not optional** — a set's challenges are
    part of its event stream. Nine literals in two existing test files gained
    `challenges: []`; no assertion changed.
19. `challenge_phase` is typed and deliberately never read (§3), and a test pins
    that: a board built with a phase value nobody has measured is byte-identical
    to one built without it.
20. **The replay board (spec/44) now runs its boards through the signal machine**
    as well. It always went through `buildBoardFromXml` like the live path, but
    `withTvSignals` sits one level up in `getReplayBoard` and was not called
    there — which cost nothing while no mapper could report a challenge, and the
    moment the event stream started declaring them left the replay board's card
    behaving unlike a live one: no six-second hold, and a `since` that moved on
    every poll. Found by sweeping the running board's own API, not by a test;
    there is a test now.

### Verification as shipped

- `npx vitest run`: **1125 tests / 93 files** green (from the 1050/90 baseline
  found). New in W5–W6: 24 across `vs-store`, `vs-live`, `tv-signals`,
  `tv-director` and `vis-replay`, plus `vis-challenges.test.ts` (13) for the
  ten-pair gate.
- The three pixel gates of §0.2, unmodified: `check-tv-bug.mjs` PASS,
  `check-render.py` PASS (22 checks), `validate-bug.py` exit 0.
- `npx tsc --noEmit` clean; `npx eslint src` → only the four pre-existing
  unused-var warnings in unrelated files.
- W5–W7 touch no view except one paragraph of copy in `OperatorPanel`, so the
  first-frame assertion and the SSR output are untouched by them.
- Live sweep of the running replay board's API (`?speed=4`, aimed at the
  capture's own challenge windows): the four challenges of 27550 sets 1 and 3
  come out declared with the right side, the right category and the right
  post-ruling score — `set3 3-2 SUCCESSFUL/B/BallInOut`,
  `set3 10-8 UNSUCCESSFUL/A/BlockTouch` — each held for six seconds and then
  gone. That sweep is what found delta 20.

### Still open

- `challenge_phase` vocabulary — the weekend capture (§6) is what will answer it.
- Whether a VolleyStation challenge that is upheld WITHOUT moving the score ever
  happens. It would sit on the card as a review until the next point, which is
  the same trade spec/47 documented for the counter path.
- `src/lib/vsr/build.ts:429` still emits `"correct"` where real logs say
  `"right"` — see the note added to spec/22 §Open questions 4. The fix was
  optional here and was not taken; nothing dispatches yet.

---

## 8. spec/48.1 — corrections for the four verified minors (APPROVED 2026-08-22)

The adversarial verify pass of the first ship recorded four cosmetic minors.
All four get fixed; nothing else moves. Every §0 contract and every §1
constant still holds verbatim.

### F1 · Back-to-back substitutions on the same side must not cut

Today `direct()` clears an expired sub and announces the next pending one in
the SAME tick (paired subs are a supported case), so `graphics.substitution`
goes sub1→sub2 with no null frame; `usePresence` never sees a leave, the
MotionGroup key is only `sub-${hand}`, and the second pair's shirts/names/
arrows CUT onto the already-extended plate.

Fix — a content swap, not a full remount (the plate retracting and
re-emerging for a paired sub would be busier than the cut):

- When the substitution's identity (`subKey`, `director.ts:145`) changes while
  the graphic is up on the SAME hand: the plate stays extended; the old
  content group fades out **260 ms** (the standard content exit), then the new
  content group runs the standard entry — drift 26 px + fade, **420 ms**
  `cubic-bezier(.2,.7,.25,1)` — with no fresh 160 ms stagger (the plate is
  already there).
- Hand changes are already correct (presence exits one side, enters the
  other) — do not disturb that path, nor the single-sub two-step, nor the
  director (it stays pure; this is view-side keying/presence only).
- Rehearsal: `?demo=subswap` plays a pair back-to-back on one side.
- Tests: a unit test on the view-side keying/presence deciding "content swap
  vs full reveal vs hand switch"; a browser probe asserting the second sub
  ANIMATES (old content leaves, new enters) rather than cutting.

### F2 · MotionGroup re-entry mid-exit resumes from where it is

On leaving→false during an exit, the group currently cancels the exit and
re-enters FROM HIDDEN — a visible snap. Fix: capture the current transform
(commitStyles/getComputedStyle before cancelling) and animate from that
position to shown; standard enter easing, duration may be the standard one.
Make the comment at `BugMotion.tsx:265-266` true instead of aspirational.
Test: unit or probe covering re-entry at ~40% of the exit window.

### F3 · The motion-layer visibility fade gates on reduced motion

The wrapper in `TvViewer` (~lines 423-429) fades the odometer digits and the
flying ball with a raw `transition: opacity 180ms linear`. Behind
`prefersReducedMotion()` it must be `transition: none` (states jump).
`ScoreBug`'s own pre-existing 180 ms fade (`ScoreBug.tsx:71`) is spec/47
baseline and stays as it is.

### F4 · Reveal clip ids become collision-proof

`<clipPath id="tv-reveal-${reveal}">` (`BugMotion.tsx:240`) can be minted
twice when two panels dock to the same hand. Make the id unique per panel
(include the graphic kind or the group's key) and keep every reference in
step. Probe: no duplicate ids in any demo state, including simultaneous
key-moment + substitution on one hand.

### Verification and shipping

Suite green (baseline now **1125/93**); the three §0.2 pixel gates
unmodified; `npx tsc --noEmit`; e2e `tv.spec.ts` 6/6; browser probes: F1
swap animates, F2 no snap, reduced-motion → zero running animations, zero
duplicate DOM ids everywhere, the 12-rapid-cycles leak check still clean.
Ship per §6 (push main → promote `--project board` → live checks), commits
"fix(tv): … (spec/48.1)".
