# Brief §7 — "Arc fault" clarified

**Question (brief §7):** What is "arc fault" meant to be? Clarify intended
behaviour / whether it should remain.

**Answer:** "Arc fault" is the app's existing **`ATTACK_ARC_FAULT`** event — a
real **Light/Air Volleyball** fault, not a leftover or a bug. It enforces Light
VB's *front-zone attack-arc* restriction: in Light VB a front-zone player may not
attack-hit the ball above net height from inside the marked arc. It is the Light
counterpart to the beach/indoor attack-line rules.

Where it lives in the code:
- Config flag: `frontZoneArcRequired` — `true` only for `LIGHT`
  (`src/engine/config.ts`), `false` for Beach/Indoor/Grass.
- Event + scoring: `ATTACK_ARC_FAULT` in the Light engine
  (`src/engine/light/{types,reducer}.ts`) — awards the rally to the opponent,
  same shape as `JUMP_SERVE_FOOT_FAULT`.
- Scorer control: the arc-fault button in `src/components/scoring/LightActionBar.tsx`,
  shown only for the Light/Air discipline.

**Decision:** It is a legitimate Light/Air rule, so it **stays** for the
Light/Air discipline (and is never shown for Indoor/Beach/Grass, which have no
arc rule). No change required beyond this clarification; if the product owner
later wants it hidden, treat it like §6 (hide the button, keep the engine event
dormant).
