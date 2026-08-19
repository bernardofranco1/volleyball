# spec/37 — Keyline, the missing mark, counting down, and one-second polling

Shipped 2026-08-19, on top of spec/36. No schema change, no VIS contract change.

## 1. A white keyline on every flag

3 design px of `theme.ink`, drawn INSIDE the measured box (`box-sizing:
border-box`) so nothing moves. Without it a flag whose edge band is dark or
white dissolves into the artwork and reads as a broken image: the AVC navy is
close enough to black to swallow Egypt's bottom band whole, and the USA's white
stripes do the same at the top. Reported from a live board (match 26959).

## 2. The AVC mark was never in the code

The mark sits on its own layer in the SET master, so the background extracted
for spec/35 does not carry it and the stats screen rendered with a hole where it
belongs. `public/board-art/avc-mark.png` is cut from the master at 4x with its
alpha keyed against the bare background, so it lifts off the artwork with no
seam. Measured box x 914 → 1006, y 49 → 137. A competition's own `logoUrl`
still overrides it.

## 3. The set is named on the stats screen

`SET n` in the band between the mark and the score plates, `FINAL` once the
match is over — the wording the scoreboard screen already uses, so the two agree
when the board rotates between them at a break.

## 4. The interruption rows count DOWN

They showed what a team had spent. They now show what it has **left this set**,
full at 0-0. A venue board is read to answer "can they still stop the game".

| Row | VIS field | Shown | Why that field |
| --- | --- | --- | --- |
| Time-outs | `NbTimeoutTeam*` | 2 − taken | FIVB 15.1, deciding set included |
| Substitutions | `NbRemainingSubstitutionTeam*` | the feed's own figure, verbatim | VIS publishes remaining directly and it is authoritative — a captured AVC set reports 4 used with 4 still to come, so that event does not run to six and clamping to 6 would under-report |
| Challenges | `NbChallengeRefusedTeam*` | 2 − refused | **not** `NbChallengeRequested`: a team that wins its challenge keeps the right, so only a refused one costs an allowance |

The challenge row is the one that would have been quietly wrong. The
`volley-live-board-finished` fixture has Türkiye requesting two challenges,
winning one and losing one — counting requests would have shown them out while
they still had one in hand.

The U-shape rail follows the same rule, and its time-out row is corrected from
one pip to two: it was drawing the BEACH allowance on an indoor board.

## 5. As live as VIS will go

Before: a fixed 10 s browser timer, behind a 5 s CDN window, behind a store TTL
that honoured the feed's 20 s advisory `PollDelay` — about 35 s worst case from
VIS having a point to a screen showing it.

`src/lib/vis-live/cadence.ts` is now the single rule, read by all three layers
so none of them adds staleness on top of the others — the browser's timer, the
store's TTL and the CDN's `s-maxage`. The server tells the browser the interval
in the payload (`pollMs`).

| State | Interval |
| --- | --- |
| A set being played | **1 s** |
| Set break | 5 s |
| Before the first whistle | 10 s |
| After the match | 30 s |
| No board open | nothing at all |

- **One second during play is a deliberate, authorised override** of the feed's
  own `PollDelay` (FIVB confirmed 1 req/s per match is not a problem). Every
  other state honours `PollDelay` as a floor.
- **Nothing polls unless a board is open.** No cron, no warmer, no background
  refresh: the store is filled by a request from a screen somebody is looking
  at, and goes cold when the last one closes.
- **The cadence bounds UPSTREAM traffic, not viewer traffic.** Concurrent
  viewers of one match share a single in-flight call and a single cached
  payload, so a venue with eight screens costs VIS what one screen costs.
- Polling stops while the tab is hidden and resumes with an immediate read; a
  failing endpoint backs off by doubling to 30 s rather than being hammered.
- At 1 read/s most payloads are byte-identical, so the client compares before
  setting state and an idle board does not re-render 60 times a minute.

## Still open

`FlagFit` carries five rules — `area` (shipped), `contain`, `height`, `fill`
(crop to a uniform 3:2) and `stretch` (scale to a uniform 3:2). The last two
exist because normalising every flag to the single most common ratio is under
consideration; the choice is the user's and nothing selects them yet. Validation
artifact: https://claude.ai/code/artifact/a6460373-e3aa-42a5-844e-52a3a4ef3120

Also still open from spec/36: the `OMA` flag asset is 1.76:1 where Oman's
official flag is 2:1.
