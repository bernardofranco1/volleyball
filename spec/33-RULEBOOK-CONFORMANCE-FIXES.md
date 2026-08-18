# spec/33 — FIVB 2025–2028 Rulebook Conformance Fixes

Implementation instructions for the five must-fix findings (F1–F5) of the
2026-08-18 rulebook audit, plus five optional advisories (A1–A5). Written to be
executed by an implementer with no prior context. **Read "Ground rules" fully
before touching any file** — every past incident in this repo came from
skipping one of them.

Audit sources (all rule quotes below are verbatim from these):

- Indoor: <https://www.fivb.com/wp-content/uploads/2025/01/FIVB-Volleyball_Rules2025_2028-EN-v05.pdf>
- Beach: <https://www.fivb.com/wp-content/uploads/2025/02/FIVB-BeachVolleyball_Rules2025_2028-EN-v01.pdf>

File/line references are anchored at commit `2d09b8e`. Line numbers drift;
the quoted code snippets are the real anchors — locate by content, not line.

---

## Ground rules (violating any of these is a rejected change)

1. **No new event types. No changes to persisted event payload shapes**, with
   exactly two additive exceptions authorized by this spec:
   - `ForfeitReason` gains the value `"INCOMPLETE_TEAM"` (F1).
   - No other payload change of any kind. Do NOT add fields to `SUBSTITUTION`,
     `LIBERO_REPLACEMENT`, etc.
2. **State-shape changes must be additive and optional.** Match/set state is
   persisted in `matches.state_snapshot` (jsonb) and reads are
   *snapshot + tail-replay*. Any new field you add to a set/match state type
   must be `?`-optional, initialized in `newSetState()` for NEW sets, and
   **lazily tolerated when absent** (old snapshots do not have it). Follow the
   existing pattern of `recoveriesByPlayer` in
   `src/engine/core/baseReducer.ts` (see its comment).
3. **Validation runs only at append** (`validate*Event` is never called during
   replay). Old event logs must replay byte-identically. If your reducer change
   would alter the replayed state of an EXISTING valid log, it is wrong —
   reducer changes here may only maintain NEW optional bookkeeping fields and
   fix the second-libero handling described in F4.
4. **UNDO/REWIND need no special handling.** Undo is implemented as replay of
   the surviving events; any bookkeeping you maintain in the reducer is rebuilt
   automatically. Do not write manual "decrement on undo" logic.
5. **No DB migration is needed for any of F1–F5.** Therefore do NOT touch
   `MIGRATION_JOURNAL_IDX` (backup-policy.ts) or `KNOWN_JOURNAL_IDX`
   (restore-backup.mts). If you believe you need a migration, you have
   misread this spec — stop.
6. **i18n:** every new user-visible string must be added to ALL FIVE locales
   (`en`, `fr`, `de`, `es`, `pt`) in `src/lib/i18n/messages.ts`. A key missing
   from one locale renders the raw key in production.
7. **`CLIENT_SUBMITTABLE`** in `src/app/api/matches/[id]/events/route.ts`
   stays untouched — no fix here introduces a new client-submitted type
   (`FORFEIT` and `SET_DEFAULT` are already listed).
8. **Engine purity:** everything under `src/engine/` stays pure (no I/O, no
   Date.now, no imports from lib/app). Shared logic goes in `src/engine/core/`.
9. **Verification gate** (all must pass before you are done):
   ```bash
   npx tsc --noEmit
   npm run lint        # 0 errors (5 pre-existing warnings are OK)
   npm test            # 713 tests at time of writing + your new ones
   ```
10. **Deploys:** pushing `main` builds a PREVIEW only. Production moves via the
    /admin release console (spec/28). Do not attempt to promote.
11. Tests live in `src/__tests__/engine/*.test.ts` (vitest). Follow the
    house test philosophy (spec/31): test the RULE, not the code shape — a
    regression test per finding, no mirror tests. Reuse the state-builder
    helpers already present in `indoor.test.ts` rather than inventing new ones.

---

## F1 — Expulsion/disqualification must not award a point; consequences are discipline-specific

