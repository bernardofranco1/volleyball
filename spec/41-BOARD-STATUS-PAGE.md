# spec/41 — "Is the scoreboard going to work?"

Shipped 2026-08-19. Public at `/status` on the board host, JSON at
`/api/status`. Design artifact:
https://claude.ai/code/artifact/f03883da-872b-44b7-b771-eaf60b0ef64b

## The chain

Everything below has to hold for a board to be live, in request order:

1. **The venue's own connection** — measured in the BROWSER, because no server
   can see a hall's wifi, a captive portal that logged itself out, or a TV that
   quietly dropped off the network.
2. **The board host** — the deployment is serving, and which commit.
3. **The database** — the only dependency that turns a screen BLACK rather than
   stale: without it a board does not render at all.
4. **The VIS integration** — our allowlist and our payload cache. A board is
   exactly as live as the newest payload in that cache.
5. **VIS itself** — reachable, authenticated, returning match lists, and
   **advancing**.
6. **The artwork** — which fails silently by design.

## Two rules the implementation is built around

**Green must mean something.** Each check rules out a distinct failure. The one
that earns its place hardest is `vis-feed`, kept separate from `vis-endpoint`:
VIS can answer every request perfectly while the scorer's laptop has stopped
publishing, and a board frozen at 12-11 looks identical to a board nobody is
watching. Every other check stays green throughout exactly that incident, which
is the incident the page exists for. `store.ts` therefore tracks `changedAt` —
when the score, sets, set number or serve last MOVED — separately from `at`,
when the payload was last fetched.

**Watching VIS must not weigh on VIS.** The default read answers from the caches
the boards already fill. The live probe is a button (`?probe=1`), so a status
page left open on a desk adds nothing to the upstream it is watching.

## Thresholds, and why they are generous

| | warn | down |
| --- | --- | --- |
| payload age (live match) | 30 s | — |
| time since the score moved | 90 s | 240 s |

Payload age is tight because the cadence during play is one second, so thirty is
two orders of magnitude late — that is our polling broken, not VIS being quiet.

Movement is deliberately loose, because volleyball is full of legitimate pauses:
a time-out is 30 s, a technical time-out 60 s, and a challenge or an injury can
hold a set for two minutes with nothing wrong anywhere. The first draft warned at
30 s and went amber during an ordinary rally interval — a page that cries wolf
through every match teaches everyone to ignore it, which is worse than not
having it. Set breaks are exempt entirely: nothing is supposed to move.

## Which cache it reports, and why that one

Next bundles route handlers and server components into separate module
registries, so the VIS store has one instance per layer. `/api/status` is a route
handler, the same layer as `/api/vis/board/[matchNo]` — the endpoint every live
viewer polls. So the figures are what viewers are actually being served, not
what a page render happened to fetch. Verified 2026-08-19: a board fetched
through the API appears in the snapshot; one fetched by rendering its page does
not.

The page says the remaining caveat out loud rather than implying precision it
does not have: these caches are per serverless instance, so a screen in the hall
may be talking to a different one.

## Alerting, without writing any

`/api/status` answers **503** when the overall verdict is `down`, 200 otherwise.
Point UptimeRobot, BetterStack or Pingdom at it and there is alerting with no
further code. No history is stored — the page answers "right now", which needs
no table and no cron. Trend lines would.

## Files

- `src/lib/board-status.ts` — the checks. Pure graders are exported as
  `__statusInternals` for the tests that pin what green means.
- `src/app/api/status/route.ts`, `src/app/status/page.tsx`,
  `src/components/scoreboard/StatusBoard.tsx`.
- `src/lib/vis-live/store.ts` — `changedAt` and `visStoreSnapshot()`.
- `src/__tests__/lib/board-status.test.ts`.
