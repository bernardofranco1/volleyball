# spec/34 — VIS-fed Live Scoreboard (read-only)

Serve the platform's broadcast scoreboard for matches scored in FIVB VIS —
without scoring them here. Targets: **AVC Women's Asian Championship (VIS
tournament 1766**, Tianjin, Aug 21–30) and **AVC Men's (1765**, Fukuoka,
Sep 4–13); dress rehearsal on the **Boys' U17 World Championship (1670**,
Doha, Aug 19–29 — first match Aug 19, 11:00 local).

Feasibility study (verified evidence, field mapping, risks):
<https://claude.ai/code/artifact/bd1c466d-76f5-4b52-873d-9501d7de098a>

Written for an implementer with no prior context. **Read "Ground rules" and
"Already done" before touching any file.**

---

## Ground rules (violating any of these is a rejected change)

1. **VIS is READ-ONLY. Only `Get*` request types, ever.** Never any
   `Upload*`, `Save*`, `Delete*` — a guest write probe destroyed production
   match data on 2026-07-29 (vis-connector
   `docs/INCIDENT-2026-07-29-337016.md`). If a request name does not start
   with `Get`, you may not send it.
2. **POST the envelope as a RAW `text/xml` body** with header
   `X-FIVB-App-ID: ${process.env.VIS_APP_ID}`. The live feeds
   (`GetVolleyLive`) return HTTP 400 for form-encoded posts (vis-connector
   `docs/VIS-API-NOTES.md`, entry dated 2026-08-18). Envelope shape:
   `<Requests><Request Type="GetVolleyLive" No="27062" Version="0"></Request></Requests>`
3. **Honor `PollDelay`.** The `<VolleyLive>` root carries
   `PollDelay` (seconds, observed 20). Never poll VIS faster than that for a
   given match; the server-side cache below is what makes N viewers cost one
   upstream call.
4. **No engine, no runtime DB writes.** This feature never creates matches,
   events, or snapshots. It reads `competitions` (for the VIS tournament
   number + branding) and VIS. Do not import anything from `src/engine/` or
   `src/lib/match-engine`.
5. **No migrations.** The schema work is ALREADY DONE (see "Already done").
   If you think you need a migration, you have misread this spec — stop.
6. **i18n**: every user-visible string ×5 locales (`en fr de es pt`) in
   `src/lib/i18n/messages.ts`.
7. **No new dependencies.** The VIS payloads are attribute-only XML elements;
   parse with the small regex helpers specified below (Stats-hub ran the same
   approach in production). The provided fixtures pin the behaviour.
8. **Verification gate**: `npx tsc --noEmit` · `npm run lint` (0 errors) ·
   `npm test` green (730 at time of writing + yours) · `npm run build`.
9. Pushing `main` builds a PREVIEW. Production ships via the /admin release
   console (spec/28) — see "Go-live" for the exact order; do not promote.

## Already done (2026-08-18 — do NOT redo)

- **Migration 0023** `competitions.vis_tournament_no integer` (nullable) is
  generated, journal indices bumped (`MIGRATION_JOURNAL_IDX` /
  `KNOWN_JOURNAL_IDX` 22 → 23), and applied to **homolog**. Production gets
  it at go-live via `npm run db:migrate:prod` — a human step.
- **Tenant + competitions exist on homolog**: tenant `live-events`
  ("Live Events") with three INDOOR competitions linked by
  `vis_tournament_no`: 1670 (U17 boys, Doha), 1766 (AVC women, Tianjin),
  1765 (AVC men, Fukuoka). Stable ids `comp_vis_1670/1766/1765`. Re-runnable
  via `scripts/provision-vis-live.ts` (dry-run default, `--execute` to
  apply; `DB_SCHEMA=public` prefix for production at go-live).
- **`VIS_APP_ID`** is set in `.env.local` and in Vercel (production +
  preview). Server-only — never expose it to the client bundle, never log it.