**Rule.** Indoor D9a sanction scale and 21.3.2/21.3.3: only a PENALTY carries
"a point and service to the opponent". Expulsion ⇒ member out for the rest of
the SET; disqualification ⇒ rest of the MATCH — *"with no other
consequences"*. Indoor 15.8: the expelled/disqualified player *"must be
substituted immediately through a legal substitution. If this is not possible,
the team has the right to do an exceptional substitution. If this is not
possible, the team is declared INCOMPLETE."*
Beach D7a: expulsion ⇒ *"Team declared incomplete for the set"*;
disqualification ⇒ *"Team declared incomplete for the match"* (a beach pair
cannot substitute — the consequence is immediate and mandatory).

**Current behavior.** `src/components/scoring/shared/SanctionsControl.tsx`:

```ts
const PENALTY_KINDS: SanctionType[] = [
  "DELAY_PENALTY",
  "MISCONDUCT_PENALTY",
  "MISCONDUCT_EXPULSION",
  "MISCONDUCT_DISQUALIFICATION",
];
```

Because expulsion/disqualification are in `PENALTY_KINDS`, the step-2 modal
offers "award the point" after either card, and `sanctionAutoPoint: "AUTO"`
competitions award it automatically. Both are unearned points under the 2025–
2028 rules.

**Where it is mounted** (you must thread a `discipline` prop from all three):

- `src/components/scoring/IndoorScoreboard.tsx` (~line 173) → `"INDOOR"`
- `src/components/scoring/LiveScoreboard.tsx` (~line 274) → `"BEACH"`
- `src/components/scoring/shared/RotationScoreboard.tsx` (~line 243) →
  grass AND light both render through this one; thread the actual discipline
  through its props from its own callers (grep `RotationScoreboard` mounts).

**Required behavior.**

1. `PENALTY_KINDS = ["DELAY_PENALTY", "MISCONDUCT_PENALTY"]` — nothing else,
   in every discipline. This alone fixes the AUTO mode.
2. Step 2 after `MISCONDUCT_PENALTY` / `DELAY_PENALTY`: unchanged (offer the
   point to the opponent).
3. Step 2 after `MISCONDUCT_EXPULSION` / `MISCONDUCT_DISQUALIFICATION`: **no
   point button, ever.** Instead, by discipline:

   | Discipline | Expulsion step 2 | Disqualification step 2 |
   |---|---|---|
   | INDOOR | Explain 15.8 (substitute legally/exceptionally via the Sub panel). Offer armed `SET_DEFAULT` (reason `INCOMPLETE_TEAM`) labeled "team cannot substitute". | Same explanation; offer armed `SET_DEFAULT` **and** armed `FORFEIT` (reason `INCOMPLETE_TEAM`) labeled "team cannot field six for the match". |
   | BEACH | Mandatory: armed `SET_DEFAULT` (reason `INCOMPLETE_TEAM`) — the pair is incomplete for the set. Wording must say this is required, not optional. | Mandatory: armed `FORFEIT` (reason `INCOMPLETE_TEAM`) — incomplete for the match. |
   | GRASS / LIGHT | Keep the current generic offer (optional `SET_DEFAULT`), just without the point button. No rulebook authority exists for them (spec/32 §4). | Same. |

   Keep the "skip" link in all variants except beach, where skipping expulsion/
   disqualification consequences would leave an impossible score — still allow
   closing the modal (the scorer may need to fix something first) but keep the
   wording unambiguous that the default/forfeit must be recorded.

4. `SanctionDispatch` union: add
   `{ type: "FORFEIT"; team: TeamId; reason: "INCOMPLETE_TEAM" }`.
   The mounts already pass the match-context `dispatch`, which accepts FORFEIT
   (ForfeitControl uses the same path) — verify types compile, don't rewire.

**`ForfeitReason` extension** (the one authorized payload change):

- Add `"INCOMPLETE_TEAM"` to `ForfeitReason` in
  `src/engine/core/baseReducer.ts` AND to the inline
  `reason: "FORFEIT" | "RETIREMENT"` unions in all four
  `src/engine/{beach,indoor,grass,light}/types.ts` FORFEIT payloads.
