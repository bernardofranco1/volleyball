# spec/45 — VolleyStation as the boards' source, VIS as the fallback

**Status: IMPLEMENTED 2026-08-20** (W0–W5, §6bis, W7), except the operator
steps in W7.1 and the live-latency measurement in §3.1. Migration 0026 applied
to both schemas. Written and then executed the same day, from a live read-only
exploration of the VolleyStation API.

**The result that matters, measured end to end through the real store:** for
VNL-rehearsal match VIS 27824 / VS 2504642, the two sources produce the SAME
board — same set, same score, same serving side, same court side, and the same
six in the same order **including the libero swapped into the same position**.
Two independent systems, one answer. That is the safety property this spec
asked for before anything served a venue screen.

Deviations from the plan as written, all deliberate:

1. **W2.2 — no console form.** The plan said "the competition settings page
   already edits `visTournamentNo`". It does not: that column has always been
   script-managed (`provision-vis-live.ts`). Rather than build a settings form
   for two fields, the mapping and the source lever follow the established
   pattern in `scripts/set-board-source.ts` — dry-run by default, refuses to
   set `vs`/`auto` on a competition with no championship id, and prints what it
   would change. The mid-event lever is therefore one command rather than one
   click; it still needs no deploy and takes effect within a mapping TTL.
2. **W3's stats bars** carry no opponent-error figure: VolleyStation's stats
   sheet exposes no such aggregate, and inventing one would be worse than an
   empty bar.
3. **§3.1's latency measurement is still open** — it needs a genuinely live
   match, which the rehearsal provides at 13:30 CEST today.

Every claim marked *verified* below was measured against the real API and real
VIS data — nothing is assumed.

Prerequisite reading: spec/34 (the VIS store/route/cadence), spec/42+43 (what
the rotation pipeline is and why), spec/44 (the replay board — untouched by
this spec), AGENTS.md (DB_SCHEMA discipline).

---

## 0. Two rules that override everything else in this document

1. **The key never enters the repository.** `bernardofranco1/volleyball` is a
   PUBLIC repo. The VolleyStation key lives in `VOLLEYSTATION_KEY` — Vercel
   env + `.env.local` (gitignored) — and NOWHERE else: not in fixtures, not in
   test files, not in spec documents, not in commit messages. Every capture
   script must read it from the environment and must never write it into its
   output. `.env.example` gets placeholder entries only.
2. **GET only, ever** — same discipline as VIS (incident 2026-07-29). The
   endpoints answer `Allow: GET, HEAD, OPTIONS` for this token (verified), so a
   write should be impossible upstream, but the client refuses non-GET locally
   anyway: defence in depth is the lesson of that incident, not "the server
   will stop me". The one endpoint that smells like a write trigger,
   `/api/sync/`, was deliberately left un-probed. Never call it.

## 1. Why VolleyStation, in one paragraph

