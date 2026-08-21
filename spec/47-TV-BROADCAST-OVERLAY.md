# spec/47 — TV broadcast graphics over a live stream

**Shipped 2026-08-21.** Surfaces: `/tv` (launcher) and `/tv/{matchNo}` (output)
on the public board host (`fivb-live-scoreboards.vercel.app`), plus `/tv/mock`
and `/tv/replay` for rehearsal. Unlinked from everywhere and `noindex`.

## The problem

FIVB has an official broadcast graphics package for the AVC Continental
Championships 2026 — a 46-page specification, After Effects projects, licensed
fonts, flag assets — and no way to put it over a stream without a production
truck. The platform already knows the live score of every match in the
competition, to the rally, from two independent feeds. What it could not do was
draw the score on the picture.

The ask was narrow and strict: a page where an operator pastes a stream link and
sees the footage with the official scoreboard, substitution and video-challenge
graphics on top, rendered **exactly** as the guidelines specify, with nothing in
the app pointing at it.

## The decision

`/tv/{matchNo}?s={base64url stream}&delay={seconds}` renders the stream in a
`<video>` and the graphics in an SVG registered to the picture. The bar's own
artwork is **lifted from the Illustrator master**, not redrawn; the type is
positioned by measured baseline; and everything the director decides runs on a
**delayed** copy of the feed so the graphics land with the footage rather than
with the hall.

Invisible by the same mechanism `/m/{matchNo}` already uses (spec/38): the URL
is the credential, nothing links to it, both routes are `noindex`. It exposes
nothing a public board does not.

## Two masters, and which one wins

The package describes the score bug twice and the two do not agree. This
mattered more than anything else in the build, so it is written down.

| | `04_Scoreboard.ai` | the rendered graphic |
|---|---|---|
| what it is | a full-frame mock-up (it embeds a photograph) | the AE comp, as it appears on guidelines p.23 and in every reference frame, embedded there at native 1920×1080 |
| bar height | 61.25 px | **60.00 px** |
| mirror axis | x 960.76 | **x 960.00** |
| flags | placeholders — Thailand's red is a generic (249,19,25) against the official `#A51931`, its Korean flag carries a 1.37 ratio against the real 1.4988 | the real supplied assets |
| country codes | 6 px further out | — |

**The render wins.** It is what goes to air; `LT_Bar.ai`, the lower-third
chassis the rest of the package is built from, is authored 60 pt tall, so two
independent sources say 60; and the code positions follow from the real flags
being ~11 px wider than the placeholder.

The mock-up is still the only source for the **artwork** — the pinstripe field,
the red SETS blocks, the roundel — so that is cut from it and fitted to the
60 px band, vertically only. Scaling it uniformly would move the red blocks off
the x positions the render agrees with to a tenth of a pixel. The cost is that
the artwork's 18° slants become 18.4°: 0.4 px of horizontal run across the whole
bar.

## How the artwork was got out

The `.ai` files are PDF-compatible **and Illustrator preserves its layer stack as
PDF optional-content groups**. So every element of the bar can be rendered on its
own — "Blue Bar", "Left Pattern", "THA", "Left Block", "Logo" — which is what
makes the geometry below measured rather than estimated: a text layer alone has
an exact ink box, and that box is the anchor the live text has to land on.

Tools, all re-runnable, in `spec/reference/avc-tv-gfx/`:

| | |
|---|---|
| `layers.py` | list / isolate / measure a master's layers (`bbox --each --dpi 288`) |
| `extract-assets.py` | cut the bar's artwork into `public/tv-gfx/` |
| `measure-extensions.py` | read the extension graphics off the reference frames |
| `validate-bug.py` | rebuild the bar from the artwork and diff it against the artboard — an **asset-integrity** check |
| `check-render.py` + `scripts/check-tv-bug.mjs` | render `/tv` in a real browser and measure what it drew — the **component** gate |
| `frames/` | the eight reference stills, extracted from the guidelines at native 1920×1080 |

Two measurement traps cost real time and are worth knowing:

1. **Antialiasing inflates a bounding box by 1–2 px.** Taking "any alpha above
   zero" as ink read the country codes as 50 px type. Rendering at 4× and
   thresholding at 50 % coverage reads them as 48 px, which is what the
   guidelines say. Every figure below is thresholded.
