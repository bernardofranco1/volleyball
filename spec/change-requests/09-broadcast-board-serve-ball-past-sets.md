# 09 — Broadcast board: serve ball, past sets up top, centred set label, animations

Status: **design approved (2026-07-17), not yet implemented.** This brief is the
source of truth for porting the approved design into the React component. An
interactive, pixel-faithful mock of the agreed design lives at
[`scoreboards/serve-ball-past-sets-preview.html`](scoreboards/serve-ball-past-sets-preview.html)
— open it in a browser; **screen 1 is live**: use its buttons ("▶ Play sequence",
"+1 …", slow-motion toggle) to see the two animations. Match that mock.

Branch for the work: **`feat/board-serve-ball-past-sets`** (this branch).

Applies to **Beach, Grass and Light** (they share `BroadcastBoard.tsx`).
Indoor (`IndoorBoard.tsx`) is untouched.

> Reminder from `AGENTS.md`: this repo's Next.js has breaking changes — read
> `node_modules/next/dist/docs/` before touching app code.

---

## Why

1. The board receives a `serving` prop but **never renders it** — there is no
   serve indicator on Beach/Grass/Light boards.
2. Past-set scores sat in a boxed ladder between the two big numbers, which was
   hard to read from distance and duplicated the sets-won boxes in the top bar.
3. Approved redesign (see mock): serve ball beside the set label, past sets
   listed under the top bar, "Set N" dead-centre between the points, plus two
   broadcast-style animations (score roll, ball side-out flight).

---

## Files

| File | Change |
|------|--------|
| `src/components/scoreboard/BroadcastBoard.tsx` | All layout + animation work below. Keep the exported `BoardProps` / `BoardSet` interfaces unchanged — `ScoreboardDisplay` needs no changes. |
| `public/balls/bv550c.webp` | **Already committed with this CR.** Circular cutout of the official BV550C ball photo, 320 px, transparent background, ~24 KB. Do not regenerate. |

No schema, API, i18n or scorer changes: `serving` and `sets` (with per-set
`winner`) already flow into the component. No existing tests reference it.

---

## Layout changes (all sizes in cqmin, matching the mock)

Board root, top bar, and bottom logo strip are unchanged.

### 1. Past sets — directly under the top bar

New block between the top bar and the centre area (`flex: none`, so the centre
area shrinks accordingly):

- Only sets with `winner != null`, in order. Render nothing (no empty box) when
  there are none — Set 1 then looks exactly like today.
- One row per set, centred column, gap `.7`, padding-top `.6`.
- Row = label + score, baseline-aligned, gap `1.6`, `font-variant-numeric: tabular-nums`:
  - Label `Set {n}`: size `2.9`, letter-spacing `.25`, theme font colour at 55 % opacity, weight 700.
  - Score `{scoreA}:{scoreB}`: size `3.8`, letter-spacing `.1`; the **losing
    score at 45 % opacity** (same dimming rule the old ladder used); colon at 70 %.

### 2. Centre area — 3×3 grid

Replace the current centre flex block (set row above a `1fr auto 1fr` score
grid) with **one grid**:

```
flex: 1; min-height: 0; display: grid;
grid-template-columns: 1fr auto 1fr;
grid-template-rows: 1fr auto 1fr;      /* empty 1fr rows keep row 2 centred */
column-gap: 3; align-items: center;
```

- Score A → area `2 / 1`, score B → area `2 / 3`. Keep `font-size: 26`,
  `line-height: .8`, tabular-nums; add `overflow: hidden; position: relative`
  (needed by the roll animation).
- Set label → area `2 / 2`, flex-centred, `position: relative` (anchor for the
  ball). Text only — **the two accent squares that flanked "Set N" are
  removed**. Size `5.5`, letter-spacing `.4`. Text stays `Set {n}` / `Final`.
- **The boxed `Ladder` component is deleted** (its info now lives in the
  past-set stack + the sets-won boxes).

### 3. Serve ball

- `<img src="/balls/bv550c.webp">`, `6 × 6`, `border-radius: 50%`,
  `filter: drop-shadow(0 .3cqmin .6cqmin rgba(0,0,0,.4))`.
- Absolutely positioned inside the set-label cell: `top: 50%;
  margin-top: -3cqmin` (margin, **not** transform — the flight animation owns
  `transform`), and per side:
  - serving A: `right: calc(100% + 6cqmin)`
  - serving B: `left: calc(100% + 6cqmin)`
- Render only when `serving != null && !finished`.

---

## Animations

Both are **skipped entirely when `prefers-reduced-motion: reduce`** (instant
swap / instant side change). Use the Web Animations API (`element.animate`);
cancel any in-flight animation on the same element before starting a new one.

### A. Score roll (every point, either side)

Odometer turn, **500 ms**, on any change of `scoreA`/`scoreB` (track previous
values in a ref; never animate on mount). The digit box clips (`overflow:
hidden`). Two layers:

- Outgoing (old value, absolute inset 0):
  `translateY(0) → translateY(115%)`, `opacity 1 → 0`,
  easing `cubic-bezier(.5,0,.7,.4)`; remove on finish.
- Incoming (new value): `translateY(-115%) → translateY(0)`,
  easing `cubic-bezier(.3,.4,.3,1)`.

Polish (cheap, do it): when the value **decreases** (scorer undo), mirror the
direction — old rolls up and out, new drops from below — so the correction
reads as "rolling back". A poll can jump several points at once; still one roll
straight to the final value.

### B. Ball V-flight (side-out only)

Runs only when `serving` flips A↔B (never on mount, never when `serving`
becomes null). FLIP with refs on the board root, the logo bar and the ball img:

1. Measure the ball rect, switch the side (right⇄left styles), measure again.
2. Bounce vertex: `x = board centre − ballWidth/2`,
   `y = logoBarTop − 1.35 × ballHeight`.
3. Animate **900 ms**, half a spin per leg, squash at the bounce:

```js
ball.animate([
  { transform: `translate(${fromX}px, ${fromY}px) rotate(0deg)`,
    easing: 'cubic-bezier(.55,0,.85,.5)' },              // dive: ease-in
  { transform: `translate(${midX}px, ${midY}px) rotate(180deg) scale(1.12,.82)`,
    offset: .5, easing: 'cubic-bezier(.15,.5,.4,1)' },   // bounce → rise
  { transform: 'translate(0,0) rotate(360deg)' },
], { duration: 900 });
```

Note: `serving` also changes at set starts — the flight playing there is
accepted/desired.

---

## Acceptance

- [ ] `npm run lint`, `npm run typecheck`, `npm run build` green;
      `npm test` still 149/149.
- [ ] Side-by-side with the preview HTML: screens 1–4 match (16:9 + 4:3,
      Set 1 empty state, ball on either side, accent overrides).
- [ ] Buttons in the preview vs. the real board driven by the scorer: score
      roll on every point; ball flies its V (bounce above the logo strip) only
      on side-out; ball hidden when finished.
- [ ] With OS reduced-motion enabled: no animation, state still correct.
- [ ] White-label intact: bg/accent/font/family all still come from `BoardTheme`;
      nothing hardcodes the beach amber.