- **Fixtures** in `src/__tests__/fixtures/vis/`:
  `volley-live-finished.xml` (GetVolleyLive, finished match 27062),
  `volley-match-scheduled.xml` (GetVolleyMatch, pre-start match 28803),
  `volley-match-list-1670.xml` (GetVolleyMatchList, 46 matches).

---

## Architecture

```
FIVB VIS  ──GetVolleyLive/GetVolleyMatch(List), raw-XML POST, App-ID──▶
  src/lib/vis-live/  (client + parser + mapper + in-memory store)
    ├─▶ GET /api/vis/board/[matchNo]        (JSON board payload, cached)
    └─▶ server components read the store directly
  /t/[slug]/scoreboard/vis/[competitionId]              (day index)
  /t/[slug]/scoreboard/vis/[competitionId]/[matchNo]    (TV board)
```

Both pages sit under `/t/{slug}/scoreboard/` and are therefore already
public — `isProtectedTenantPath` (src/lib/subdomain.ts) excludes that whole
prefix, and `/api/*` never passes through the auth proxy. No proxy change.

## 1. `src/lib/vis-live/client.ts` — transport + parser

```ts
/** Raw-XML POST to VIS (Get* only — see spec/34 ground rule 1). */
export async function visRequest(envelope: string): Promise<string>
```
- POST `https://www.fivb.org/Vis2009/XmlRequest.asmx`, header
  `Content-Type: text/xml; charset=utf-8` + `X-FIVB-App-ID` from
  `process.env.VIS_APP_ID` (fail with a clear error when unset).
- 8s timeout via AbortController. No retry loop — the polling cadence *is*
  the retry. Non-200 → throw; the store serves stale data instead.
- Guard rail in code, not just prose: `if (!/^<Requests><Request Type="Get/.test(envelope)) throw`.

Parser helpers (attribute-only elements; same approach as Stats-hub):
```ts
export function firstTagAttrs(xml: string, tag: string): Record<string, string> | null
export function allTagAttrs(xml: string, tag: string): Record<string, string>[]
```
- Match `<Tag …/>` and `<Tag …>` openings; extract `Name="value"` pairs;
  decode the five XML entities (`&amp; &lt; &gt; &quot; &apos;`) plus
  numeric `&#…;`. Values arrive UTF-8 (e.g. `Türkiye`) — no other decoding.
- **Alias tolerance** (quirk ledger): tournament/match/team elements appear
  as `VolleyballMatch|VolleyMatch|Match` etc. Helpers take the tag WITHOUT
  prefix logic; callers probe aliases in order (see mapper).

## 2. `src/lib/vis-live/board-data.ts` — types + mappers

```ts
export interface VisBoardData {
  matchNo: number;
  status: "UPCOMING" | "LIVE" | "FINISHED";
  teamA: { code: string; name: string };
  teamB: { code: string; name: string };
  setsWonA: number;            // Match@MatchPointsA (0 when absent)
  setsWonB: number;
  sets: { setNumber: number; scoreA: number; scoreB: number; winner: "A" | "B" | null }[];
  currentSet: number | null;   // highest Set@No while LIVE, else null
  scoreA: number;              // current-set points (0-0 when UPCOMING)
  scoreB: number;
  serving: "A" | "B" | null;   // Set@NoServingTeam vs Match@NoTeamA/B
  poolName: string | null;     // Pool@Name
  beginUtc: string | null;     // Match@BeginDateTime (Z)
  scheduledLocal: string | null; // "2026-08-19 11:00" from the match row (venue-local)
  pollDelaySeconds: number;    // VolleyLive@PollDelay, default 20
}
export function mapVolleyLive(xml: string, matchNo: number): VisBoardData
export function mapVolleyMatch(xml: string): VisMatchSummary | null   // single, pre-start fallback
export function mapVolleyMatchList(xml: string): VisMatchSummary[]    // day index rows
```

