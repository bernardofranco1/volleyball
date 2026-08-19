# spec/42 — Rotation: what the feed is, what we do about it, and the libero

Shipped 2026-08-19. Migration 0025 (one table, platform-level, no tenant data).

## What was reported

"A player served, they won the point, their team rotated, and he disappeared as
the server." A team that wins a rally while serving does not rotate, so that
should be impossible.

## What is actually true, measured

Cross-checking the feed's own `LineUp` per rally against the side-outs the
running score implies, over four matches:

| match | clean transitions | feed agrees | should have rotated, did not | rotated when it should not |
| --- | --- | --- | --- | --- |
| 27547 | 266 | 201 | 0 | 0 |
| 27549 | 274 | 205 | 0 | 0 |
| 26959 | 244 | 188 | 0 | 0 |
| 27550 | 200 | 141 | **9** | **1** |

So the model is right — the lineup attached to rally N *is* the rotation for
rally N, and adding one rotation when the last rally was a side-out is correct.
Three separate things produced the symptom:

**1. The feed rewrites a rally's lineup after the fact.** Captured live: the
same score and the same rally count returned three different position-1 players
inside forty seconds. **Our own spec/37 change surfaced this** — at the previous
twenty-second cadence the feed had always settled before anyone looked; at one
second the board renders every intermediate state.

**2. It briefly seats a libero in the serving position.** 0–2.2% of rallies
across the four matches. A libero may not serve (FIVB 19.3.2.1), so that reading
is always wrong.

**3. Match 27550's feed is genuinely imperfect** — nine rotations it never
applied. Upstream, not ours.

Separately: **liberos were never missing from the rotation.** A libero is among
the six in 83–86% of lineups, correctly placed and correctly flagged. They were
simply drawn identically to everyone else.

## What was built

**A stabiliser** (`lineup-stability.ts`). A lineup change is adopted when a new
rally has been played, or when the same six comes back twice running. One change
is never adopted: a libero in the serving position. Cost is at most one poll —
about a second — and only when the feed contradicts itself; the score, the sets
and the serving side are untouched and keep updating immediately.

**The ball is never painted on a libero.** Belt and braces behind the
stabiliser, in the board itself.

**The first rally of a set is now judged correctly.** While a set has no
rallies, `Set@NoServingTeam` *is* the first server — one rally later it already
means "whoever won that rally". The store notes it in that moment, so the
opening point of a set can be recognised as a side-out. Previously the board
showed the outgoing rotation for a whole rally whenever the receiving side won
the first point, which is about half of all sets.

**An independent rotation model** (`rotation.ts`), derived from the rules and
the running score, never from the feed's shape. It walks a set forward one
rally at a time rather than predicting each rally from the starting six: a
substitution or a libero coming on changes WHO is on court, not where anybody
is standing, and an absolute model desynchronises for the rest of the set the
moment either happens. The first cut did exactly that and reported ninety
divergences in a match with nine. So a change of players reseeds the model from
the feed and is never judged; what is recorded is the same six standing in a
different order. Where the first server was not
observed — an instance that came up mid-set — it is recovered by running both
hypotheses and keeping whichever predicts more of the feed's own lineups.

**A shadow log** (`rotation-audit.ts`, table `vis_rotation_log`). The model runs
beside the feed on every poll and records where they part company. **It is
surfaced nowhere**: the boards keep taking VIS at its word, because overriding
the source of record would put six names on an arena screen that VIS disagrees
with, and the divergence is real but rare. Two properties it must have, since it
runs inside a live board's poll loop at one request a second: it swallows every
failure, and it writes at most one row per (match, set, rally, team, kind) —
an in-memory set stops the repeat within an instance, a unique index stops it
across instances.

Read it back with:

    DB_SCHEMA=public npx tsx --env-file=.env.local scripts/rotation-log.ts
    DB_SCHEMA=public npx tsx --env-file=.env.local scripts/rotation-log.ts --match 27550 --full

**The libero is now visible**: their jersey plate is FILLED, the number knocked
out of it, instead of outlined. The master already distinguishes filled plates
from outlined ones, so this adds no new device, and it reads from the back of a
hall where a small letter would not.

## Deliberately not done

Overriding the feed's rotation with the model's. The evidence for doing it is
one match in four, and the cost of being wrong is a national team's six shown in
the wrong order on an arena screen. Revisit once the log has a week behind it.