2. **The slant is tan 18° (0.3249), not 1/3.** 1/3 is wrong by half a pixel of
   run across the bar — borderline, and worth authoring correctly.

## The score bug, measured

Design px in the 1920×1080 frame, y from the top. In `src/lib/tv/bug-geometry.ts`.

| element | x | y |
|---|---|---|
| bar | — | 940.00 → 1000.00 (h 60) |
| flag outer edges (vertical) | 525.00 · 1395.00 | full band |
| red SETS block L, left edge | 755.81 @top → 771.20 @bottom | full band |
| red SETS block R, right edge | 1164.25 @top → 1148.80 @bottom | full band |
| AVC roundel | 937 → 983 | 946 → 990 |
| serve ball (w 24.5) | 846.50 · 1049.00 | centred in the band |
| flag accent (blue sliver's left edge) | 607.60 · 1288.40 | full band |

Type, from measured ink against the true font ratios (Ancorli caps 0.700 em,
lining figures 0.718; Encode Sans Expanded 0.740 / 0.759) — every one confirmed
against the guidelines' own specification table to within half a pixel:

| element | font | size | ink | cell centre L / R | baseline |
|---|---|---|---|---|---|
| country code | Ancorli | 48 px | cap 34.00 | 690.52 / 1229.43 | 986.75 |
| game score | Ancorli | 48 px | digit 34.00 | 899.66 / 1019.66 | 986.80 |
| set score | Encode Sans SemiBold | 32 px | digit 24.00 | 798.91 / 1120.91 | 972.85 |
| "SETS" | Encode Sans Bold | 13 px | cap 10.00 | 800.30 / 1120.30 | 989.80 |

Every panel edge slants 0.3249 and steps back 4.00 px at one notch. None of it
is drawn in code.

### Why SVG rather than positioned divs

The venue boards in `src/components/scoreboard` place type with divs and correct
the optical centring with an empirical nudge constant. This graphic places type
by **baseline**, because that is how the master does, and SVG's `y` on a `<text>`
*is* the baseline — exact, and identical in every browser. There is no nudge
constant in this feature.

### The flag treatment

The package supplies ready-made flag assets at 60 px (guidelines p.12, embedded
there at native 106×60 for a 3:2 flag), and measuring them settled two things a
guess would have got wrong:

- The flag is **neither stretched nor sheared** to fill the parallelogram.
  Japan's disc comes out 37×36 with no centre drift top to bottom, and China's
  large star sits at 14.5 — one sixth of the natural 90 px width at this height,
  not of the 100 px the clip reaches.
- Which means **the clip reaches past a 3:2 flag's own width** at the bottom, by
  about 10 px, and ten of the seventeen flags in this field are 3:2. Something
  has to fill that corner. `ScoreBug` draws the flag twice inside the clip — once
  scaled to fit (the flag) and once scaled to cover (which fills the corner with
  the flag's own far edge) — which is what the supplied assets do.

## The extensions

Substitutions (item 18), the four video-challenge states (item 21), time-out
(item 22) and the key-moment strap (item 40). Measured off the reference frames
in `src/lib/tv/extension-geometry.ts`, and **drawn rather than lifted** — the
package ships no artwork for any of them, so this is forced.

**One chassis, four graphics**, which is a finding rather than a simplification:
the substitution block, the yellow-card block and all five challenge-card
examples put their separator rule on the same row (y 938.5, measured
independently in five frames), and the challenge tab and the time-out tab trace
to the same sub-pixel outline.

| band | y | h | slant | notch |
|---|---|---|---|---|
| upper | 894 | 44 | 0.3049 | none |
| separator rule (`#3C81BC`) | 938 | 2 | — | — |
| lower | 940 | 60 | 0.3247 | −3.38 at y 969.5 |
| tab | 904 | 34 | 0.3047 | none |

Two things these do that the bug does not: the slant **above** the bar is
genuinely shallower than the slant inside it (measured on four independent edges,
max residual 0.13 px), and the panels are **~90 % opaque** where the bug is solid
— solved from the court showing through, (25,25,63) observed over a (255,150,148)
court against a (0,11,53) source giving 1−α = 0.098/0.101/0.105 across the three
channels.

The challenge **card** is the one graphic that is centred rather than docked to a
flag edge, which is how p.34 draws it. Docking it ran "CHALLENGE UNSUCCESSFUL"
clean off the left of the frame at 33 px — which is exactly what the first
version did.

## The delay, which is the part that makes it usable

HLS puts the picture 10–30 s behind the hall; the feed is 1–3 s behind it.
Rendered naively the score ticks over while the rally that scored it is still
being played on screen, which reads as a broken graphic rather than as a delay.

So `useDelayedBoard` keeps every frame with the time it arrived and serves the
newest one at or before `now − delay`. The operator dials it in once by watching
a point land (`[` and `]`, half-second steps), and everything downstream — score,
substitutions, challenge card — is consistent because it all comes off the same
delayed frame. The value is remembered per stream **host**, since it is a
property of the encoder rather than of the match.

Polling deliberately does **not** pause on a hidden tab, which is the one thing
it does differently from `VisBoardDisplay`: a venue board nobody is looking at
can stop, a TV output feeding a programme cannot.

## Feed extensions

`VisBoardData` gained two optional fields. The venue boards ignore both.

- **`recentSubstitutions`** — the current set's substitutions with shirt numbers,
  names and the score they happened at. On VIS these are real events: the store
  already parses the set's event stream for serve succession (spec/43), so the
  parsed result is now handed to `mapVolleyLive` rather than parsed a second time
  — doing it twice per poll cost enough on a long set to time a replay test out.
  On VolleyStation there are no events, only the six on court, so the store
  infers a substitution from the six changing.
- **`challenge`** — a challenge in flight, derived from counter deltas across
  polls in `src/lib/vis-live/tv-signals.ts`. It needs two frames, so it is filled
  in by the store and not by a mapper.

The challenge state machine: `requested++` → REQUESTED → (4 s) REVIEW;
`refused++` → UNSUCCESSFUL; a score change with no refusal → SUCCESSFUL; then
cleared after 6 s. "Score change" is the only signal for success there is — a
team that wins its challenge **keeps** the right to another, so
`NbChallengeRefused` does not move and nothing in the feed says "upheld".

It stays silent on a cold start and across a set boundary, both of which move the
counters for reasons that are not a challenge.

~~**There is no challenge TYPE in any feed**, and no way to add one: VIS publishes
`NbChallengeRequestedTeam*` and `NbChallengeRefusedTeam*` and nothing else.~~

**Corrected 2026-08-21 (spec/48 W5/W6) — this was wrong, and it was wrong about
both feeds.** What was true is narrower: the *board-level counters* carry no type.
The payloads do:

- **VolleyStation** puts it on the match row itself — `challenge_team`
  ("home"/"away"), `challenge_reason` ("netTouch"), `challenge_time`,
  `challenge_phase`, `challenge_bookmarks`. A populated capture is committed as
  fixture match `2504866` (`src/__tests__/fixtures/vs/matches.json`), and
  `challenge_team` is a better "in flight" signal than any counter delta: it is a
  snapshot of the present and it names the team outright.
- **VIS** publishes `<ChallengeRequest NoTeam Type RequestedFrom PointsTeamA
  PointsTeamB>` and `<ChallengeResult Outcome PointsTeamA PointsTeamB>` inside the
  event stream the live path was already fetching — `@Type` is an XSD enum of
  eight (1 AntennaTouch, 2 AttackLineFault, 3 BallInOut, 4 BlockTouch,
  5 CenterLineFault, 6 NetTouch, 7 ServiceLineFault, 8 FloorTouch), of which 3, 4
  and 6 appear in `volley-live-events-27549.xml` / `-27550.xml`. Ten pairs are
  committed there; `replay.ts` was reading them all along.

So the category now auto-fills from the feed's own word, and hotkeys 1–6 override
it rather than being the only source — a field populated on one event may be
empty on the next, and the operator can see the replay. The whole challenge
graphic remains hand-drivable, which is still the fallback on any event whose
scorers leave the fields empty.

## Three bugs the gates caught

Worth recording, because each was invisible to the layer above it.

1. **`preserveAspectRatio`.** SVG `<image>` defaults to `xMidYMid meet`, which
   preserves the ratio and centres the result — so the plate, cut 61.25 px tall
   and drawn into a 60 px band, was silently scaled by 0.98 in *both* axes and
   centred, putting the red SETS blocks 4.25 px right of where they were
   measured. Found by `check-render.py`, invisible to the eye and to the Python
   validator.
2. **A client constant in a Server Component.** `MAX_DELAY_S` lived in
   `useDelayedBoard.ts`, which carries `"use client"`, and the output page
   imported it to clamp `?delay=`. Importing a plain value out of a client module
   into a Server Component gives you a **client reference**, and `Math.min` of
   one is `NaN`. The clamp returned NaN, the delayed board then resolved to the
   *first* frame in its buffer for the rest of the match, and the only visible
   symptom was a React warning about a NaN slider value one component away. It
   now lives in `src/lib/tv/delay.ts`, which has no directive, and
   `tv-delay.test.ts` asserts the constants are numbers.
3. **A 404 flag.** `tvFlagSrc` returned a path for any three-letter code, and the
   replay board is a Qatar v Venezuela fixture — from outside this competition.
   An SVG `<image>` that 404s leaves a hole in the bar, and there is no `onError`
   to swap it out. The generated `TV_FLAG_CODES` set now decides, falling back to
   `public/flags`.

## Rehearsal

`?demo=sub|challenge|review|success|fail|timeout|keymoment` forces one graphic
on. Not a toy: substitutions and challenges are rare and unschedulable, and
without it the first time anyone sees the substitution lower third is during a
live match — which is also the first chance to notice that a name overflows its
box. `/tv/replay` (spec/44) supplies a real match on a permanent loop for setting
the delay and learning the keys.

## Hotkeys

`[` `]` delay ∓0.5 s · `H` hide/show all · `F` fullscreen · `C` arm a challenge ·
`A`/`B` requesting team · `R` review · `S`/`U` successful/unsuccessful · `1`–`6`
category · `T` time-out · `Esc` clear. The operator panel appears only for a
pointer, which is what keeps it off air: a vision mixer's browser source has no
pointer.

## RTMP and SRT

A browser cannot play either, and converting one needs a process holding a socket
open, which Vercel does not do. Both resolve to a refusal that names the stream
and says why. Set `NEXT_PUBLIC_TV_RELAY_HLS_BASE` to a relay (MediaMTX; config in
the previous revision of this file) and they map to `{base}/{name}/index.m3u8`.
The VolleyStation links — the primary case — need none of this: the Ant Media
player URL maps to a manifest that answers with
`access-control-allow-origin: *`, so the browser fetches it with no proxy of
ours in the path.

## Tests

`tv-stream-url` (19) · `tv-derive` (14) · `tv-signals` (13) · `tv-director` (17)
· `tv-delay` (4), plus `/tv` cases in `board-host` and `multitenancy`. Suite
1045 tests, 90 files. `e2e/tv.spec.ts` covers the route, the first painted
frame, every rehearsal graphic, `noindex`, and that an unknown match number
404s rather than relaying arbitrary VIS data.

## Open questions

1. **Substitution row order.** The reference frame has a filled green downward
   triangle on the upper row and a hollow upward one on the lower; p.32 says only
   "identify the outgoing and incoming players" and never states which is which.
   The AE project ships the pair twice — `LT Sub Arrow Out-In` and
   `LT Sub Arrow In-Out` — so the order is a choice the graphic supports either
   way. This reads green as arriving, which is what every other sport's graphics
   do. **Worth confirming.**
2. **The position code.** The reference shows a role code ("OH", "OP") beside
   each substituted player and neither feed publishes one. The chip is left out
   rather than filled with the court position number, which is a different thing
   wearing the same shape.
3. **Between sets and before the first whistle.** The guidelines call the bug
   permanent and show no set-break state. It currently stays up with the last
   score; the operator hides it with `H` when the director cuts to studio.
4. **The key-moment size.** The rendered strap's ink is 31.00 px tall, which at
   Ancorli's 0.700 caps is 44 px — the guidelines say 42. It is the only string
   in the package whose measured size misses its stated size by more than a
   pixel, and the render was followed.
5. **Challenge counters on VolleyStation.** Not yet observed moving on a live
   VS-sourced match. If they never do, challenge graphics there are
   operator-driven, which is already the supported path.