Mapping rules — each one is pinned by a fixture test:
- **Status inference** (Stats-hub's proven rule — the numeric enum for "live"
  is unverified; 1 = scheduled and 25 = finished are confirmed, do NOT guess
  others): `Match@EndDateTime` present → FINISHED; else
  `Match@BeginDateTime` present and ≤ now → LIVE; else UPCOMING.
- **Teams**: `Team` elements in document order = A then B; cross-check
  against `Match@NoTeamA/NoTeamB` (match on `No`), don't rely on order alone.
- **Serving**: `latestSet.NoServingTeam === Match@NoTeamA` → "A"; NoTeamB →
  "B"; absent/unknown → null. Only meaningful while LIVE — null otherwise.
- **Set winner**: a set with `PointsTeamA !== PointsTeamB` counts as won by
  the higher side **iff** it is not the latest set OR the match is FINISHED.
  The latest set of a LIVE match has `winner: null` even at 25-23 — VIS may
  still correct it. Do not re-derive 25/15+2 targets; trust the feed.
- Omitted-zero quirk: missing numeric attributes mean 0 (`NbTimeoutTeamA`
  absent = none) — the ledger documents this; default numerics to 0.
- `mapVolleyMatchList` reads
  `VolleyballMatch|VolleyMatch|Match` rows: `No NoInTournament TeamA/BName
  TeamA/BCode DateLocal TimeLocal Status MatchResultText SetsResultsText`.
  Rows with `Status="1"` and empty result = upcoming; `MatchResultText`
  non-empty = finished; anything else = treat as live (show it first).

## 3. `src/lib/vis-live/store.ts` — server-side cache + allowlist

Module-level Maps (per serverless instance — that's fine, each instance is
independently rate-bounded):

- `getMatchList(tournamentNo)`: `GetVolleyMatchList` (Fields as in the
  fixture) cached **60 s**; on upstream failure serve stale (any age) and
  only throw when there has never been a success.
- `getBoard(matchNo)`: `GetVolleyLive No=… Version="0"` cached
  **`pollDelaySeconds`** (from the last payload, default 20 s); on empty /
  failed live response (pre-start matches may have no live row), fall back to
  `GetVolleyMatch No=…` → UPCOMING payload, cached 60 s. Stale-on-error like
  above.
- `isKnownMatch(matchNo)`: allowlist = union of match numbers from
  `getMatchList` of every competition with `vis_tournament_no` set (query
  competitions once, cache 10 min). **The board API must 404 unknown match
  numbers** — without this the endpoint is an open relay onto VIS for
  arbitrary match numbers.

## 4. `GET /api/vis/board/[matchNo]/route.ts`

- Validate `matchNo` = digits; `isKnownMatch` else 404.
- Return `{ board: VisBoardData, ageSeconds: number }`,
  `Cache-Control: public, s-maxage=5, stale-while-revalidate=15` (CDN soaks
  up per-TV polling; the in-memory TTL bounds upstream).
- On total upstream failure with no stale data: 503 with `{ error }` — the
  client keeps its last state and retries.

## 5. Pages

**Day index — `/t/[tenantSlug]/scoreboard/vis/[competitionId]/page.tsx`**
- Server component. `getTenantBySlug` → competition by id (must belong to the
  tenant AND have `visTournamentNo`, else `notFound()`).
- `getMatchList(visTournamentNo)` → group by `DateLocal` (venue-local, label
  it "local time"); today first. Each row: teams, time, status chip
  (upcoming / live / final with `MatchResultText`), link to its board.
