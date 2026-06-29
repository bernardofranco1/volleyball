# 16 — Rule-Engine Audit vs Brief Appendix A (§8)

Reconciliation of the implemented engines (`src/engine/{beach,indoor,grass,light}`
+ `src/engine/config.ts`) against the brief's **Appendix A** (Indoor, Beach,
Air/Light). Appendix A maps `air_light_volleyball` → the app's `LIGHT` discipline.
Per the plan, §8 is a **validation** task: the engine is already built, so this
records conformance and flags the few items to confirm. **No engine code was
changed by this audit.**

## Conformance summary

| Rule | Appendix A | App (`DISCIPLINE_DEFAULTS` + reducers) | Status |
|---|---|---|---|
| **Indoor** players on court | 6 | `playersPerSide: 6` | ✅ |
| Indoor rotation | clockwise on side-out, server = pos 1 | `rotationEnabled`, rotate-left + server = `courtPositions[0]` | ✅ |
| Indoor positions | front 2/3/4, back 1/5/6 | `IndoorCourt` FRONT 4/3/2, BACK 5/6/1 (same set) | ✅ |
| Indoor timeouts | 2 × 30 s | `timeoutsPerSet: 2`, `timeoutDurationSecs: 30` | ✅ |
| Indoor side change | each non-deciding set; deciding (set 5) at 8 | `sideSwitchBetweenSetsOnly`, `sideSwitchDecidingSetAt: 8` | ✅ |
| Indoor TTO | off by default (competition-specific) | `ttoEnabled: false` | ✅ |
| Indoor set format | best-of-5, 25/15 | `bestOf 5`, `setScore 25`, `setScoreTiebreak 15` | ✅ |
| **Beach** players | 2 | `playersPerSide: 2` | ✅ |
| Beach rotation | none; service order alternates | `rotationEnabled: false`, service-order tracked | ✅ |
| Beach timeouts | 1 × 30 s | `timeoutsPerSet: 1`, 30 s | ✅ |
| Beach side switch | every 7 (sets 1–2), every 5 (set 3) | `sideSwitchEvery: 7`, `sideSwitchTiebreakEvery: 5` | ✅ |
| Beach TTO | total = 21 in sets 1–2 | `ttoEnabled: true`, `ttoTriggerScore: 21` | ✅ |
| Beach set format | best-of-3, 21/15 | `bestOf 3`, 21/15 | ✅ |
| **Air/Light** players | 4 or 5 by format | `playersPerSide: 4` (5 per competition) | ✅ |
| Air/Light timeouts | 2 × 30 s | `timeoutsPerSet: 2`, 30 s | ✅ |
| Air/Light deciding-set change | set 3 at 8 points | `sideSwitchDecidingSetAt: 8` | ✅ |
| Air/Light service time | 8 s | `serveClockSecs: 8` | ✅ |
| Air/Light TTO | off (not in rulebook) | `ttoEnabled: false` | ✅ |
| Air/Light set format | best-of-3, 21/15 | `bestOf 3`, 21/15 | ✅ |

The large majority conforms. Three items below warrant confirmation.

## Findings to confirm

### F1 — Air/Light server when the *serving* team wins — RESOLVED (2026-06-29)
Appendix A §1/§6 state that in Air/Light, when the **serving** team wins a rally
the server changes ("player moving from position 2 to position 1 serves"). The
product owner confirmed this is the real FIVB Light Volleyball rule: **the team
that wins a rally always rotates clockwise and serves next, including when it was
already serving** (unlike indoor/beach, where the server continues).

**Implemented:** `light/reducer.ts` `applyPoint` now advances the winner's
rotation on *every* won rally (the rotation is no longer gated behind a side-out
`!wasServing` check). A team's first service in a set still uses index 0; every
subsequent win advances one position. Covered by a regression test in
`light.test.ts` ("serving team rotates after a won rally"). Grass/Beach/Indoor
are unchanged.

### F2 — Air/Light court change entering the deciding set — RESOLVED (2026-06-29)
Product owner confirmed Air/Light changes ends only **after set 1** + at 8 in the
deciding set (no flip entering the decider). **Implemented:** `LightActionBar`'s
"Start next set" keeps the previous side when the next set is the deciding set
(`nextSetNumber >= config.bestOf`), otherwise flips as before; the deciding-set
switch at 8 is unchanged. Indoor/Beach/Grass unaffected.

### F3 — Air/Light court positions — RESOLVED (2026-06-29)
The engine keeps the rotation-order model (`lastRot`; correct expected server) —
no scoring change. For the court **display**, `LightCourt` now derives court
positions from rotation + server: position 1 = the server, the rest follow the
rotation order around, laid out front/back per format (4-player front 3·2 /
back 4·1; 5-player front 4·3·2 / back 5·1). Display-only; positional faults
remain a referee call (not app-enforced for any discipline).

## Conclusion
Indoor and Beach conform to Appendix A. Air/Light conforms on players, timeouts,
deciding-set change, service time, and set format. The only behavioural question
is **F1** (server on a won rally), which the app implements per standard rally
scoring; F2 and F3 are minor/cosmetic. Recommend product confirmation on F1
before any engine change.
