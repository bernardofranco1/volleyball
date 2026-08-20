# spec/43 — Serve succession: enforce the rule, arbitrate with the serve action

**Status: SHIPPED 2026-08-20.** No migration. Everything empirical below was
measured against VIS with read-only requests; nothing is assumed.

Prerequisite reading: spec/42 **including its 2026-08-20 correction note**
(the rotation stabiliser, the shadow model, and `vis_rotation_log`), spec/37
(cadence), spec/34 (the VIS client and its READ-ONLY guard — the reason it
exists is incident 2026-07-29; **never send a request whose Type does not
start with `Get`**).

---

## 1. The owner decision this spec records

spec/42 deliberately did NOT override the feed's rotation on screen, because
the model had no ground truth to arbitrate with and the measured evidence
looked like one bad feed in four matches. Both of those have changed, and the
second one changed in an unexpected direction:

1. The feed carries a per-rally ground truth we were not fetching: the first
   `<Action>` of every rally is the serve and names the actual server (§2).
2. **The feed was not the problem.** With that ground truth in hand, the feed's
   published lineups turn out to be correct on all 540 rallies of all four
   reference matches. spec/42's nine divergences were caused by its own
   inferred first server (see its correction note). So enforcement is not
   adopted to overrule a bad feed.

**Decision: the displayed rotation now obeys the serve-succession rule.** Not
because the feed is wrong, but because the rule needs no lineup at all:

- **It is a rally ahead.** VIS publishes a rally's `LineUp` only once that
  rally has ended, so the newest lineup available is always the PREVIOUS
  rally's. spec/42 patched that with a side-out step inferred from the score;
  the model derives the current rotation outright.
- **It is immune to the rewrite window.** The feed rewrites a rally's lineup
  for seconds afterwards (spec/42, measured live, and now directly observable
  via the `Version` handshake). A model derived from the score and the serve
  actions has nothing to flicker.
- **The first server is read, never inferred** — which is what actually went
  wrong before.
- **It is provably the same answer.** On four complete matches the enforced six
  is identical to the feed's, position for position, on every rally
  (§8.1). Enforcement is not a second opinion; it is the same opinion, held
  earlier and for better reasons.

The feed's per-rally `LineUp` stops being the source of the displayed ORDER; it
remains the source of MEMBERSHIP (who is on court), which explicit
`<Substitution>` events carry in full — including every libero entering the
court, which is delivered as an ordinary substitution.

## 2. The rule, exactly as it must be encoded

For consecutive rallies `n`, `n+1` of one set:

- **R1 — serve retained.** If the team serving rally `n` wins it, the same
  player serves rally `n+1` — unless a `<Substitution>` event between the two
  rallies replaced that player, in which case the incoming player serves.
- **R2 — side-out.** If the receiving team wins rally `n`, that team rotates
  one place (position 2 becomes position 1) and the player who stood at
  **position 2 during rally `n`** serves rally `n+1` — unless a
  `<Substitution>` between the rallies replaced that player, in which case the
  incoming player serves.
- **R3 — libero.** A libero never serves (FIVB 19.3.2.1): a libero at
  position 1 of the SERVING side is always wrong. A libero at position 1 of
  the RECEIVING side is **legal and really happens** (verified: 27550 set 1
  rally 13 has libero 232497 at P1 while receiving) — do not "fix" it.

There is no other exception. In particular: a libero exchange is delivered as
a `<Substitution>` event exactly like a bench substitution (verified: 27550
set 1, libero 227953 in for 212796 is a `<Substitution>` row), so the
"unless sub'd" clause already covers libero exchanges with no special case.

**Which players R3 binds** — a trap that cost real debugging time. "Libero" for
this rule means the liberos DESIGNATED for the set, from the set's own
`LineUp@NoLibero1/2`. It does NOT mean the roster's
`VolleyballPlayer@IsLibero`, which is a player's listed position: teams register
3-4 such players and designate 1-2 per set, and an undesignated one plays as an
ordinary substitute. Match 27547 set 1 registers 228092 as `NoSubstitute2`,
brings him on for 232273, rotates him to position 1, and he **serves rally 41** —
which the feed records and which a roster-flag reading calls impossible. Reading
the wrong source made the model refuse four otherwise valid lineups.