- The reducer does not branch on `reason` — no reducer change.
- Update every print site so the new reason renders as "Incomplete team"
  instead of falling into the "Forfeit" else-branch. Find them ALL with:
  ```bash
  grep -rn '"RETIREMENT"' src --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v engine/
  ```
  At time of writing: `ScoringLog.tsx:141`, `match-report-pdf.ts:422`,
  `scoresheet/indoor-official.ts:522`, `scoresheet/remarks.ts:126`,
  `scoresheet/beach-official.ts:699`. Also check `ForfeitControl.tsx` — it may
  keep offering only FORFEIT/RETIREMENT (INCOMPLETE_TEAM arrives only via the
  sanctions flow); do not add a third button there.

**i18n:** new keys for the discipline-specific step-2 texts/buttons, ×5 locales.

**Acceptance tests** (component-level tests are not the house style; test what
is testable and verify the rest by running the console):

- Engine: none needed (no engine change beyond the type value).
- Manual/browser check: record an expulsion on an indoor and a beach match on
  homolog; confirm no point offer appears, the discipline-correct consequence
  buttons appear, and with `sanctionAutoPoint=AUTO` config no point is awarded.
- Unit: a test that replays a FORFEIT event with `reason: "INCOMPLETE_TEAM"`
  and asserts the match closes exactly like a RETIREMENT one (guards the type
  through the reducer path).

**Trap:** do not "fix" this by removing the point from `MISCONDUCT_PENALTY` —
penalties DO award a point and service (indoor 21.3.1 / beach 20.3.1).

---

## F2 — A used substitute must not enter a second slot (indoor 15.6.2; same model in grass/light)

**Rule (indoor 15.6.2).** *"A substitute player may enter the game in place of
a player of the starting line-up, but only once per set, and he/she can only
be substituted by the same starting player."*

**Current behavior.** `src/engine/indoor/validator.ts` (SUBSTITUTION case) and
the identical logic in `src/engine/grass/validator.ts` and
`src/engine/light/validator.ts`. The slot map `subSlots[starter] = subId`
records an open slot; when the starter returns, the code sets
`slots[starter] = null` — which erases the memory that `subId` was ever used.
Reproduced defect: S1 in for P1, P1 back in for S1, then **S1 in for P2
validates `{ok:true}`** — an illegal substitution (15.9.1).

**Required behavior.** After a substitute has entered once in a set (their
slot open OR already closed), any Case-A substitution bringing them in again
that set is refused. Exceptional (`isExceptional`) / emergency (`isEmergency`)
substitutions remain exempt (15.7 waives all of 15.6).

**Implementation.**

1. Add to each discipline set-state type (`IndoorSetState`, `GrassSetState`,
   `LightSetState`) and to `SubstitutionSetState` in
   `src/engine/core/baseReducer.ts`:
   ```ts
   /** Players who have entered as a substitute this set (open OR closed
    *  slot). Optional: snapshots written before spec/33 lack it. */
   usedSubsA?: string[];
   usedSubsB?: string[];
   ```
2. In `applySubstitution()` (`src/engine/core/baseReducer.ts`, currently
   ~line 423): whenever the incoming player is not in the team's `lineup`
   (i.e. is a substitute entering), record them:
   ```ts
   const used = p.team === "A" ? (set.usedSubsA ??= []) : (set.usedSubsB ??= []);
   if (!lineup.includes(p.inPlayerId) && !used.includes(p.inPlayerId)) used.push(p.inPlayerId);
   ```
   Note `??=` — this is the lazy-init required by Ground rule 2. Do this for
   ALL substitutions including exceptional ones (recording who entered is a
   fact; only the *validation* exempts exceptional).
3. Initialize `usedSubsA: []`, `usedSubsB: []` in each discipline's
   `newSetState()` so new sets carry the field.
4. In all three validators' SUBSTITUTION Case A (the branch that currently
   checks `slotForSub(slots, payload.inPlayerId) !== null`), ALSO refuse when
   the incoming player is in `usedSubs` for that team:
   ```ts
   const used = payload.team === "A" ? set.usedSubsA ?? [] : set.usedSubsB ?? [];
   if (used.includes(payload.inPlayerId))
     return fail("That substitute has already entered this set (Rule 15.6.2)");
   ```
   KEEP the existing `slotForSub` check as well — it still covers the
   open-slot case when `usedSubs` is absent (old snapshot mid-set).
