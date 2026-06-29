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

### F2 — Air/Light court change entering the deciding set (minor)
Appendix A lists Air/Light court changes as "after set 1" + the deciding set at 8.
The app uses `sideSwitchBetweenSetsOnly`, which (for best-of-3) also switches
between set 2 and the deciding set 3. The deciding set additionally switches at 8.
Net effect is a possible extra switch entering set 3. This only affects which
physical side a team starts the deciding set on (cosmetic for side tracking).
**Recommendation:** confirm desired behaviour; if it must match Appendix exactly,
suppress the between-sets switch immediately before the deciding set for LIGHT.

### F3 — Air/Light rotation model (modelling note, not a bug)
Appendix A describes Air/Light with fixed positions 1–5 rotating clockwise. The
app implements Light (like Grass/Beach) with a **rotation-order** model
(`lastRotA/B` index; server = `courtPositions[lastRot]`; advance on service gain)
rather than fixed positional slots. This yields the correct expected server and
rotation order; the §5 court view renders Light in rotation order accordingly. No
change recommended — it is an equivalent, simpler model for the data we track
(we don't enforce positional faults for Light).

## Conclusion
Indoor and Beach conform to Appendix A. Air/Light conforms on players, timeouts,
deciding-set change, service time, and set format. The only behavioural question
is **F1** (server on a won rally), which the app implements per standard rally
scoring; F2 and F3 are minor/cosmetic. Recommend product confirmation on F1
before any engine change.