**The arbiter — and the correction that measurement forced.** The rule
predicts; the recorded serve is the evidence. The first `<Action>` child of a
`<Rally>` is the serve (540 of 540 rallies carry `Skill="4"` first) and its
`NoPlayer` is the player who ACTUALLY served.

The first draft of this spec said "reality always wins: re-anchor the model on
the observed server". **Measuring that policy against the four matches proved
it harmful**, and the corrected rule below is what must be implemented.

Run as specified in §6 — seed from the set's starting lineup, apply
`<Substitution>` events in place, rotate on side-out, no arbitration at all —
the model predicts the recorded server in **539 of 540 rallies**, with **zero
membership drift** and **zero substitutions whose outgoing player was not on
court**. The single miss is 27550 set 1 rally 15 (§3), and there the model and
the feed's own published lineup AGREE with each other while only the serve
differs. Blindly following that serve rotates the model two places, and it
then mispredicts the rest of the set (verified: it breaks the very next serve
by that team, rally 17).

So the arbitration rule is **the observed server wins only when the model
stands alone**, classified per mismatching rally:

| classification | condition | action |
|---|---|---|
| `feed-agrees` | the feed's rally lineup has the OBSERVED server at position 1 | the model is out of sync → **re-anchor** on the observed server |
| `three-way` | model, feed and serve all disagree | the serve is the best evidence → **re-anchor** |
| `model-alone` | the feed's rally lineup has the PREDICTED server at position 1 (model and feed agree; only the serve differs) | an on-court wrong-server fault or a scouting slip → **do NOT re-anchor**, log `serve-anomaly` |

Two independent sources agreeing beat one anomalous observation; one source
standing alone loses to an observation. Under this policy the model survives
rally 15 and mispredicts nothing in the 115 rallies that follow.

