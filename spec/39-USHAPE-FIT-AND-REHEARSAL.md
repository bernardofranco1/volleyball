# spec/39 — U-shape fit, the AVC Cup pattern, and the rehearsal event

Shipped 2026-08-19, ahead of the 2026-08-20 dress rehearsal.

## 1. New board background

`AVC_CUP_PATTERN_06` (8000 × 4500) replaces the extracted swirl on all three
screens — `public/board-bg/avc-{scoreboard,set,ushape}.png`, resized to
1920 × 1080. The pattern is calm through the middle, which is where the score
plates and the U-shape's keyed window sit. The previous artwork is in git
history if it is ever wanted back; a per-competition override
(`public/board-bg/{competitionId}.jpg`) still wins over it.

## 2. The rehearsal competition

`comp_vis_1736` → VIS tournament 1736, "VNL 2026 - WOMEN (TEST ONLY)": 116
fixtures of VIS's own test data, which is what makes it drivable on demand.
Match **27832** (CHN v THA) is the dress-rehearsal fixture. Added to
`scripts/provision-vis-live.ts` and applied to production; the script is
idempotent, so re-running it is safe.

## 3. The U-shape rail did not fit its own numbers

Reported from the rehearsal build. Every fault had the same root: the rail is
152 design px wide and its boxes were sized for the master's dummy state, which
carries a **one-digit** score. A real two-digit score overflowed its box on
every rail, and the flag and code were pushed off the top.

| | before | after |
| --- | --- | --- |
| flag | 74 px tall, clipped, no outline | 66 px, whole, white keyline hugging the flag itself |
| code | cap 34 at y 90, sitting on the score box | cap 34 in its own 48 px band, clear of both |
| current score | y 124, h 160, **cap 96.5** — "25" needs 173 px in a 138 px box | y 132, h 140, cap 70 — "25" measures 125 px |
| sets | y 304, h 160 | y 284, h 140 |
| set history | y0 484, h 80, cap 50 | y0 442, h 88, cap 56 |

**The caps are fixed, not fitted.** A cap that shrank to fit would make the
score visibly jump as it crossed 9 to 10, and a screen that changes type size
mid-rally reads as broken. So each cap is chosen for the widest string its box
can hold, and `railCap()` — built on the spec/36 Ancorli metrics — is the safety
net for the payload nobody planned for, not the normal path.

## 4. Substitutions: eight pips, two rows of four

Eight is what the feed reports for these events (spec/37 already takes VIS's own
`NbRemainingSubstitution` verbatim rather than clamping to six). One row of eight
forced the pips small enough to be ambiguous from the stands. Filled = still
available, outline = spent, as before.

The band also came down from cap 32 to 24 and now spans x 40 → 796, so
"TIME OUT" clears the centre set plate at 834 on both sides.

## 5. Verifying "within its defined space"

`scripts/check-board-fit.mjs` renders the board and walks every text node,
comparing the text's own rectangle against its container's. It found the one
overflow left after the geometry pass — the country code's line box was 7 px
taller than its band — and it is how to check any future change:

    npx next dev -p 3313
    node scripts/check-board-fit.mjs http://localhost:3313/board-lab

It needs a harness route rendering the board with an arbitrary state, which is
not committed; recreate it at `src/app/board-lab/page.tsx` when needed.

`src/__tests__/lib/ushape-counters.test.ts` pins the pip counts and the
fill-means-available rule.
