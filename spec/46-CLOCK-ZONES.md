# spec/46 — Three clocks on the fixture list

**Shipped 2026-08-21.** Surfaces: `/c/{competitionId}` on the public board host
(`fivb-live-scoreboards.vercel.app`) and the in-app twin at
`/t/{slug}/scoreboard/vis/{competitionId}`.

## The problem

The day index showed one time per fixture: `TimeLocal` as VIS states it, which
is the venue's wall clock. Three different audiences read that page at once —
staff inside the arena, a federation office a continent away, and FIVB in
Lausanne — and a bare `18:30` serves exactly one of them, with nothing on the
page saying which.

## The decision

Three buttons, not a time-zone picker: **Local time** (default) · **Event
location time** · **GMT**. A 400-entry `<select>` is the wrong instrument —
nobody reading a fixture list wants to *choose* a zone, they want the one they
are standing in, the one the match is played in, or the neutral one everyone
can convert from.

## Why no time-zone database is involved

VIS states **both halves** of every kick-off, and asking for both is the whole
trick:

| field | value for match 28803 | meaning |
| --- | --- | --- |
| `DateTimeLocal` | `2026-08-21T10:00:00` | venue wall clock, no offset |
| `DateTimeUtc` | `2026-08-21T02:00:00Z` | the same instant |

So:

- **Event location time** is not a conversion — it is the string VIS sent. No
  zone database can disagree with what the arena clock reads.
- **GMT** is not a conversion either — it is the other string VIS sent.
- **Local time** is one `Intl` format of the UTC instant in the browser's own
  zone.
- The venue's **offset** (`GMT+8`) is the difference between the pair, so it is
  automatically right across a DST boundary and right for a half-hour zone,
  with nothing to keep in sync with a tzdata release.

Verified against all five linked tournaments on 2026-08-21: 318/318 fixtures
carry both halves. `mapVolleyMatchList` still stitches `DateLocal` + `TimeLocal`
when `DateTimeLocal` is absent, and a row with no UTC instant degrades to venue
time **labelled as such** rather than showing a wrong hour.

## Per match, never per competition

The `competitions.timezone` column is deliberately *not* used here. VIS
tournament 1736 spans ten cities and eight distinct offsets, and tournament
1671 is filed in our own records under Doha while VIS plays it in Chile. The
offset is a property of the fixture, read off the fixture. When a competition
turns out to have more than one offset, the caption drops the single `(GMT+8)`
label and each row carries its own instead.

## Why the list is a client component

The choice reshapes the list, not just its labels: a 10:00 Tianjin fixture is
the *previous evening* in New York, so the day headings themselves move. The
New York rendering of the AVC schedule has eleven day groups where the venue
rendering has ten. Grouping on the server and re-labelling in the browser would
file rows under the wrong heading for every reader west of the venue.

`MatchDayList` (board host) and `VisIndexDayList` (in-app) therefore own
grouping, sorting and formatting, and `src/lib/vis-live/match-times.ts` holds
all of it as pure functions so the day boundaries are pinned by tests rather
than by a screenshot.

## Two indexes, one clock

`ClockZone.tsx` holds the machinery both pages share — the storage key, the
`useClockZone()` hook, the `ClockZoneToggle` — and **only** the machinery. The
row markup stays per page: the board host lists team codes with a copy button
per layout, the console lists full team names in a fixed time column, and
forcing one layout on both would have been a redesign dressed up as reuse. What
must never diverge is the arithmetic, the storage key and the hydration
strategy, and those are in one file.

One storage key (`fivb.board.clockZone`) for both, so a choice made on the
console index is still in force on the board host, and vice versa.

## Language

Every string is in the catalogue under `clock.*`, in all five locales. The list
components call `useT()` directly rather than being handed strings by their
server parent: functions cannot cross the RSC boundary (spec/27 trap 1), and
`useT()` falls back to the English catalogue when no `LocaleProvider` is
mounted — which is exactly the board host's situation, since it has no tenant
layout above it.

Day headings are formatted in the reader's locale, and `dateLocale()` maps `en`
to `en-GB`: bare `en` gives month-first order, which is not how a fixture list
is read at a FIVB event. The offsets and city names inside the captions are
interpolated rather than translated — `Tianjin (GMT+8)` reads the same in every
language.

The in-app heading lost its `visBoard.localDate` "(local)" suffix: with the
zone now stated in the caption above, a fixed "(local)" on every heading was
the one thing on the page that could be wrong.

## Hydration