This is what makes "no exceptions" implementable rather than wishful: the rule
is never bent for feed noise (the nine stale lineups of 27550 never touch the
model, because the model does not read the feed's order at all), and never
allowed to out-argue a serve that two sources do not contradict.

## 3. The evidence (measured 2026-08-20, keep for posterity)

Cross-checking every consecutive-rally transition in the full event streams
(`GetVolleyLive Options="65535"`) of the four matches spec/42 studied:

| match | R1 ok | R1 via sub | R1 violations | R2 ok | R2 via sub | R2 violations |
|---|---|---|---|---|---|---|
| 27550 | 41 | 0 | **1** | 80 | 5 | 0 |
| 27547 | 48 | 0 | 0 | 81 | 7 | 0 |
| 27549 | 59 | 0 | 0 | 79 | 2 | 0 |
| 26959 | 44 | 0 | 0 | 77 | 4 | 0 |

The single "violation": 27550 set 1, rally 15 — after 232492 (serving) won
rally 14, the recorded server of rally 15 is 232496, who stood at P3, with no
substitution and no rotation in the lineup. Almost certainly a wrong-server
fault called on court: the point went to the OPPONENT (5-9 → 6-9), which is
exactly what a wrong-server fault costs, and the rule resumes perfectly two
rallies later when 232500 — the previous position 2 — serves. This is the case
that proves the arbiter must be conditional rather than absolute.

**The model against the feed, and the correction to spec/42.** Running the §6
model over the same four completed matches and comparing its six with the six
VIS published, for BOTH sides on every rally — 1080 comparisons — yields
**zero divergences**. spec/42's nine were logged live, all in one set, all
carrying `confidence: inferred`, and all off-by-one with one team a place ahead
and the other a place behind: its `inferFirstServer` had picked the wrong side.
Re-running spec/42's own `auditSet` over the completed payload reports nothing
at all. So the feed's settled rotation is trustworthy; what is not trustworthy
is a first server that has been guessed, and bit 1 removes the need to guess.

Also verified the same day:

- **`GetVolleyLive` honours the `Version` handshake**: resend the root
  `Version` you last received and the answer is `<Responses><NoChanges /></Responses>`
  (~0.1 KB, vs ~91 KB for the full 2584 payload). An *older* version returns
  the full snapshot again (there is no delta format). This is load-bearing for
  §4.
- **Options bit 1** adds the Events stream: `<Rally>` children
  `<Action Identifier NoPlayer Skill Note?>` and per-rally `<LineUp>`;
  `<Substitution Identifier TimeOffset NoPlayerIn NoPlayerOut>` appearing both
  as a direct child of `<Set><Events>` (between rallies) and as a child of
  `<Rally>`; `<Timeout>`, `<ChallengeRequest>`, `<ChallengeResult>`,
  `<TeamPoint NoTeam Note>`. Sizes for a 3-set match: 2584 ≈ 95 KB,
  2585 ≈ 160 KB — offset in practice by `<NoChanges/>` on every quiet poll.
- Bits 4, 32, 64, 128, 1024, 4096 add nothing for indoor; 8192 is
  actions-without-interruptions. Nothing further to fetch.
- `Action@NoPlayer`, `LineUp@NoPlayer1..6`, `Substitution@NoPlayerIn/Out` and
  `Player@No` share one id space (federation roster numbers, e.g. 232500).
- Set-level `LineUp` additionally carries `NoLibero1/2` and `NoSubstituteN`.
- Skill enums observed indoor (match beach): 2 SET, 3 RECEPTION, 4 SERVE,
  5 DIG, 6 ATTACK; `Note="3"` on an action = that action scored the point.

## 4. Workstream A — the `Version` handshake

Files: `src/lib/vis-live/client.ts`, `src/lib/vis-live/store.ts`.

1. `volleyLiveEnvelope(matchNo, options = BOARD_OPTIONS, version = 0)` — third
   parameter, emitted as `Version="${version}"`.
2. The store's per-match board entry (`Entry<VisBoardData>`) gains
   `visVersion: number` (0 when unknown) and `rawXml`-derived fields it
   already computes. On each live poll send the stored `visVersion`.
3. Response handling in `getBoard`:
   - `<NoChanges />` (detect with `/<NoChanges\s*\/>/`): keep the cached
     `value` **unchanged**, set `at = Date.now()` (the read is fresh), leave
     `changedAt` alone, recompute `ttlMs` from the cached board's state, and
     **skip the whole parse/stabilise/audit pipeline** — there is nothing new
     to feed it. Serve the entry.
   - A full payload: parse as today, then store the new root `Version`
     (attribute on `<VolleyLive>`; if absent, store 0 so the next poll asks
     for everything).
   - Never treat `<NoChanges/>` as an error: confirm it does not match the
     soft-error regex in `client.ts` (it does not — add the unit test anyway).
4. A **Version bump while the latest set's rally count is unchanged** is the
   feed rewriting an already-recorded rally — the exact phenomenon spec/42's
   stabiliser papers over with the seen-twice heuristic. Pass this fact into
   the display layer (§6 fallback) so "the feed is mid-write" is an observed
   state, not a guess.
5. `visStoreSnapshot` (status page): add `visVersion` per board row. The
   status page may show it; not required.

Do NOT let `<NoChanges/>` reset `changedAt` — the frozen-feed detector of
spec/41 depends on `changedAt` meaning "the score actually moved".

## 5. Workstream B — fetch and parse the event stream

Files: `src/lib/vis-live/client.ts`, `src/lib/vis-live/parse.ts` (or a new
`events.ts` if parse.ts stays generic).

1. `BOARD_OPTIONS`: 2584 → **2585** (adds bit 1). Update the bitmask comment
   block with the measured facts from §3.
2. New parser producing, for ONE set's `Events` inner XML, a document-order
   walk (the existing `allTagAttrs`/`tagBlocks` string helpers are the house
   style — no new XML library):

   ```ts
   export interface SetEvents {
     rallies: {
       index: number;              // 1-based within the set
       scoreA: number; scoreB: number;
       winner: "A" | "B" | null;   // score delta vs previous rally
       server: string | null;      // NoPlayer of the FIRST <Action>, null if no actions
       lineup: { A: Six | null; B: Six | null }; // the rally's own <LineUp> children
       subsBefore: { out: string; in: string }[]; // Substitutions since the previous rally
     }[];
   }
   ```

   "subsBefore" collects `<Substitution>` elements that appear (a) as direct
   `Events` children between the previous `<Rally>` and this one, and (b) as
   children of this `<Rally>` itself — both placements occur in real data.
   Team attribution of a substitution is derived from the roster (both players
   of a sub belong to one team); build the roster map from the `Team > Player`
   blocks as `liberosOf` already does.
3. Reuse `ralliesOf` from `rotation.ts` for the score walk or fold it in —
   do not duplicate the omitted-zero handling (`num` defaults).

## 6. Workstream C — the enforcement model (`serve-succession.ts`, new)

A **pure, stateless-per-payload** function — recomputed from the full set
stream on every poll, so a feed rewrite (challenge overturning a point,
corrected score) self-corrects with no cross-poll drift:

```ts
export interface EnforcedLineups {
  A: Six | null;                // roster numbers, position 1 first
  B: Six | null;
  basis: "enforced" | "fallback";
  notes: EnforcementNote[];      // everything worth logging, see §7
}
export function enforceLineups(opts: {
  events: SetEvents;
  startingLineups: { A: Six | null; B: Six | null }; // Set > LineUp (pre-Events)
  liberos: ReadonlySet<string>;
  firstServer: Side | null;      // resolution order in step 1
  servingSideNow: Side | null;   // Set@NoServingTeam mapped to a side
}): EnforcedLineups
```

Algorithm (per side, then combined):

1. **First server resolution**, in priority order: (a) the remembered
   pre-first-rally observation (`noteFirstServer`, keep it); (b) the team of
   rally 1's serve action — with bit 1 this is available on ANY instance once
   one rally exists, warm or cold; (c) spec/42's dual-hypothesis inference
   (`inferFirstServer`) as the last resort for payloads that arrive without
   actions. If all three fail → `basis: "fallback"`.
2. **Seed** each side's six from `startingLineups`. Missing a starting lineup
   → `basis: "fallback"`.
3. **Walk rallies 1..n in order.** Before rally `r`: apply `r.subsBefore` to
   the current six (replace `out` with `in` in place — position preserved;
   if `out` is not in the six, note `"sub-target-missing"` and reseed
   membership from `r.lineup` for that side, keeping the model's ORDER by
   rotating the feed lineup so the model's predicted server is at P1 if
   present). Then apply rotation: using the winner sequence walked so far
   (identical semantics to `rotationsBefore`), if this side won a side-out to
   serve rally `r`, rotate once. The six now standing is the model's lineup
   FOR rally `r`.
4. **Arbitrate rally `r` with its serve action**, under the measured policy of
   §2 (the observed server wins only when the model stands alone). If
   `r.server` is present and the serving side's model P1 ≠ `r.server`,
   classify against the feed's own lineup for that rally
   (`r.lineup[servingSide]`):
   - **`model-alone`** — the feed's P1 equals the model's P1: the serve is the
     outlier. Note `"serve-anomaly"`, change NOTHING, walk on.
   - **`feed-agrees` / `three-way`** — re-anchor:
     - if `r.server` sits at index `k` of the model's six, rotate the six `k`
       places so it is at P1, and note `"reanchor-rotation"`;
     - if `r.server` is not in the model's six at all (an unrecorded personnel
       change), reseed that side from `r.lineup` (order included) and note
       `"reanchor-reseed"`.
   Note that 27550's nine stale lineups never reach this step: the model does
   not read the feed's order, predicts those servers correctly, and so never
   mismatches. Measured frequency of this whole step firing: 1 rally in 540.
