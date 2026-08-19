# spec/40 — Changing a board's background without a commit

Shipped 2026-08-19. Migration 0024, one nullable column.

## Why

Board artwork lived in the repo: `public/board-bg/avc-*.png` for the built-in
default, `public/board-bg/{competitionId}.jpg` for the per-competition
convention. Both mean a commit, a push and a rebuild to change a picture — and
the people who decide what a venue screen looks like are not the people holding
a git remote.

The one thing that already worked without a commit was `?bg=`, and it still
does. But it is per LINK: it changes one screen, and anyone opening a bare link
still gets the committed default.

## Precedence

    ?bg=<https url | /path>        one screen — a rehearsal, a sponsor night
    branding.boardBgUrl            the competition's own, set in the console
    /board-bg/{competitionId}.jpg  the file convention, unchanged
    the built-in artwork           what the masters ship with

The first two need no commit, which is the point. A 404 on any of them simply
reveals the layer beneath, because CSS falls through a background image it
cannot load.

## Where it is set

Competition → **Scoreboard** tab → *Board background artwork*. Takes an
`https://` URL or a same-origin path such as `/board-bg/avc-cup-pattern.jpg`.
Empty means "use the built-in artwork". Saved changes reach a board within a
minute (the branding read is cached with a 60 s TTL and the save revalidates
its tag, so in practice it is the next reload).

`isBoardBackground()` in `src/lib/board-theme.ts` is deliberately shared by the
form and the board: a value the form accepted and the board then refused would
look like the setting silently not working. https and same-origin paths only —
an `http` source is a mixed-content block on a venue screen, and nothing else is
something to paint.

## The default is back to the AVC swirl

spec/39 replaced the built-in artwork with the AVC Cup pattern. With the field
in place that no longer has to be a code change, so the committed default is the
masters' own extracted artwork again. The pattern is kept as an asset —
`/board-bg/avc-cup-pattern.jpg` — so a competition can be pointed at it from the
console without hosting it anywhere.

## Also in this change

The `SET n` line under the mark on the set-statistics screen (added in spec/37)
is removed at the user's request. The mark sits alone above the score plates,
as the master draws it.