- `export const dynamic = "force-dynamic"` + a plain
  `<meta httpEquiv="refresh" content="60">` is acceptable for v1 — the index
  is glanced at, not stared at. (A client poll is fine too; don't gold-plate.)

**Board — `/t/[tenantSlug]/scoreboard/vis/[competitionId]/[matchNo]/page.tsx`**
- Server component: tenant + competition checks as above; verify the matchNo
  belongs to this tournament (`getMatchList` lookup — this is also what makes
  the allowlist warm). Branding/theme exactly like the existing board page
  (`getCompetitionBranding(competitionId)` + `resolveBoardTheme("INDOOR", …)`),
  logo fallback `tenant.branding.logoUrl`.
- Renders `VisBoardDisplay` (new client component) with the initial
  `VisBoardData` fetched server-side.

**`src/components/scoreboard/VisBoardDisplay.tsx`** (client)
- Polls `/api/vis/board/{matchNo}` every **10 s** (the CDN/server cache makes
  this cheap; VIS still sees ≤1 req/PollDelay). On fetch failure: keep last
  data, show a small "signal lost Xs ago" hint after 60 s of failures.
- Renders the existing `BroadcastBoard` — the mapping is total:

  | BoardProps | from VisBoardData |
  |---|---|
  | `teamAName` / `teamBName` | `teamA.name` / `teamB.name` (append codes only if names missing) |
  | `teamAColor` / `teamBColor` | null (theme defaults) — competition colors later if wanted |
  | `setsWonA/B` | `setsWonA/B` |
  | `scoreA/B` | `scoreA/B` |
  | `serving` | `serving` |
  | `servingPlayer` | null (indoor) |
  | `setNumber` | `currentSet` |
  | `sets` | `sets` (already `BoardSet`-shaped) |
  | `finished` | `status === "FINISHED"` |
  | `logoUrl` / `theme` | from the page |

- UPCOMING: render the board frame with 0-0 and a line
  "Starts {scheduledLocal} (local)" — no countdown (DateLocal/TimeLocal are
  venue-local without offset; do not fake a UTC conversion).

## 6. Tests (fixtures are already in `src/__tests__/fixtures/vis/`)

- `mapVolleyLive` on `volley-live-finished.xml`: status FINISHED, 3-0,
  set 1 = 25-23 winner A, serving null, pollDelay 20, team names decoded
  (`Türkiye`).
- Same fixture with `EndDateTime` attribute stripped (string surgery in the
  test): status LIVE, latest set winner **null**, serving derived.
- `mapVolleyMatch` on `volley-match-scheduled.xml`: UPCOMING, scheduled
  local string built, zeros everywhere.
- `mapVolleyMatchList` on `volley-match-list-1670.xml`: 46 rows, first row
  Argentina v Poland 2026-08-19 11:00, all upcoming.
- Store: allowlist rejects an unknown matchNo; TTL logic with injected clock
  (pass `now` in, don't read `Date.now()` inside the pure parts).
- Envelope guard: `visRequest` throws on a non-`Get` envelope.

## 7. Rehearsal — Aug 19, U17 Boys (Doha)

1. Local dev (homolog data is ready): open
   `/t/live-events/scoreboard/vis/comp_vis_1670` — 46 matches listed.
2. From ~11:00 Doha time, open the Argentina–Poland board next to
   volleyballworld.com's live score; verify score, sets, serving, and the
   ≤~40 s lag.
3. Capture a LIVE `GetVolleyLive` payload into the fixtures directory and
   add the real live `Match@Status` value to the vis-connector quirk ledger
   (`docs/VIS-API-NOTES.md`) — it is unverified until this moment.
4. Verify a finished match flips to FINISHED and the index chip updates.

## 8. Go-live (human steps, in this order — before Aug 21)

1. Merge/push the feature; verify the preview build.
2. `npm run db:migrate:prod` (adds `vis_tournament_no` to `public`).
3. `DB_SCHEMA=public npx tsx --env-file=.env.local scripts/provision-vis-live.ts --execute`
4. Promote via the /admin release console (Prepare → Promote).
5. TVs point at
   `https://volleyball-eight.vercel.app/t/live-events/scoreboard/vis/comp_vis_1766/<matchNo>`.

## Out of scope (deliberately)

Rotation grids and player-level data (needs `GetVolleyLive` Options bitmask +
lineup mapping); mirroring VIS matches into the engine (standings/PDFs);
short URLs (`/Scoreboard/vis/…` alias can come later); beach events.