5. After the last recorded rally, apply any trailing `subsBefore`-style
   substitutions (document-order events after the final `<Rally>`) and, if the
   last rally was a side-out for a side, that rotation — producing the lineup
   for the rally IN PROGRESS. This is what the board displays.
6. **R3 belt-and-braces**: if the serving side's final P1 is a libero, do not
   emit it — return `basis: "fallback"` for that side and note
   `"libero-serving-refused"`. (Given steps 3–5 this should be unreachable;
   the note existing in the log is itself a defect signal.)

Fallback semantics: `basis: "fallback"` (whole result or one side) means the
display layer uses today's behaviour — the feed lineup through
`stabiliseLineups` — for that side. **A board must never blank or throw
because enforcement lacked input.** `lineup-stability.ts` is therefore kept,
demoted to the fallback path, and its libero-on-serve guard stays as the last
line of defence.

## 7. Workstream D — display integration and the adjudicated log

Files: `src/lib/vis-live/store.ts`, `src/lib/vis-live/board-data.ts`,
`src/lib/vis-live/rotation-audit.ts`, `scripts/rotation-log.ts`.

1. In `getBoard` (full-payload branch): parse `SetEvents` for the latest set,
   call `enforceLineups`, and pass the result into the board build.
   Integration point: extend `mapVolleyLive` with an optional
   `lineupOverride?: { A: Six | null; B: Six | null }` — it already takes
   `firstServer` (spec/42), same pattern. Where the mapper today picks the
   newest rally `LineUp` to seat the six, an override side replaces that
   side's order/membership; jersey/name/isLibero still come from the roster
   exactly as now. `stabiliseLineups` is then applied ONLY to sides the
   override left null.