5. Grass/light use `isEmergency` instead of `isExceptional`; their exemption
   branch (`if (payload.isEmergency) return OK;`) sits BEFORE the slot rules —
   leave that ordering as is.

**Acceptance tests** (add to `src/__tests__/engine/indoor.test.ts`, plus one
grass or light case to pin the shared model):

- Repro pinned: lineup P1..P6, bench S1,S2. SUBSTITUTION S1→for→P1 ok;
  P1→for→S1 ok; then S1→for→P2 **refused** with a 15.6.2 reason.
- Still legal: after the above, S2→for→P2 ok.
- Still legal: exceptional substitution of an already-used S1 is accepted
  (15.7 waives 15.6).
- Replay compatibility: replay an event log containing the previously-legal
  illegal sequence (build the events array directly) and assert replay does
  NOT throw and produces the same courts as before — replay never validates.

**Trap:** do not change the meaning of `subSlots` values (e.g. sentinel
strings). Snapshots and the sheet renderers read that map as-is.

---

## F3 — Enforce participation bans (indoor engine)

**Rules.**
- 21.3.2.1: expelled member *"shall not participate for the rest of the set"*.
- 21.3.3.1: disqualified member is out *"for the rest of the match"*.
- 15.7: *"The injured/ill/expelled player substituted via exceptional
  substitution is not allowed to re-enter the match."*
- 19.4.2.2: *"a Libero who is the subject of a re-designation may not play for
  the remainder of the match."*

**Current behavior.** None of `SUBSTITUTION`, `LINEUP_CONFIRMED`, or
`LIBERO_REPLACEMENT` in `src/engine/indoor/validator.ts` consults
`state.misconductA/B` (which already exist, with `setNumber` per record) or
any history of exceptional substitutions / re-designations. All four illegal
re-entries validate today.

**Implementation.**

1. New optional match-level bookkeeping on `IndoorMatchState`
   (`src/engine/indoor/types.ts`), maintained in the indoor reducer:
   ```ts
   /** Players substituted out via an exceptional substitution — barred for
    *  the match (Rule 15.7). Optional: pre-spec/33 snapshots lack it. */
   exceptionallyReplaced?: string[];
   /** Former liberos replaced by a re-designation — barred for the match
    *  (Rule 19.4.2.2). Optional: pre-spec/33 snapshots lack it. */
   retiredLiberos?: string[];
   ```
   - In the `SUBSTITUTION` reducer case: if `p.isExceptional`, push
     `p.outPlayerId` into `(s.exceptionallyReplaced ??= [])`.
   - In the `LIBERO_REDESIGNATION` reducer case: push the PREVIOUS
     `liberoIdA/B` (the one being replaced) into `(s.retiredLiberos ??= [])`
     before overwriting it.
   - Initialize both as `[]` in `initialIndoorState` (find it in
     `src/engine/indoor/types.ts`).
2. New pure helper in `src/engine/indoor/validator.ts` (or exported from the
   types module if the reducer needs it too — it does not):
   ```ts
   /** Why a player may not enter play right now, or null. */
   function participationBar(
     state: IndoorMatchState,
     team: TeamId,
     playerId: string,
     forSetNumber: number,
   ): string | null
   ```
   Checks, in order:
   - misconduct record of type `MISCONDUCT_DISQUALIFICATION` for this player
     (either team array — search the offender's team's array) → barred:
     `"disqualified (Rule 21.3.3.1)"`.
   - `MISCONDUCT_EXPULSION` record with `record.setNumber === forSetNumber`
     → barred: `"expelled for this set (Rule 21.3.2.1)"`. **An expulsion in an
     EARLIER set does not bar later sets — compare set numbers.**
   - `state.exceptionallyReplaced?.includes(playerId)` → barred (15.7).
   - `state.retiredLiberos?.includes(playerId)` → barred (19.4.2.2).
