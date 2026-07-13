# Spec 18 — Tablet subs, quota-aware buttons, configurable VCS, board front-row fix

Corrections requested 2026-07-13 (post spec/17 + countdown hardening). Decisions
confirmed with the product owner are marked ✔.

## 1. Team-tablet substitution flow (currently "does not work")

Today the tablet's **Substitution** button only raises a generic interrupt
request; the scorer must enter the players manually. Replace with the scorer's
sub flow, driven from the tablet:

- Tapping **Substitution** on the tablet opens the same panel the scorer has
  (`SubPanel` model): pick the outgoing player (on court) and the incoming
  player (bench, slot-legal), with the used/max counter.
- Submitting sends an interrupt request of type `SUBSTITUTION` whose `payload`
  carries `{ outPlayerId, inPlayerId }`.
- ✔ **Scorer approves**: the request appears in `InterruptNotifications`
  showing the resolved player names ("Sub: 7 Mayer → 5 Braun"); **Approve**
  applies it server-side via `appendMatchEvent({type:"SUBSTITUTION", …})`
  exactly like timeout approval (engine validates legality + caps; invalid →
  falls back to manual). **Deny** just clears it.
- Tablet roster/court data: the tablet already receives `roster` and live
  `state` (court positions per set), so the panel is fully client-side.
- API: extend the interrupt-requests POST to accept + validate the two player
  ids (both must be in the requesting team's roster; strings, length-capped);
  extend PATCH approval to apply the sub. Broadcast payload stays a signal
  (ids only, names resolved client-side from the scorer's roster).

## 2. Quota-aware tablet buttons

✔ Buttons stay visible but **greyed out with a remaining counter** when the
quota is exhausted. The tablet now has `config` + live `state`, so compute:

- **Time-out**: disabled when `timeoutsUsed{team} >= timeoutCapForSet(config,
  set.setNumber)` — label "Time-out ({remaining} left)".
- **Substitution**: disabled when `subsUsed{team} >= config.maxSubsPerSet` —
  label "Substitution ({remaining} left)".
- **Challenge**: disabled when `vcs.challengesRemaining{team} <= 0` — label
  "Challenge ({remaining} left)". (Only unsuccessful challenges consume the
  quota — already the engine rule.)
- **Medical**: never quota-limited; unchanged.
- Server-side backstop: the interrupt POST rejects TIMEOUT/SUBSTITUTION/
  CHALLENGE requests that are already over quota (tablets with stale state
  can't spam the scorer).

## 3. Challenges (VCS) configurable per competition

- Config page (indoor shows it; harmless for others): add a tri-state
  **Challenges (VCS)** select (default/on/off) wired to the existing
  `vcsEnabled` column + a **Challenges per set** number input
  (`vcsChallengesPerSet`, default 2).
- ✔ Scorer interface: when `vcsEnabled`, show a **Challenge** button per team
  (in the per-team officiating row) dispatching `VCS_CHALLENGE`; the existing
  upheld/rejected banner resolves it. Hidden when off. (Un-hides the dormant
  engine — validator/reducer/deciding-set=1 logic already exist and are
  tested.)
- Tablet: **Challenge** button (request type `CHALLENGE`, already supported)
  shown only when `vcsEnabled`; approval opens nothing special — scorer taps
  Approve then uses their Challenge button (request is informational), OR
  approve applies `VCS_CHALLENGE` directly for the requesting team (same
  model as timeout). → Implement direct-apply on approve, consistent with 1.
- When VCS off: no challenge button anywhere (tablet + scorer).

## 4. Scoreboard front row inside the front zone

IndoorBoard: front-row jerseys currently sit at x=37%/63% while the dashed
attack line is at 33.3%/66.7% — players straddle the line. ✔ Cosmetic layout,
not to scale: move the dashed lines to **40% / 60%** and the front columns to
**≈44.5% / 55.5%**, so the front row sits clearly between the 3-m line and the
net. Back columns stay at 13% / 87%.

## Test & deploy plan

- Unit: quota helpers on tablet logic (pure), interrupt POST quota rejection,
  PATCH sub/challenge application (validator acceptance), vcs config
  resolution.
- Local: typecheck, lint, vitest, build.
- Prod validation: script-level exercise of the new interrupt payloads against
  the live demo indoor match (sub request → approve → court updated; over-quota
  rejection), plus /state contract check; Playwright smoke.
- Merge to main → Vercel auto-deploy → post-deploy re-verification.