2. The ball/serve marker keeps its existing rule (P1 of the serving side) —
   enforcement now guarantees that IS the actual server.
3. **Log adjudication instead of bare divergence.** `rotation-audit.ts` keeps
   its shape (same table, no migration — `kind` is free text) and gains
   kinds, all written through the existing once-per-key machinery:
   - `"reanchor-rotation"`, `"reanchor-reseed"`, `"serve-anomaly"`,
     `"sub-target-missing"`, `"libero-serving-refused"` — from
     `EnforcementNote`s, with the model six in `modelSix` and the feed's rally
     lineup in `feedSix`. The observed and predicted servers go in
     `confidence` as `"<kind>:<observed>≠<predicted>"` — do NOT add columns.
   - `"feed-wrong-confirmed"` / `"model-wrong-confirmed"`: when the spec/42
     shadow comparison finds feed ≠ model for a recorded rally AND that
     rally's serve action exists, the action adjudicates: whichever party has
     the server at P1 was right; log the verdict once. This turns the shadow
     log into the evidence base spec/42 asked for.
   - Existing kinds (`"rotation"`, `"libero-serving"`) keep their meaning.
4. `scripts/rotation-log.ts`: group and print the new kinds; a summary line
   per match of the form `enforced overrides: N (rotation M, reseed K)`.
5. The whole enforcement + audit call remains inside the fire-and-forget,
   swallow-everything discipline of spec/42 for the LOG; the enforcement of
   the DISPLAY runs in the request path but must be defensive: any thrown
   error inside `enforceLineups` → caught → `basis: "fallback"`. A board
   must not be taken down by its own cleverness.

## 8. Tests (all offline — fixtures, never live VIS)

Fixture source: the four full captures already exist as scratch files; the
implementing agent regenerates them with a one-off read-only script (model it
on `scripts/gen-vis-mock.mjs`; `GetVolleyLive Options="65535"`; matches
27550, 27547, 27549, 26959) and embeds ONLY the needed set streams as test
fixtures (trim `PlayerStatistics`/`TeamStatistics` — they are irrelevant here
and huge).

Required cases, each asserting through the public API of the module:

1. **The property test that IS the rule (the acceptance test):** for every
   rally with a serve action in all four matches, run `enforceLineups` on the
   stream truncated to the rallies before it — the serving side's P1 must
   equal that rally's recorded server. **539 of 540 rallies, with exactly one
   enumerated exception**: 27550 set 1 rally 15, the on-court wrong-server of
   §3, which no model can predict. The test names that one rally explicitly
   and fails if the count of unexplained misses is not zero, so a regression
   cannot hide inside a tolerance.
   A companion assertion covers the anomaly's aftermath: with rally 15
   recorded, the model does NOT follow the anomalous serve (`serve-anomaly`
   note, `model-alone`), and rally 17's serve — the same team's next — is
   still predicted correctly.
