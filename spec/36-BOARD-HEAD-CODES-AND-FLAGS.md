# spec/36 — The VIS board head: IOC codes, and whole flags

Shipped 2026-08-19. Touches only the head of the VIS-fed boards (spec/34,
geometry spec/35). No schema change, no VIS contract change.

## Why

Two faults, both visible on any AVC entry list.

**Names did not fit.** The head sized the federation name by character count —
cap 52 up to 12 characters, 44 up to 16, 36 beyond — inside a 430 design-px box,
with `overflow: hidden` mopping up the difference. Measured against Ancorli:

| Name | Width at its cap | Box | Result on screen |
| --- | --- | --- | --- |
| KAZAKHSTAN | 502 px @ cap 52 | 430 | `AZAKHSTAN` |
| CHINESE TAIPEI | 467 px @ cap 44 | 430 | `CHINESE TAIPE` |
| HONG KONG, CHINA | 613 px @ cap 44 | 430 | `KONG, CHINA` |

**Flags were cropped.** The masters draw a 130 × 130 square and the board filled
it with `object-fit: cover`. Every flag we ship is wider than it is tall, so
every one of them lost its sides: Brazil's lozenge points, a third of
Kazakhstan.

## What the head does now

1. **It shows the team's 3-letter IOC code** — `KAZ`, `TPE`, `HKG` — at cap 72.
   Three glyphs cannot overflow. The code is what VIS sends in `Code`, passed
   through unchanged; for all 41 federations we hold flag art for that is the
   IOC code. (A federation the IOC has no code for — Macau is the real case —
   would need a small override map. None is in the current allowlist.)

2. **The full federation name remains the fallback** when a payload carries no
   code, and is now fitted by measurement instead of by character count:
   `src/lib/board-text-fit.ts` shrinks it until it fits. Shrink, never
   truncate — an ellipsis on a venue TV reads as a fault. "HONG KONG, CHINA"
   lands at cap 25: small, but whole.

3. **Flags draw whole, at equal AREA.** The assets carry eight different
   official ratios (3:2 for 25 of them, 2:1 for six, 10:7 Brazil, 28:11 Qatar),
   so "the same size" had to mean one of three things:

   | Rule | Brazil | Qatar | Verdict |
   | --- | --- | --- | --- |
   | equal width | 190 × 133 | 195 × 77 | Qatar reads as a sliver |
   | equal height | 186 × 130 | 330 × 130 | Qatar nearly doubles Brazil, and shoulders the code out |
   | **equal area** | **190 × 133** | **254 × 100** | **same visual weight** |

   Each flag keeps the master's INNER edge (619.25 / 1300.75 — the gap into the
   score frame that carries the composition) and the master's optical centre,
   and grows outward into the room the short code frees. The head text box
   narrows to 306 px so it stays clear of Qatar, the widest flag in the set.

4. **The SERVE lettering is gone.** The Mikasa ball already frames the server's
   row, which identifies the player and therefore the team; the vertical label
   beside the score frame said the same thing a second time.

The U-shape rail's flag head switches `cover` → `contain` and keeps its measured
position: at 152 × 74 it is too narrow for the area rule to mean anything.

## Why the fit is arithmetic, not measured in the browser

The boards are server-rendered onto venue TVs. A JS fit pass would paint one
size and then jump, and it would break the spec/35 pixel-diff gate. So Ancorli's
advance widths and every flag's natural ratio are baked into generated tables:

```
node scripts/gen-board-metrics.mjs   # after any font or flag change
  → src/lib/board-text-metrics.ts
  → src/lib/board-flag-ratios.ts
```

Kern pairs are deliberately not emitted — on real federation names Ancorli's
kerning moves the total by under 1%, which the 1.5% safety margin in
`board-text-fit.ts` covers, and the pair table is twenty times the size.

## Where it lives

- `src/components/scoreboard/VisTeamMark.tsx` — the head: `TeamMark`,
  `TeamFlag`, `flagBox`. Both full-layout boards share it.
- `src/lib/board-text-fit.ts` + generated `board-text-metrics.ts`.
- `src/lib/board-flag-ratios.ts` (generated).
- `src/__tests__/lib/board-head.test.ts` — pins that no name overflows, that
  every flag holds its own ratio at equal area, and that the widest flag still
  clears the text box.

## Not done

- **OMA is 1.76:1 in `public/flags`; Oman's official flag is 2:1.** Every other
  asset matches its official ratio. Worth re-cutting that one PNG — it now shows
  at its true proportions, so the error is visible where the square crop used to
  hide it.