3. Enforce it:
   - `SUBSTITUTION` (both regular AND exceptional paths — a barred player may
     never enter): bar check on `payload.inPlayerId` with
     `forSetNumber = state.currentSetNumber`.
   - `LINEUP_CONFIRMED`: bar check on every id in `payload.playerIds`,
     `payload.liberoId`, `payload.secondLiberoId`. `forSetNumber` here is the
     set the lineup is FOR: when a set is open and collecting
     (`rallyPhase === "LINEUP_PENDING"`) that is `state.currentSetNumber`;
     when stashing pre-set (no open set / set has a winner) it is
     `state.currentSetNumber + 1` — which only matters for the expulsion
     check, and an expulsion never bars a later set, so the simple rule is:
     apply the expulsion bar ONLY in the collecting case.
   - `LIBERO_REPLACEMENT` direction IN: bar check on `payload.liberoId`.
4. Beach requires no engine change: a pair has no substitutions or lineups —
   the F1 console consequences (set default / forfeit) are the enforcement.

**Acceptance tests** (`src/__tests__/engine/indoor.test.ts` or a new
`indoor-participation.test.ts`):

- Expelled in set 2 → SUBSTITUTION bringing them in during set 2 refused;
  LINEUP_CONFIRMED for set 3 including them ACCEPTED.
- Disqualified in set 1 → set 2 lineup including them refused; substitution
  in any set refused.
- Player exceptionally substituted out in set 1 → set 2 lineup with them
  refused.
- After LIBERO_REDESIGNATION, old libero in a later lineup (as a court
  player) refused; and as `liberoId` refused.
- Old-snapshot tolerance: state object without the two new arrays validates
  a substitution without throwing.

**Trap:** misconduct arrays are on the MATCH state (`misconductA/B`), not the
set. Each record already carries `setNumber` — use it; do not try to derive
set from event order.

---

## F4 — Second libero: declare, operate, swap (indoor)

**Rules.** 19.1.1: up to two liberos; **two are mandatory** in FIVB senior
events with >12 players on the sheet. 19.3.2.2: *"The Acting Libero can only
be replaced by the regular replacement player for that position or by the
second Libero."* 19.1.3: only one libero on court at a time; the one on court
is the Acting Libero.

**Current behavior.**
- Engine state models both (`liberoIdA/B`, `secondLiberoIdA/B`) and validator
  helper `liberoIdsFor()` accepts either — but:
- `src/components/scoring/IndoorLineupEntry.tsx` (~line 151) and
  `src/components/tablet/TeamTablet.tsx` (~line 481) hardcode
  `secondLiberoId: null` — it can never be declared.
- `LiberoPanel` in `src/components/scoring/IndoorActionBar.tsx` reads only
  `set.libero.liberoIdA/B` — libero #2 is inoperable.
- Validator `LIBERO_REPLACEMENT` direction `IN` fails with "Libero is already
  on court" whenever any libero is on — the 19.3.2.2 libero-for-libero swap is
  impossible.
- **Latent bug you must fix while here:** `enforceLiberoLegality()` in
  `src/engine/indoor/reducer.ts` (~line 174) resolves the libero as
  `set.libero.liberoIdA/B` only. If the SECOND libero were acting, rotation
  into the front row would never auto-remove them.

**Key design fact:** the acting libero is always derivable — it is whichever
designated libero id is present in `courtPositions`. Use a small helper; do
NOT add an `actingLibero` state field (Ground rule 2 — avoid state you can
derive).

```ts
/** The designated libero currently on court for `team`, or null. */
function actingLibero(set: IndoorSetState, team: TeamId): string | null
```

**Implementation — engine** (`src/engine/indoor/{validator,reducer}.ts`):

1. `enforceLiberoLegality`: replace the `liberoId` lookup with
   `actingLibero(set, team)`; the rest of the routine already works off the
   court index.
2. Validator `LIBERO_REPLACEMENT`, direction `IN`, when a libero IS on court:
   currently a hard fail. New rule: **allow if and only if**
   `payload.outPlayerId === actingLibero(set, team)` AND `payload.liberoId`
   is the team's OTHER designated libero (both from `liberoIdsFor`). The
   completed-rally gate (`ralliesPlayed <= lastRally`) applies to the swap
   exactly as to any replacement. All other on-court cases keep failing.