The server can render exactly one of the three choices — venue time — because
the browser's zone is not knowable there. Both client-only facts (the stored
preference and the browser zone) are read through **`useSyncExternalStore`**
with a server snapshot of `venue`/`UTC`, so React swaps in the real values
after hydration with no mismatch. An effect calling `setState` would have done
the same thing and is banned by this repo's lint rules; reading `Date.now()`
during render is banned too, which is why the reader's offset label is computed
at the *first fixture's* instant rather than at "now" — the offset the schedule
will actually be in.

The choice persists in `localStorage` under `fivb.board.clockZone` and follows
across tabs via the `storage` event, so a venue laptop with four tabs open
agrees with itself.

## QA

`src/__tests__/lib/match-times.test.ts` pins the mapping, the offset
arithmetic, the midnight `00:00`-not-`24:00` case, the fallback path, and the
day-boundary reshuffle. Driven in a real browser against `next start`, both
pages, across four zones (Europe/Zurich, America/New_York, Asia/Kolkata,
America/Sao_Paulo) and all five locales: correct times and day groups in each,
no console errors, the choice survives a reload and carries between the two
indexes.

Also checked against tournament 1671, whose three Chilean venues share one
offset — the caption drops to the bare `GMT-4` when there is no single city to
name.

Trap met twice while doing this: `pkill -f next…` does not match how this
checkout's server appears in `ps` (`npm exec next start` / `next-server`), so
the old process survived, the new one died on `EADDRINUSE`, and a stale server
served chunk names the rebuilt `.next` no longer had — which presents as
"hydration never ran", not as "wrong server". Kill by pid and confirm.

## Bug fixed same day: unknown is not UTC

Reported from Switzerland within the hour: the Local-time button read **"Local
time GMT"**. The server render was the culprit — it cannot know the reader's
zone, used `"UTC"` as the placeholder, and the label code then treated the
placeholder as a fact and printed `GMT`. Every reader's first paint claimed
Greenwich.

The type now carries the distinction: `readerZone` is `string | null`, and
`null` means *not known yet*, not UTC.

- `readerOffsetLabel(null, …)` → `null`, so the button shows no offset until the
  browser has answered.
- `matchClock(m, "local", null)` falls back to venue time **flagged**, the same
  way a fixture with no UTC instant does — never a guessed hour.
- With scripts blocked the page now stays honestly on venue time end to end:
  `Local time` (no offset) · `Event location time GMT+8` (pressed) · caption
  "Times shown at the venue: Tianjin (GMT+8)."

The report also exposed a second, real case worth naming rather than hiding: a
device that genuinely reports UTC — its zone unset, or a browser deliberately
concealing it (Tor, Firefox `privacy.resistFingerprinting`, Brave's shield).
"Local time" and "GMT" then show identical numbers and the page looks broken.
`isPlaceholderZone()` detects it **by zone name, never by a zero offset** — a
reader in `Europe/London` in February is legitimately on GMT — and the caption
says so outright: "Your device reports UTC as its time zone, so these are the
same as the GMT view."

## Network fallback: when the device says nothing, ask the connection

Follow-up to the same report. "Local time" reads the device's zone via
`Intl.DateTimeFormat().resolvedOptions().timeZone` — it was never server time —
but a device with its zone unset, or a browser concealing it, reports UTC and
gets Greenwich times under an honest caption. Honest, yet still not local.

Vercel stamps every request with **`x-vercel-ip-timezone`**, the zone estimated
from the connection. `resolveReaderZone(deviceZone, networkZone)` arbitrates:

- the device's zone wins whenever it is real — it is the clock the reader
  lives by, and a VPN endpoint must not override a deliberate setting;
- the network estimate steps in **only** when the device reports a placeholder
  (`isPlaceholderZone`), and the caption then says outright that the zone was
  estimated from the network — an estimate presented as a fact is how a reader
  on a VPN misses a match;
- the header is validated with `validZoneOrNull` before use — it is input, and
  an unformattable zone name would throw inside `Intl` at render time;
- with neither source, the honest placeholder caption from the first fix stays.

The pages read the header (`force-dynamic`, so per-request is already the
deal) and pass it as a prop; being in the RSC payload it is identical on the
server render and at hydration, so the SSR frame's Local-time button now shows
the estimated offset instead of nothing. Absent in local dev — the fallback is
simply off there.

## Not done

- The board itself (`/m/{matchNo}`) still shows its kick-off in venue time,
  which is right for a screen hanging in the venue.
- `visBoard.localDate` is now an unused catalogue key, left in place rather
  than swept out of five locales for nothing.