1b. **The safety property that permits it on an arena screen:** over the same
   four matches, both sides, every rally (1080 comparisons), the enforced six
   is IDENTICAL to the six VIS published, position for position. Enforcement
   changes nothing while the feed is settled; it earns its place only where the
   feed has not settled yet. A future change that made the model diverge from a
   completed feed would fail this test, and should.
2. R1 plain: serve-win → same server, no rotation of either side.
3. R1 via sub: serve-win + substitution replacing the server → incoming
   player at P1 (build from a real via-sub transition in 27547).
4. R2 plain: side-out → previous P2 at P1 (real transition).
5. R2 via sub: side-out where previous P2 was substituted in the gap → the
   incoming player serves (real transition — there are 18 to choose from).
6. Libero at P1 of the RECEIVING side (27550 set 1 rally 13) → left alone,
   no note, no "fix".
7. Libero exchange delivered as Substitution → membership updated, no
   rotation, no divergence note.
8. Wrong-server on court (27550 set 1 rally 15) → `"serve-anomaly"` note,
   classification `model-alone`, model unchanged; and the assertion that
   rally 17's server (232500, the same team's next serve) is still predicted
   correctly — the regression test for the re-anchoring policy of §2.
9. Score rewrite self-correction: take a stream, flip the winner of a late
   rally (simulating a challenge overturn), re-run → output consistent with
   the corrected winner sequence, no residue from the first run (purity).
10. Cold instance mid-set with actions present → first server from rally 1's
    serve action, `confidence` reflecting it.
11. Payload without actions (Options regression) → `basis` still `"enforced"`
    is NOT required; fallback path drives, stabiliser behaviour byte-identical
    to today's (reuse the spec/42 stabiliser tests as the harness).
12. `<NoChanges/>`: store serves the cached board, `at` refreshed,
    `changedAt` untouched, no parse attempted, next envelope carries the
    stored Version; and a Version bump with unchanged rally count is exposed
    to the stability layer.
13. Client: `<NoChanges/>` does not trip the soft-error regex; the READ-ONLY
    guard still rejects non-Get envelopes (do not weaken it while editing).

## 9. Acceptance criteria

- `BOARD_OPTIONS === 2585`; live polls send the last seen Version; quiet
  polls are answered upstream by `<NoChanges/>` (verify once manually against
  a real live match and note the observed sizes in the PR).
- Test §8.1 green — 539/540 predicted, one enumerated exception, no tolerance.
- All existing spec/42 tests still green (stabiliser, rotation model, audit
  write-once).
- `vis_rotation_log` gains only new `kind` VALUES — **no migration**. (If you
  believe you need a migration, stop: re-read §7.3. If a migration truly
  becomes necessary, the journal-index rule applies: bump BOTH
  `MIGRATION_JOURNAL_IDX` in backup-policy.ts and `KNOWN_JOURNAL_IDX` in
  restore-backup.mts — a test enforces it.)
- Lint, typecheck, 711+ unit tests, e2e — all green in CI before promote.

## 10. Standing hazards for the implementing agent

- **READ-ONLY VIS, always.** Only `Get*` requests. The guard in `client.ts`
  is not decoration; incident 2026-07-29 destroyed a production match.
- `.env.local` points local scripts at the homolog schema; anything meant for
  production is prefixed `DB_SCHEMA=public` (AGENTS.md).
- Instrumentation swallows failures; the display path degrades to fallback,
  never to a blank board.
- Module-level caches are per serverless instance — do not add cross-instance
  assumptions.
- Do not add `loading.tsx` files (Next 16.2.9 wedge, see memory/AGENTS notes).
- The boards ship from the board-host deployment
  (`fivb-live-scoreboards.vercel.app`); the main app promote is a separate,
  deliberate console step.