3. Reducer `LIBERO_REPLACEMENT`, direction `IN`: detect the swap case
   (outgoing player is a designated libero). For a swap:
   - `swapOnCourt(court, p.outPlayerId, p.liberoId)` as usual;
   - **`liberoReplacing` stays UNCHANGED** — the regular replacement player
     for that position is still the original court player. This is the single
     easiest detail to get wrong; a test below pins it.
   - `liberoOnCourt` stays `true`; update `lastLiberoRally` as usual.
4. Validator direction `OUT`: require `payload.liberoId ===
   actingLibero(set, team)` (today it accepts either designated id; after two
   liberos exist that is ambiguous).
5. Validator `LINEUP_CONFIRMED`: currently checks only `liberoId` not among
   the starting six. Add: `secondLiberoId` not among the six, and
   `secondLiberoId !== liberoId`.

**Implementation — console/tablet:**

6. Config: in `src/engine/config.ts` set INDOOR `liberoCount: 2` (the rule
   grants up to two unconditionally; 1 was an arbitrary cap). Gate all
   second-libero UI on `config.liberoCount >= 2`.
7. `IndoorLineupEntry.tsx` and the tablet `LineupForm` in `TeamTablet.tsx`:
   add an optional second-libero select (same candidate pool as libero #1,
   minus the chosen libero #1), replacing the hardcoded `null`.
8. `LiberoPanel` (`IndoorActionBar.tsx`): operate on the ACTING libero
   (derive as in the engine). When no libero is on court and two are
   designated, let the scorer choose which enters. When one is on court and a
   second exists, offer "switch liberos" (dispatches `LIBERO_REPLACEMENT`
   direction `IN` with `outPlayerId` = acting libero, `liberoId` = the other).
   The redesignation section's candidate filter already excludes `liberoId` —
   extend it to exclude BOTH designated liberos.
9. Sub-exclusion lists already include the second libero everywhere
   (`liberoIdsOf` in `IndoorActionBar.tsx`, `TeamTablet.tsx`) — verify, don't
   duplicate.

**i18n:** labels for the second-libero select and the swap button, ×5 locales.

**Acceptance tests:**

- Swap accepted: L1 on court (replacing P5) + completed rally since → IN with
  `outPlayerId=L1, liberoId=L2` validates; after reduce, court contains L2
  not L1, `liberoReplacingA` is STILL P5, `liberoOnCourtA` true.
- OUT after swap: returning player must be P5 (the original), and the
  outgoing libero id must be L2 (acting) — OUT with `liberoId=L1` refused.
- Swap without a completed rally since the last replacement: refused.
- IN while a libero is on court with `outPlayerId` = an ordinary back-row
  player: still refused ("already on court").
- Rotation carries ACTING SECOND libero to front row → auto-removed, P5
  returns (pins the `enforceLiberoLegality` fix).
- Lineup with `secondLiberoId` inside the starting six, or equal to
  `liberoId`: refused.

---

## F5 — Exceptional substitution must exclude the libero's regular replacement player (indoor 15.7)

**Rule.** *"…any player who is not on the court …, except the Libero, second
Libero **or their regular replacement player**, may be substituted into the
game…"*

**Current behavior.** `src/engine/indoor/validator.ts`, SUBSTITUTION case: the
exceptional branch (`if (payload.isExceptional) return OK;` after the physical
checks) excludes only the designated liberos via `liberoIds`. While a libero is
on court, the player they replaced (`set.libero.liberoReplacingA/B`) is off
court and passes — the rule forbids exactly that player.

**Implementation.** Immediately before `if (payload.isExceptional) return OK;`
add:

```ts
const replacing =
  payload.team === "A" ? set.libero.liberoReplacingA : set.libero.liberoReplacingB;
if (payload.isExceptional && replacing && payload.inPlayerId === replacing)
  return fail(
    "That player is the libero's replacement player and cannot be used for an exceptional substitution (Rule 15.7)",
  );
```

When the libero is off court, `liberoReplacing` is null and nothing changes.
(F3's bar check on `inPlayerId` also runs on this path — both apply.)

**Acceptance test:** L1 on court replacing P5; exceptional substitution with
`inPlayerId=P5` refused; with `inPlayerId=S2` (ordinary bench player)
accepted; after L1 exits (P5 returns), exceptional sub of some OTHER injured
player by S2 still accepted.

---

## Advisories A1–A5 (optional; implement only if asked)

- **A1 — Delay sanctions are per MATCH** (16.2.1.1 both books; first delay =
  warning, all subsequent = penalty). The per-set `delaySanctionsA/B` counters
  are consumed by nothing. If implemented: add optional match-level
  `delayCountA/B?: number` maintained in `reduceCommon`, leave the per-set
  fields untouched (snapshot compat), and add a SanctionsControl hint: when
  the team already has a delay on record and the scorer picks DELAY_WARNING,
  show the amber warn-only banner ("the rulebook escalates the second delay to
  a penalty — 16.2.3"). Never block.
- **A2 — Discipline-aware misconduct escalation hint.** Beach D7a: rude
  conduct scales per SET (penalty, penalty by the same player, expulsion on
  the third — resetting each set). Indoor D9a scales per MATCH (penalty,
  expulsion, disqualification). Today's warning compares match-wide worst
  severity and misfires for beach. Fold into the F1 work: for BEACH, compare
  within the current set and warn only on same-severity third-plus.
- **A3 — Repeat improper request = delay** (indoor 15.11.3, beach 15.5.5).
  Hint-only, in SanctionsControl: if the team already has an
  `IMPROPER_REQUEST` event this match, picking it again shows the amber note
  that this one is a delay. Requires threading a small count into the mounts
  (derive from the events already loaded by `ScoringLog`, or add a counter to
  common state as optional field). Also delete the stale "max one per team
  per match — UI-enforced" comment in `src/engine/core/baseReducer.ts`.
- **A4 — 19.3.2.1 exception paths.** The completed-rally gate should not
  apply when a penalty forced rotation moving the libero to position 4, or
  when the acting libero is declared unable to play. Smallest honest version:
  allow the redesignation/replacement flows the LiberoPanel exposes to pass a
  gate-waiver only in the "libero unable" path (which already goes through
  redesignation) and leave the penalty-rotation case to the referee. Document
  whatever subset you implement in this file.
- **A5 — 15.2.3** (completed rally between separate substitution REQUESTS of
  the same team) is not distinguishable in the event model (one event per
  player; a same-request pair looks identical to two requests). Documented
  decision: referee territory. No code.

---

## Final checklist (do these in order, tick every box)

- [ ] F1: `PENALTY_KINDS` reduced to the two penalties.
- [ ] F1: `discipline` prop threaded from all THREE mounts (indoor, beach,
      rotation/grass+light).
- [ ] F1: step-2 consequences per the table; no point button on
      expulsion/disqualification anywhere, including AUTO mode.
- [ ] F1: `ForfeitReason` + four types files + all print sites from the grep +
      i18n ×5.
- [ ] F2: `usedSubs` optional fields + `??=` lazy init + `newSetState` init,
      in indoor AND grass AND light; validators refuse re-entry; exceptional/
      emergency exempt; replay-compat test.
- [ ] F3: `exceptionallyReplaced` + `retiredLiberos` optional fields;
      `participationBar()` enforced in SUBSTITUTION, LINEUP_CONFIRMED,
      LIBERO_REPLACEMENT; expulsion bars its own set only.
- [ ] F4: acting-libero derivation (no new state field);
      `enforceLiberoLegality` fixed; swap IN/OUT rules; lineup validation for
      the second libero; both lineup UIs + LiberoPanel; INDOOR
      `liberoCount: 2`.
- [ ] F5: `liberoReplacing` excluded from exceptional substitutions.
- [ ] Every new user-visible string exists in en, fr, de, es, pt.
- [ ] No new event types; no payload changes beyond `INCOMPLETE_TEAM`;
      `CLIENT_SUBMITTABLE` untouched; no migration files;
      `MIGRATION_JOURNAL_IDX` untouched.
- [ ] `npx tsc --noEmit` clean; `npm run lint` 0 errors; `npm test` green
      including all new regression tests listed above.
- [ ] Do not deploy to production; push to `main` builds a preview only.
