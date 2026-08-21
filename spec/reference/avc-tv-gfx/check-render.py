#!/usr/bin/env python3
"""
Measure what the BROWSER drew, and check it against spec/47's constants.

Two gates guard this graphic and they answer different questions:

  validate-bug.py   do the constants reproduce the master?   (PIL, offline)
  check-render.py   does the browser reproduce the constants? (this file)

The second is the one that catches a wrong SVG baseline, a clip that lost its
notch, a font that never loaded and fell back to Geist, or artwork scaled by the
wrong box. None of those are visible to the first.

Run the renderer first, which writes the screenshot this reads:

    node scripts/check-tv-bug.mjs
    python3 spec/reference/avc-tv-gfx/check-render.py

Measured against a NAVY backdrop, because that is what /tv shows with no stream
attached — so the bar's own navy is invisible and every feature here is found by
something else: the red SETS blocks span the full band, the accent is the only
light blue, the type is the only white.
"""

import sys
from pathlib import Path

from PIL import Image

SHOT = Path("spec/reference/avc-tv-gfx/validate/browser.png")

# ── what src/lib/tv/bug-geometry.ts promises ────────────────────────────────
BAR_Y, BAR_H = 940.0, 60.0
RED_BLOCK_L_TOP = 755.8       # left edge of the left red block, at the bar's top
RED_BLOCK_R_TOP = 1164.3      # right edge of the right red block, at the bar's top
ACCENT_L_X = 607.6
ROUNDEL_CX = 960.0
# THE FIXTURE IS /tv/mock, and it has to be: the strings are part of the check.
#
# Turning a measured ink box back into a baseline needs to know how far that
# PARTICULAR string's ink falls below the baseline, and it varies — a flat-
# bottomed capital reaches 0.00, a round one overshoots 0.48, and Ancorli's J has
# a tail. On the replay board (a Qatar v Venezuela fixture) Q's tail read as a
# 3.25 px baseline error that was not there. The mock is a fixed capture — JPN 12
# (0) v POL 25 (2), Japan on the left, Poland serving — so the strings are known
# and `below` is the exact figure from the font, via:
#   node -e "…fontkit…layout('JPN').glyphs → bbox.minY…"
#
# The windows are TIGHT, each drawn to exclude a specific white thing that is not
# type: the AVC roundel (937-983), the serve ball (846-871 / 1049-1074), and the
# flags, which reach 525-625 and 1295-1395 and carry white of their own.
#
# label, x-window, y-window, expected centre, expected baseline, ink below baseline
TEXT_CHECKS = [
    ("code L 'JPN'",     (640, 745),   (944, 999), 690.52, 986.75, 0.432),
    ("code R 'POL'",     (1175, 1285), (944, 999), 1229.43, 986.75, 0.480),
    ("score L '12'",     (872, 930),   (944, 995), 899.66, 986.80, 0.000),
    ("score R '25'",     (990, 1046),  (944, 995), 1019.66, 986.80, 0.432),
    ("setValue L '0'",   (780, 825),   (944, 978), 798.91, 972.85, 0.304),
    ("setValue R '2'",   (1100, 1145), (944, 978), 1120.91, 972.85, 0.000),
    ("setLabel L",       (775, 830),   (978, 996), 800.30, 989.80, 0.123),
    ("setLabel R",       (1096, 1150), (978, 996), 1120.30, 989.80, 0.123),
]
TOL_XY = 1.5
TOL_BASE = 1.5


def load() -> Image.Image:
    if not SHOT.exists():
        sys.exit(f"no screenshot at {SHOT} — run: node scripts/check-tv-bug.mjs")
    im = Image.open(SHOT).convert("RGB")
    if im.size != (1920, 1080):
        sys.exit(f"screenshot is {im.size}, expected 1920x1080")
    return im


def is_red(p) -> bool:
    return p[0] > 170 and p[1] < 90 and p[2] < 100


def is_white(p) -> bool:
    return p[0] > 205 and p[1] > 205 and p[2] > 205


def is_accent(p) -> bool:
    return 35 < p[0] < 110 and 100 < p[1] < 175 and p[2] > 155


def span(px, pred, xs, ys, axis):
    """Extent of pixels matching `pred`, along `axis` ('x' or 'y')."""
    hits = [
        (x, y) for y in range(*ys) for x in range(*xs) if pred(px[x, y])
    ]
    if not hits:
        return None
    vals = [h[0] if axis == "x" else h[1] for h in hits]
    return min(vals), max(vals) + 1


def main() -> int:
    im = load()
    px = im.load()
    checks: list[tuple[str, float | None, float, float]] = []

    # The red blocks span the full band, so they give the band.
    band = span(px, is_red, (700, 1200), (900, 1040), "y")
    if band:
        checks.append(("bar top y", band[0], BAR_Y, 1.0))
        checks.append(("bar bottom y", band[1], BAR_Y + BAR_H, 1.0))

    top = int(BAR_Y) + 1        # one row inside, clear of the edge
    bottom = int(BAR_Y + BAR_H) - 2
    lb = span(px, is_red, (700, 900), (top, top + 1), "x")
    if lb:
        checks.append(("red block L left x @top", lb[0], RED_BLOCK_L_TOP, TOL_XY))
    rb = span(px, is_red, (1050, 1250), (top, top + 1), "x")
    if rb:
        checks.append(("red block R right x @top", rb[1], RED_BLOCK_R_TOP, 2.0))

    acc = span(px, is_accent, (560, 700), (top, top + 3), "x")
    if acc:
        checks.append(("accent L left x", acc[0], ACCENT_L_X, TOL_XY))

    # The roundel is the only white blob in the centre of the band.
    round_ = span(px, is_white, (900, 1020), (int(BAR_Y) + 4, bottom), "x")
    if round_:
        checks.append(("roundel centre x", (round_[0] + round_[1]) / 2, ROUNDEL_CX, 2.0))

    for label, xs, ys, want_cx, want_base, below in TEXT_CHECKS:
        ink_x = span(px, is_white, xs, ys, "x")
        ink_y = span(px, is_white, xs, ys, "y")
        if not ink_x or not ink_y:
            checks.append((f"{label} (missing)", None, 0, 0))
            continue
        # Centre of the INK, compared against the centre of the ADVANCE box.
        # They differ by the glyphs' side-bearing asymmetry — under a pixel for
        # every string on this bar — so the tolerance covers it without having to
        # re-derive bearings here.
        checks.append((f"{label} centre x", (ink_x[0] + ink_x[1]) / 2, want_cx, TOL_XY))
        checks.append((f"{label} baseline", ink_y[1] - below, want_base, TOL_BASE))

    bad = 0
    print(f"{SHOT}\n")
    for label, got, want, tol in checks:
        if got is None:
            print(f"  ✗ {label:28s} NOT FOUND")
            bad += 1
            continue
        ok = abs(got - want) <= tol
        bad += 0 if ok else 1
        print(
            f"  {'✓' if ok else '✗'} {label:28s} {got:8.2f}   want {want:8.2f} "
            f"±{tol}   Δ {got - want:+.2f}"
        )
    print(f"\n{'PASS' if bad == 0 else f'FAIL — {bad} check(s) out of tolerance'}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