VolleyStation is the scoring system that FEEDS VIS at FIVB events — which the
data proves: the id spaces are shared end-to-end (§2). Reading from it puts the
board one hop from the scorer instead of two, in JSON purpose-built for
scoreboards (`widget` carries the current lineup, the serving player, the side
of court and the substitution in progress — the exact things spec/42/43 spend
hundreds of lines DERIVING from VIS's rally stream), at 1.9 KB per poll where
the VIS payload is ~160 KB, in ~100 ms. It also removes the two VIS pathologies
we engineered around: the rally-behind lineup and the rewrite window.

## 2. The verified facts (measured 2026-08-20 — keep for posterity)

**API**: `https://panel.volleystation.com/api/` — Django REST framework,
Cloudflare-fronted. Auth header `Authorization: Token ${VOLLEYSTATION_KEY}`
(Bearer also accepted; the API root is readable without auth, collections are
scoped by the token). Root resources: `MatchStatsSheet, Matches, Coaches,
Players, SportSocieties, Teams, Seasons, Championships, Referees, Halls,
Leagues, TV_Stations, TV_Transmissions, sync`.

**Scope of this key**: the FIVB panel — VNL 2025/2026 (real + a TEST pair),
Club World Championships, Beach Pro Tour, Olympic qualifiers, World
Championships 2025, and both **AVC Asian Continental Championships 2026**.
It does **NOT** contain the U17 World Championships (VIS 1670/1671) that the
boards serve this week — the switch therefore lands on the AVC events, whose
women's edition starts 2026-08-21.

**The id joins** — VS is upstream of VIS, and it shows:

| entity | join | verified |
|---|---|---|
| match | `VS.MatchNumber == VIS.NoInTournament`, within a championship↔tournament pair | **168/168**: VIS 1766↔VS 6181 (AVC W, 26/26), VIS 1765↔VS 6182 (AVC M, 26/26), VIS 1736↔VS 6004 (VNL W rehearsal, 116/116), local dates agreeing |
| team | `VS.Teams[].Code == VIS.NoTeam` and `VS.ShortCodeName == VIS.TeamACode` | Chinese Taipei: VS Code 9310 == VIS NoTeamA 9310, TPE==TPE — all 12 AVC W teams |
| player | `VS.PlayerList[].code == VIS.NoPlayer`, `Number == NoShirt`, `internal_id == VIS registration No` | player 167045: code, shirt 6 and registration 1028695 all equal across both systems |
| championship ↔ tournament | **no stored id anywhere** — `fivb_id` and `external_ids` are empty on ALL 12,768 matches and all teams | must be configured per competition (§5) |

**Sizes and latency** (measured):

| request | size | time | note |
|---|---|---|---|
| `Matches/{ChampionshipMatch_ID}/` | 1.9 KB | ~100 ms | THE live poll — carries scores, set ladder, counters and `widget` |
| `Matches/?Championship_ID=N` | ~135 KB | ~210 ms | schedule + allowlist source |
| `Teams/?Championship_ID=N` | (12 teams + full rosters) | fast | names, codes, `PlayerList` with shirt numbers and VIS player codes |
| `MatchStatsSheet/?ChampionshipMatchID=N` | 23 KB / 28 rows | ~100 ms | per-player match stats incl. `Points` |
| `Matches/` bare | **23.7 MB** | ~20 s | 12,768 rows — never in a poll loop |
| `MatchStatsSheet/` bare or with a wrong param | **77 MB** | ~50 s | ⚠ `?match=` is silently IGNORED and returns everything; only `?ChampionshipMatchID=` filters |

**⚠ There IS rate limiting, and it is undocumented until you trip it.**
Repeated `Matches/?Championship_ID=N` calls without a date window start
answering **HTTP 429** with a JSON body that names the remedy:

> `Fetching all matches without date filters like MatchDateTime__gte=…` /
> `MatchDateTime__lte=… is a resource intensive operation, and subject to rate
> limiting`

So **every list call must carry `MatchDateTime__gte` (and preferably
`__lte`)** — measured: `?Championship_ID=6181&MatchDateTime__gte=2026-08-20&
MatchDateTime__lte=2026-09-10` → 200, 143 KB, ~180 ms, repeatedly. The
per-match detail endpoint is NOT limited this way (5 rapid calls, all 200,
~120 ms), which is what makes 1 Hz live polling viable. The client enforces
this (W1.2) rather than trusting callers to remember.

**Match row fields the board needs** (from `Matches/`): `ChampionshipMatch_ID`
(VS id), `MatchNumber` (join key — a STRING), `Championship_ID`, `HomeTeam` /
`GuestTeam` (names) + `HomeTeam_ID`/`GuestTeam_ID`, `MatchDateTime` (ISO with
offset — **panel timezone +02:00, NOT venue-local**; never join or infer by
clock), `WonSetHome/Guest`, `Set1Home..Set5Guest`, `TimeSet1..5` (minutes),
`PointsHome/Guest` (match points), `timeout_count` / `substitution_count` /
`challenge_count` (arrays — semantics to confirm in §3), `set_ball_count` /
`match_ball_count`, challenge-in-progress fields (`challenge_team`,
`challenge_reason`, `challenge_time`, `challenge_phase`), `Spectators`,
`postponed`, `golden_set_*`, and **`widget`**:

```json
{ "current_set": null, "current_rally": null,
  "current_set_points_home": 0, "current_set_points_away": 0,
  "won_sets_home": 3, "won_sets_away": 1,
  "lineup_home": null, "libero_replacing_home": null, "libero_number_home": null,
  "lineup_guest": null, "libero_replacing_guest": null, "libero_number_guest": null,
  "left_side": "away", "serve": null, "serving_player_number": null,
  "in_rally": false, "in_set": false, "current_substitutions": null }
```

**`MatchStatsSheet` row**: per player per match — `PlayerID`, `Number`
(shirt), `Libero` (0/1), `Captain`, `is_home`, `Points` (scorer points:
attack+block+ace, ≈ VIS `TotalPoints` semantics — a 5-set match summed to 68,
not ~200), full skill breakdowns (`ServeWin/Err/…`, `RecEx/…`, `SpikeWin/…`,
`BlockWin/…`, `SuccessfulDigs`, per-set entry markers `Set1..Set5`).

**Championships** carry the full regulation config (`sets_to_win`,
`points_to_win_set[_deciding]`, `timeout_limit`, `video_challenge_limit`,
`libero_can_serve`, …) and a `vis_access` boolean. `DateFrom/DateTo` bound the
event.

## 3. The widget, resolved (W0 — measured 2026-08-20 11:20 CEST)

The first pass saw only null/finished widgets. A second pass found matches
parked mid-set with **fully populated** widgets (VNL test championships 6004 /
6005, VIS TEST 877), which answers every shape question the gate was about.
The gate is therefore **LIFTED for shape**; what remains open is latency only
(§3.1).

```jsonc
{ "current_set": 1,            // set number
  "current_rally": 12,         // rally index WITHIN the set (null before rally 1)
  "current_set_points_home": 6, "current_set_points_away": 6,
  "won_sets_home": 0, "won_sets_away": 0,
  "lineup_home": [3, 10, 6, 4, 5, 9],   // SHIRT numbers, POSITION ORDER, P1 first
  "libero_replacing_home": 9,  // which of those six is currently OFF court
  "libero_number_home": 11,    // ...and the libero who is on in their place
  "lineup_guest": [11, 7, 13, 5, 6, 8],
  "libero_replacing_guest": null, "libero_number_guest": null,
  "left_side": "home",         // "home" | "away"
  "serve": "home",             // "home" | "away"
  "serving_player_number": 3,  // shirt number
  "in_rally": false, "in_set": true,
  "current_substitutions": { "away": [], "home": [] } }
```

**The findings, each with its evidence:**

1. **`lineup_*` is six SHIRT numbers in position order, P1 first** — the same
   convention VIS uses. Proof: `serving_player_number === lineup[serve][0]` on
   every populated widget observed (2504866 → 3; 2504876 → 1; 2228541 away → 2;
   2504642 → 7; and 2504640 pre-lineup). This is the single most valuable fact
   in the integration: **the scorer's current rotation arrives directly, so
   nothing has to be derived.** No side-out advance, no rewrite window, no
   serve anchoring — spec/42+43's machinery has nothing left to correct.
2. **The lineup carries the ROTATION, not who is physically on court.**
   `libero_replacing_*` names the player among those six who is currently off,
   and `libero_number_*` the libero standing in their place (2504866: #9 is in
   the six at P6, replaced by libero #11; 2504642: #14 at P5, replaced by #6).
   This is the OPPOSITE of VIS, whose per-rally `LineUp` already has the libero
   substituted in. **The mapper must do that swap itself** (W3) or the board
   will name the player sitting on the bench.
3. **`serve` and `left_side` are `"home" | "away"`.** Map home→A, guest→B
   consistently and pin it with a test.
4. **`current_rally` counts within the set** (12 at 6–6, 21 at 11–11, 3 at
   1–2); null before the first rally.
5. **`timeout_count` / `substitution_count` / `challenge_count` are
   `[home, guest]` REMAINING — not used.** Proof: matches at 0–0 carry
   `[2,2] / [8,8] / [2,2]`, which are exactly the championship's
   `timeout_limit` / `substitutions_limit` / `video_challenge_limit`; a match
   at 6–6 with one time-out taken reads `[1,2]`. This is the inverse of VIS
   (which reports used) and maps DIRECTLY onto what the board renders, so the
   mapper must not subtract. Note `substitutions_limit` is **8** on these
   events, not the FIVB 6 — another reason to read the championship config
   rather than assume `FIVB_PER_SET`.
6. **`current_substitutions` is `{home: [], away: []}`** — element shape not
   yet observed (no substitution was in flight). The mapper must tolerate any
   element type: read `.length` only, never index into it.

### 3.1 What is still open, and why it does not block

**Update latency** relative to the scorer's keypress cannot be measured from a
parked match. It is not a correctness risk — it only tunes the cadence, and
the cadence already defaults to the VIS-proven 1 s. Measure it at the first
genuinely live window and record it here: the **rehearsal, 2026-08-20 13:30
CEST** (`2504650`, China v Thailand == VIS 27832) and the **AVC Women opener,
2026-08-21 ~04:00 CEST** (`2558885`, Chinese Taipei v Iran == VIS 28803).
W0's capture script (below) is what takes that measurement; it is still worth
running, but W3 no longer waits on it.

## 4. Architecture — where VS slots in, and what does not change

```
viewer → /api/vis/board/{matchNo} → store.getBoard(matchNo)
                                       │
                          mapped to a VS championship AND VS answers?
                             yes ──► buildBoardFromVs (new)   ──► VisBoardData
                             no  ──► existing VIS path (UNCHANGED)
```

Everything downstream of `VisBoardData` — pages, U-shape, cadence, CDN
headers, status page plumbing, the replay board, the mock — is untouched. The
route keeps its URL and its response shape; a TV cannot tell the sources
apart except by the board being ~1 s fresher.

The VIS path is not merely kept as dead code: it remains the ONLY path for
competitions without a VS mapping (the U17 Worlds this week), and the
automatic fallback when VS errors mid-match. The spec/43 enforcement continues
to run on VIS-sourced boards exactly as today; on VS-sourced boards the widget
IS the scorer's current lineup, so nothing needs deriving — but R3 still
applies (§7.4) and a shadow comparison runs during the pilot (§8).

## 5. Workstream map

W0 capture → W1 client → W2 mapping → W3 the VS-built board → W4 visibility →
W5 tests, plus **§6bis** (dual-source running — the `?source=` override and
`board_source` lever) and **W7** (board-host homologation + promotion, its own
section below). Build order per the rollout in §8: **W7 and W1+W2 ship today
before the rehearsal; W3/§6bis tonight after W0's capture; nothing else
blocks.**

### W0 — capture a live match (do this FIRST; it is a few hours of waiting, not of work)

1. Script `scripts/capture-vs-live.mts` (model on capture-vis-events.mts):
   GET-only; takes a `ChampionshipMatch_ID`; polls `Matches/{id}/` every 1 s
   and `MatchStatsSheet/?ChampionshipMatchID={id}` every 15 s for a given
   duration; writes NDJSON frames with a wall-clock stamp per line to
   `spec/reference/vs-live-capture-<id>.ndjson` (only changed frames — dedupe
   on the JSON body). The script must assert the key is present, never print
   it, and refuse any URL whose path is not exactly `Matches/…` or
   `MatchStatsSheet/…` with the required filter.
2. Run it across at least one full set of a real match (AVC W, 2026-08-21+).
   Also capture the same match from VIS (`scripts/capture-vis-events.mts`-
   style, GetVolleyLive at 10 s) so latency between the two sources is
   measurable afterwards.
3. Write the findings INTO §3 of this spec (replace the unknowns with the
   observed facts), plus a fixtures file trimmed to ~30 representative frames:
   pre-match, first rally, mid-set with lineups populated, a substitution, a
   timeout, a challenge, set end, match end.
4. Gate: W3 does not start until this section is filled in.

### W1 — the VS client (`src/lib/vs-live/client.ts`)

Mirror of `vis-live/client.ts`, with these guards baked in rather than
documented:

```ts
const ENDPOINT = process.env.VOLLEYSTATION_ENDPOINT   // https://panel.volleystation.com/api
const KEY = process.env.VOLLEYSTATION_KEY             // server-only; never NEXT_PUBLIC_*
export class VsRequestError extends Error { … }
/** GET only; path allowlist; the two dump-endpoints refuse to go unfiltered. */
export async function vsGet<T>(path: string): Promise<T>
```

1. `vsGet` builds `${ENDPOINT}/${path}`, sends
   `Authorization: Token ${KEY}` + `Accept: application/json`, 8 s timeout
   (`AbortController`), no retry — the cadence is the retry, exactly as
   spec/34 argued for VIS.
2. **Refusals (throw, do not warn):** any method other than GET is
   unrepresentable (the function only GETs — do not add an options bag with a
   method); a `path` starting with `Matches/` and containing neither a
   numeric id segment nor `Championship_ID=`; a path starting with
   `MatchStatsSheet/` without `ChampionshipMatchID=` (measured: the unfiltered
   sheet is 77 MB and `?match=` is silently ignored); the path `sync` in any
   form.
3. Missing env → throw `VsRequestError("VOLLEYSTATION_KEY is not set")`; the
   store treats that as "VS unavailable" and falls back (§7.5), so a
   deployment without the key (e.g. the board host until its env is updated)
   keeps working on VIS.
4. Typed wrappers, thin: `vsMatch(id)`, `vsMatches(championshipId)`,
   `vsTeams(championshipId)`, `vsStats(championshipMatchId)`. Types in
   `src/lib/vs-live/types.ts` transcribed from §2 — fields we do not read may
   be `unknown`.
5. Env plumbing: add both vars to `.env.example` (placeholders), Vercel
   production + preview on BOTH projects (volleyball and fivb-live-scoreboards)
   — an operator step, listed in §10.

### W2 — the mapping (one migration, one console field, one resolver)

1. **Migration 0026** — one migration, three additive changes (⚠ bump BOTH
   `MIGRATION_JOURNAL_IDX` in backup-policy.ts and `KNOWN_JOURNAL_IDX` in
   restore-backup.mts to 26 — the paired test added on 2026-08-20 fails
   otherwise, by design):
   - `ALTER TABLE competitions ADD COLUMN vs_championship_id integer;` —
     nullable; null = "no VS source exists", which stays true for the U17s.
   - `ALTER TABLE competitions ADD COLUMN board_source text NOT NULL DEFAULT
     'vis';` — which source a competition's boards SERVE by default:
     `'vis'` (today's behaviour, and the default so nothing changes on
     migrate), `'vs'` (serve VolleyStation, fall back to VIS on failure), or
     `'auto'` (serve VS when mapped and healthy, else VIS). This is the
     operational lever the comparison phase (§6bis) flips per competition from
     the console, with no redeploy.
   - `ALTER TABLE releases ADD COLUMN project text NOT NULL DEFAULT
     'scoring';` — the release history learns which DEPLOYMENT a row is about,
     for W7. The default backfills every existing row correctly.
2. Console: the competition settings page already edits `visTournamentNo`; add
   `vsChampionshipId` and a `board_source` select beside it (same form, same
   action file; integer-or-empty validation for the id, enum validation for
   the source). Values for the operator to enter now: AVC W `1766 → 6181`,
   AVC M `1765 → 6182`, VNL rehearsal `1736 → 6004` — all with `board_source`
   left `'vis'` until the comparison says otherwise.
3. **Resolver** (`src/lib/vs-live/resolve.ts`): for each competition with both
   ids set, build `visMatchNo → ChampionshipMatch_ID`:
   - inputs: the VIS match list (ALREADY cached by the store's allowlist
     machinery — reuse `getMatchList`, do not fetch VIS again) and
     `vsMatches(championshipId)`;
   - join on `String(vis.NoInTournament) === String(vs.MatchNumber)`
     (`MatchNumber` is a string in VS; compare as strings);
   - **verification belt, per pair**: resolve `HomeTeam_ID/GuestTeam_ID`
     through `vsTeams()` and require `{Code, Code}` as a SET to equal
     `{VIS NoTeamA, NoTeamB}` (order-independent — home/guest need not equal
     A/B). A pair failing the belt is DROPPED and logged; never mapped on
     number alone. (TBD-vs-TBD placeholder rows will fail team resolution —
     dropping them is correct; they join once the bracket fills in.)
   - cache: module-level, 10 min TTL, same pattern/instance-scoping as the
     allowlist; expose `vsMatchIdFor(matchNo): number | null`.

### W3 — the board built from VS (`src/lib/vs-live/board-data.ts`)

*(Blocked on W0. Field names below marked ⚠ are the ones W0 confirms.)*

`mapVsBoard(opts): VisBoardData` — the SAME output type as `mapVolleyLive`,
so nothing downstream changes. Inputs: the match row, the two team rosters,
the stats rows, `matchNo` (the VIS number — it stays the board's public id),
`now`.

| VisBoardData field | from VS |
|---|---|
| `status` | FINISHED when `WonSetHome/Guest` reaches the championship's `sets_to_win` (fetch once, cache with the resolver) or disqualification; UPCOMING when nothing played and `widget.in_set` false and `MatchDateTime` in the future (compare INSTANTS — the offset is panel-TZ, the instant is still correct); else LIVE |
| `scoreA/B`, `currentSet` | `widget.current_set_points_home/away`, `widget.current_set` (home→A, guest→B — pin A=Home everywhere and test it) |
| `setsWonA/B` | `WonSetHome/Guest` |
| `sets` ladder | `Set1Home..Set5Guest`, rows where either side > 0 or set ≤ played; winner from the championship's `points_to_win_set` rules or simply the completed-set comparison as `mapVolleyLive` does |
| `serving` | `widget.serve` ⚠ |
| `teamAAtLeft` | `widget.left_side` ("away" observed — presumably "home"/"away") ⚠ |
| `players` (the six) | `widget.lineup_home/guest` ⚠ — expected shirt numbers in position order; dress via the roster (`PlayerList`: `Number` → `Player_ShirtName`/`Player_Surname`); `isLibero` from `libero_number_*` + `PlayerList` position flags; points via `MatchStatsSheet.Points` joined on `Number`+`is_home` (or `PlayerID` if the widget carries ids) |
| `timeoutsTaken` etc. | `timeout_count` / `substitution_count` / `challenge_count` arrays ⚠ (expected `[home, guest]`); remaining = championship config limits minus taken — the config is IN the championship row (`timeout_limit`, `video_challenge_limit`), better than VIS's hardcoded FIVB_PER_SET |
| `inSetBreak` | `!widget.in_set` while `setsWon` < `sets_to_win` and at least one set played ⚠ (verify against W0's set-end frames; do NOT infer from Duration — spec/37's lesson) |
| `stats` (set-break bars) | sums over `MatchStatsSheet`: attacks = `SpikeWin`(+`FirstBallSideOutWin`? ⚠ W0 compares totals against VIS TeamStatistics for the same match), blocks = `BlockWin`, serves = `ServeWin`, opponent errors — if not derivable, `null` (the board renders fewer bars; check what VisSetStats does with null before deciding) |
| `lastFinishedSet`, `poolName`, `tournamentName`, `scheduledLocal` | ladder; competition row (we HAVE the names locally — do not fetch VS Leagues for this); `MatchDateTime` reformatted |
| `pollDelaySeconds` | constant 5 (no advisory delay in VS; used only as the non-live floor by cadence) |

Store integration (`src/lib/vis-live/store.ts`):

```ts
export type BoardSource = "vis" | "vs";
/** What to serve: the viewer's explicit ?source= override, else the
 *  competition's board_source ('auto' resolves to vs-when-mapped). */
export async function getBoard(
  matchNo: number,
  now?: number,
  requested?: BoardSource | null,   // from ?source=; null = competition default
): Promise<Aged<VisBoardData & { source: BoardSource }>>
```

- Resolution order: `requested` wins; else the competition's `board_source`
  (`'vis'` → VIS; `'vs'`/`'auto'` → VS when `vsMatchIdFor(matchNo)` maps).
  A VS choice that fails for ANY reason — no mapping, no key, fetch error,
  non-JSON body, mapper throw — falls through to the untouched VIS path in the
  same request: stale VS never beats live VIS.
- **Cache keying:** one match must be cacheable from BOTH sources at once —
  §6bis runs them side by side deliberately. Do not overload the `boards` map
  (negative keys are already taken by the replay): add a parallel `vsBoards`
  map keyed by matchNo. Everything about an entry — freshness, `changedAt`,
  TTL from `pollIntervalMs`, in-flight dedupe (`vs-board:${matchNo}` key) —
  behaves identically to the VIS entries.
- `buildBoardFromVs` polls `vsMatch(vsId)` every cadence tick (1.9 KB — the
  existing 1 s LIVE cadence applies unchanged); rosters+championship config on
  a 10 min TTL; stats on a 10–15 s TTL merged into the entry.
- The board payload gains `source: "vis" | "vs"` (additive — no page breaks),
  and `VisBoardDisplay` renders it as a small corner tag ONLY when the viewer
  forced `?source=` (a venue TV on the default shows nothing new).
- Route: `/api/vis/board/{matchNo}?source=vis|vs` passes the override through;
  the CDN cache key includes the query string on Vercel, so the two variants
  cache independently. Board pages (`/m/{no}`, tenant path) accept and forward
  the same param, exactly as `?bg=`/`?layout=` are forwarded today.
- `boardPulse` and `changedAt` semantics unchanged — the frozen-feed detector
  must keep meaning "the score moved".
- The replay board and the mock are not touched by source selection
  (`REPLAY_MATCH_NO`/mock short-circuit before it).

### W4 — visibility

1. Status page: a `vs` check in the vis group — endpoint reachability is
   reported from cache ages (no probe by default, same philosophy as the VIS
   checks); per-board rows show the source: `#28803 · via VolleyStation` /
   `· via VIS`. Extend `visStoreSnapshot` with `source`.
2. `scripts/rotation-log.ts` untouched; the shadow rows of §8 land in the same
   table with kind `vs-vis-diverged`.

### W5 — tests (fixtures only; no live calls in CI)

Fixtures: trimmed captures from this exploration + W0's live frames, committed
under `src/__tests__/fixtures/vs/` — **grep them for the key before
committing** (they are plain JSON; the capture script never writes it, but
verify anyway: the repo is public).

1. Client guards: unfiltered `MatchStatsSheet` refused; bare `Matches/`
   refused; `sync` refused; missing key → `VsRequestError`.
2. Resolver: the 26-match AVC W fixture joins 26/26 against the VIS list
   fixture; a fabricated row with the right number but wrong team codes is
   dropped and logged; TBD rows drop silently.
3. `mapVsBoard` goldens per W0 frame: pre-match (UPCOMING), live mid-set (six
   dressed with names+jerseys+points, serving side, left side), substitution
   frame, set break, finished. Every golden asserts the OUTPUT type invariants
   the VIS mapper's tests assert (positions 1..6, no empty names, counters
   within allowances).
4. Store: mapped match uses VS (fetch mock asserts the VS URL, not fivb.org);
   VS 500/timeout mid-match → same request returns a VIS-built board; unmapped
   match → VIS only, byte-identical behaviour to today (reuse an existing
   vis-store test as the harness).
5. R3 on the VS six: a fabricated widget with the libero at P1 of the serving
   side → the guard refuses/holds exactly as `lineup-stability`'s belt-and-
   braces does today, and logs.
6. Replay + mock regression: their tests already exist; the only new assertion
   is that source selection never fires for them.
7. Dual-source (§6bis): with both entries cached for one match, `?source=vis`
   and `?source=vs` return different `source` fields and independent
   `ageSeconds`; `board_source='vs'` serves VS by default while
   `?source=vis` still forces VIS on the same match; `board_source='auto'`
   with no mapping behaves exactly like `'vis'`.
8. W7 console: `promoteBoardRelease` refuses a preview-target build, refuses a
   candidate whose `/api/version` reports more migrations than the DB has
   applied, writes a `releases` row with `project='board'`, and runs NO
   backups (assert the backup module is never imported into its path — the
   existing release-actions test file shows the mocking pattern); the scoring
   panel's existing tests stay green untouched.

## 6. Rotation and spec/43 under a VS source

The widget's lineup is the scorer's CURRENT state — not last rally's, not
rewritten after the fact — so the two mechanisms spec/42/43 built (side-out
advance, rewrite stabilisation, serve-anchored enforcement) have nothing to
correct on a VS board. They stay fully active for VIS-sourced boards.

Keep on VS boards: the R3 belt-and-braces (a libero shown serving is wrong
whatever the source says) and, during the pilot only, §8's shadow comparison.
Do NOT run `enforceLineups` against VS data — it needs the rally stream, which
VS does not expose (aggregates only; no play-by-play endpoint was found).

## 6bis. Running both sources at once — the comparison is a feature, not a phase

**Owner requirement (2026-08-20): during the AVC event, one screen on VIS data
and one on VS data for the same match, so the two can be compared live and
EITHER can be used in case of need.** This is why the source machinery is
explicit rather than a hidden fallback:

1. `?source=vis` and `?source=vs` on every board URL force a source for that
   screen only, whatever the competition default. Two browser windows — or two
   venue TVs — on `/m/28803?source=vis` and `/m/28803?source=vs` ARE the
   comparison rig; the existing `?layout=`/`?screen=` params combine freely.
2. The competition's `board_source` is the default every unforced screen
   follows, changeable from the console mid-event with no redeploy: if VS
   misbehaves at 18-17 in the fourth, flipping the competition back to `'vis'`
   moves every default screen on the next poll, and any screen already forced
   with `?source=vis` never moved at all.
3. Both entries show on the status page simultaneously (`#28803 · via VIS` and
   `#28803 · via VolleyStation`), each with its own age and since-change
   figures — so "which source is fresher right now" is a glance, not an
   argument.
4. The shadow comparison (§8) writes a `vs-vis-diverged` row whenever the two
   cached entries disagree on score, set, serving side or the six — the
   evidence base for eventually making `'vs'` the default.
5. Cost while comparing: one extra upstream poll per match (VIS ~160 KB/1 s
   with the Version handshake making quiet polls ~0.1 KB, VS 1.9 KB/1 s).
   Bounded per instance by the same TTL+dedupe machinery; acceptable for an
   event week, and it ends when one source is chosen per competition.

## W7 — homolog and promotion for the board host (the deployment half of this spec)

**Owner requirement (2026-08-20): the scoreboard deployment gets the same
homologation-then-promote discipline the scoring app has (spec/28), starting
with today's dress rehearsal.** Today a push to `main` deploys STRAIGHT to the
board host's production domain (verified 2026-08-20: the push of `cf018a6`
went live on `fivb-live-scoreboards.vercel.app` unattended). That was
acceptable while the boards were the only thing changing; it is not acceptable
while their data source is being swapped under live events.

### W7.1 — project settings (operator, in the Vercel dashboard, BEFORE merging W3)

On the `fivb-live-scoreboards` project, mirror what spec/28 §4 did to the
scoring project so that a `main` push builds a candidate that CANNOT reach the
production domain, and only the console moves the domain. Verify the same way
spec/28 did: push a docs-only commit, confirm the deployment lands as
`target: preview`/unassigned and production still serves the old build.
Also set the project's **Preview environment to the same values as its
Production environment** (`BOARD_ONLY=1`, `DB_SCHEMA=public`,
`NEXT_PUBLIC_DB_SCHEMA=public`, `VIS_APP_ID`, and W1's `VOLLEYSTATION_*`):
unlike the scoring app — whose previews deliberately run against the homolog
tables because they WRITE — a board build is read-only over shared platform
data, and a homolog board that read different rows than production would
validate nothing. (The one board-side write, `vis_rotation_log`, is
idempotent by unique index, so homolog and production writing the same rows is
a no-op, not a conflict.)

### W7.2 — the homolog board alias

`BOARD_HOMOLOG_ALIAS` (suggest `fivb-live-scoreboards-homolog.vercel.app`),
assigned to a chosen candidate build from the console exactly as the scoring
app's `setHomolog` does. This is the URL the rehearsal watches: the full board
host — competition index, `/m/{matchNo}`, `/status`, mock, replay — running
the candidate code against the production schema and live feeds, on a screen
that is not in a hall.

### W7.3 — the console

Extend the EXISTING `/admin/releases` page (scoring app — it has the auth, the
Vercel client, the audit trail; the board host itself has no sessions and must
never grow any) with a second panel, "Scoreboard host", driven by:

- env: `BOARD_RELEASE_PROJECT_ID` (the fivb-live-scoreboards project id, from
  `vercel projects ls`) and `BOARD_HOMOLOG_ALIAS`; `RELEASE_TOKEN` /
  `RELEASE_TEAM_ID` are the same team and are reused. Panel renders a
  "not configured" notice when unset, same pattern as the existing page.
- actions in `release-actions.ts`, mirroring the existing three:
  `prepareBoardRelease(sha)` (production-target build of a commit on the board
  project), `setBoardHomolog(deploymentId)` (alias flip),
  `promoteBoardRelease(deploymentId)` (point the production domain at a READY
  production-target build). All behind the same `gate()` (global admin +
  `IS_PROD_SCHEMA`) and all writing `recordAudit` rows.
- what promote does NOT do for the board host, deliberately: **no tenant
  backups** (the board host owns no tenant data — a backup here would be
  theatre) and no schema-pending hard block. It KEEPS the candidate-migration
  check in its rollback-safe form: refuse when the candidate's
  `/api/version` reports MORE migrations than the shared DB has applied
  (`fetchDeployedVersion` + `migrationVerdict` are reusable as-is — the board
  host serves `/api/version` already, verified 2026-08-20).
- history: rows go to the same `releases` table with `project = 'board'`
  (migration 0026, W2.1); the panel lists only its own project's rows, the
  existing panel filters to `'scoring'`.
- UI: same building blocks (`stateBadge`, `ActionForm`, deployment list capped
  at 8, current-production tile with its Swiss-time stamp). One deliberate
  difference in copy: the panel states that candidates read the PRODUCTION
  schema and are therefore safe to point real screens at.

### W7.4 — rollback is the reason this exists

`promoteBoardRelease` with an older production build is the rollback, exactly
as on the scoring app — instant, no rebuild. The scenario it is bought for:
VS-sourced boards misbehave mid-event in a way the `board_source` lever cannot
fix (a rendering defect, not a data defect) → roll the board host back to the
pre-VS build while the scoring app stays where it is. The two projects
promote independently; nothing in W7 couples them.

## 7. Hazards for the implementing agent (beyond §0)

1. `MatchNumber` is a **string** ("114"); `NoInTournament` parses as a number.
   Compare as strings.
2. `MatchDateTime` offset is the panel's (+02:00), not the venue's. Join by
   number, display schedule from OUR competition data, and compare only
   instants.
3. `fivb_id` and `external_ids` exist and are tempting — they are empty on all
   12,768 matches. Do not build on them; DO ask VolleyStation to populate them
   (§9), and prefer them over the number join if that ever happens.
4. Stats `Points` is scorer points (≈ VIS `TotalPoints`), not rally points.
5. Two ids per match travel together everywhere: the VIS `matchNo` (public,
   URLs, allowlist) and the VS `ChampionshipMatch_ID` (polling). Never leak
   the VS id into a URL or the board payload.
6. VS `Set1..Set5` of an UNPLAYED set is 0/""-ish and the stats sheet's per-set
   markers use 99 as a sentinel — treat non-numeric/99 as absent (VS's own
   omitted-zero quirk).
7. No advertised rate limits; assume they exist. One instance polling one live
   match at 1 s + stats at 10 s ≈ 1.1 req/s — fine; the dedupe/TTL machinery
   already bounds it per instance exactly as for VIS. Ask VS for the real
   numbers (§9).
8. Cloudflare fronts the API — expect the occasional 5xx/challenge page
   (non-JSON body). Treat any JSON parse failure as a fetch failure →
   fallback, never a crash.

## 8. Rollout — cut against the real calendar

The clock that matters: **the dress rehearsal is TODAY (2026-08-20** — the
VNL-rehearsal fixture China v Thailand, VS `2504650` == VIS `27832`, 13:30
+02:00**), and AVC Women starts TOMORROW (2026-08-21, ~04:00 UTC+2**, opener
VS `2558885` == VIS `28803`).**

**Today, before the rehearsal (deployment first, code second):**

1. W7.1 operator step — flip the board project's settings so pushes stop
   reaching production, mirror Preview env to Production env, create
   `BOARD_HOMOLOG_ALIAS`. From this moment the board host is release-gated;
   production keeps serving the current build untouched.
2. Ship W7.2/W7.3 (console panel + actions) and W1+W2 (client, migration 0026,
   console fields, resolver) — none of this changes what any screen renders.
   Enter the rehearsal mapping (1736→6004) only; `board_source` stays `'vis'`
   everywhere.
3. **During the rehearsal**: run W0's capture against `2504650` (VS at 1 Hz,
   VIS at 10 s). This is the dual purpose of the DR — it validates the new
   homolog pipeline (point the homolog alias at the candidate and watch the
   rehearsal on it) AND produces the live-widget evidence W3 is gated on.

**Tonight:** fill §3 from the capture; build W3 + §6bis (`?source=`,
`board_source` resolution, `vsBoards` cache, status rows) + the shadow job
(fire-and-forget, swallow-everything — the spec/42 discipline: it compares the
two cached entries and writes `vs-vis-diverged` rows, never blocks a board).
Candidate build → homolog alias → validate `?source=vs` against the replay-
and-rehearsal data → promote via the new panel when green.

**Tomorrow (AVC W, from the opener):**

4. Enter the AVC W mapping (1766→6181), `board_source` `'vis'`. Watch match 1
   with two screens: `/m/28803?source=vis` and `/m/28803?source=vs` — the
   comparison the owner asked for. The status page shows both entries' ages;
   the shadow log records every divergence.
5. If VS reads clean across the first day, flip AVC W's `board_source` to
   `'auto'` (or `'vs'`) from the console — a data change, not a deploy. Any
   individual screen can still be pinned to either source with `?source=`.
   AVC M (1765→6182) follows on its first day, 2026-09-04.
6. If VS misbehaves: `board_source` back to `'vis'` fixes data-source trouble
   without a deploy; `promoteBoardRelease` of the previous build fixes
   code trouble without touching the scoring app.

**After a clean week:** keep the shadow job code path but stop scheduling it;
U17s and every unmapped competition stay on VIS, unchanged, indefinitely.

## 9. No vendor contact — every unknown is answered by observation instead

**Owner decision (2026-08-20): VolleyStation is not to be contacted about this
integration.** Everything a conversation would have de-risked is handled
inside the plan:

| unknown | how the plan absorbs it |
|---|---|
| rate limits (none advertised) | conservative cadence (1 Hz per live match per instance, the same dedupe/TTL bounding as VIS); on any 429/403/5xx or non-JSON body the board falls back to VIS on the SAME request — being throttled is an inconvenience, never an outage |
| push channel (websocket/SSE) | assume none; poll. W0's capture measures the widget's actual freshness at 1 Hz, which is what decides whether polling is good enough — not what a vendor says |
| `fivb_id` forever empty | the number join is treated as permanent, which is why the team-code verification belt (W2.3) is mandatory rather than transitional |
| widget semantics | W0 observes them from a real match; §3's gate stands. Where a field stays ambiguous after W0, the mapper must not read it (fall back to the VIS-derived value or omit) rather than guess |
| key rotation / revocation | the key is env-only, so rotation is an env update + redeploy; if the key dies mid-event every mapped board falls back to VIS automatically — which is the standing reason VIS support is never removed |
| widget latency vs scorer keypress | measured in W0 by capturing VS at 1 Hz and VIS at 10 s side by side for the same match |

## 10. Acceptance criteria

- The key exists only in env (verify: `git grep` for its first 8 chars over
  the full history returns nothing; both Vercel projects have it set).
- The client cannot express a non-GET request or an unfiltered dump (tests).
- The same match renders from BOTH sources at once: `?source=vis` and
  `?source=vs` on one URL give two live boards, independently cached, both on
  the status page with their own ages; the competition's `board_source`
  changes every unforced screen from the console with no redeploy.
- U17 boards untouched on VIS, same routes, same payload shape, same cadence;
  kill VS (bad key locally) and every VS-selected board renders from VIS on
  the next poll.
- The resolver maps 26/26 AVC W with the team-code belt green; the pilot's
  `vs-vis-diverged` log for one full match day contains nothing unexplained.
- **Board host is release-gated**: a `main` push no longer changes what
  `fivb-live-scoreboards.vercel.app` serves (verified with a throwaway
  commit); the homolog alias serves a chosen candidate; promote and rollback
  work from the new console panel and write audit + `releases` rows with
  `project='board'`; the scoring app's own release flow is byte-identical to
  before.
- Migration journal constants both at 26; lint/typecheck/tests green; replay +
  mock regressions green.
- §3 of this spec rewritten with W0's observed widget semantics before W3
  merges — a reviewer must be able to see the evidence, not take the mapper's
  word.
