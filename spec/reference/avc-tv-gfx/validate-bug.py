#!/usr/bin/env python3
"""
Rebuild the score bug from the extracted artwork and diff it against the
Illustrator artboard it was cut from.

WHAT THIS CHECKS, AND WHAT IT DOES NOT. The geometry below is the ARTBOARD's own
— a 61.25 px bar mirroring about x 960.76 — and not what
src/lib/tv/bug-geometry.ts ships, which follows the rendered graphic instead
(60 px, mirroring about 960.00; the file explains why). The two are deliberately
different, so this is not a check on the component. It is a check on the ASSETS:
that public/tv-gfx/*.png still carry the master's panels, pinstripes, blocks and
roundel intact and in register, which is the thing that would break silently if
extract-assets.py were re-run against a changed master.

The component's own gate is scripts/check-tv-bug.mjs plus check-render.py, which
measure what a browser actually drew.

Run it before wiring anything up, too: if the artwork and a few lines of PIL
cannot reproduce the master, CSS will not either, and a wrong number found here
costs a minute instead of a browser round-trip.

It composites at 4x and downsamples, because that is what a browser does with
the 4x plate on a 1080p rail, and because a 1:3 slant judged at 1x is all
staircase and no signal.

The reference is the MASTER'S OWN RENDER (artwork/04_Scoreboard_1920-1.png),
not the guidelines screenshot, and that choice is load-bearing. Both show the
same graphic, but the guidelines page is a render of the After Effects comp and
its pinstripe field sits 3 px to the right of the Illustrator artboard's — a
phase shift in a 22.5 px repeating texture, invisible to a viewer and worth
nothing to chase, but enough to put a diff against a high-contrast pattern at a
mean of 50 and drown every real signal. The guidelines frame also bleeds the
photo through the bar's antialiased bottom edge, which reads as text where a
white court line happens to sit under it. Diffing against the artboard the
artwork was cut from keeps this measuring OUR geometry.

Run:  python3 spec/reference/avc-tv-gfx/validate-bug.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 4  # supersample
REF = Path("spec/reference/avc-tv-gfx/artwork/04_Scoreboard_1920-1.png")
ART = Path("public/tv-gfx")
FLAGS = Path("public/tv-flags")
FONTS = Path("src/fonts")
OUT = Path("spec/reference/avc-tv-gfx/validate")

# ── the geometry under test (mirrors src/lib/tv/bug-geometry.ts) ─────────────
BAR = {"y": 939.75, "h": 61.25}
PLATE = {"x": 596.50, "y": 939.75}
ACCENT_L = {"x": 595.75, "y": 939.75}
ACCENT_R = {"x": 1301.50, "y": 939.75}
BALL = {"lx": 846.50, "rx": 1050.00, "y": 958.25, "size": 24.50}
FLAG = {"lx": 524.75, "rx": 1396.25, "w": 87.75}
# Flag clip, as offsets inside the flag box (w 87.75 x h 61.25). The right-hand
# flag is this mirrored: measured, not assumed — see layers.py output.
FLAG_CLIP_L = [(0, 0), (71.75, 0), (80.75, 28.125), (76.75, 28.125), (87.75, 61.25), (0, 61.25)]
CODE = {"lcx": 684.27, "rcx": 1230.43, "baseline": 988.80, "size": 48}
SCORE = {"lcx": 901.41, "rcx": 1020.91, "baseline": 986.93, "size": 48}
SETVAL = {"lcx": 798.90, "rcx": 1120.66, "baseline": 974.85, "size": 32}
SETLBL = {"lcx": 799.05, "rcx": 1120.80, "baseline": 991.30, "size": 13}


def px(v: float) -> int:
    return int(round(v * S))


def paste(canvas: Image.Image, art: Path, x: float, y: float) -> None:
    im = Image.open(art).convert("RGBA")
    canvas.alpha_composite(im, (px(x), px(y)))


def flag(canvas: Image.Image, code: str, outer: float, side: str) -> None:
    """
    A flag scaled to bar height, anchored to its OUTER vertical edge, then cut
    to the notched parallelogram.

    Both halves of that are measured off the flag assets the package supplies
    ready-made at 60 px (guidelines p.12, embedded there at native size). Japan's
    disc comes out 37x36 in the supplied asset and its centre does not drift
    between the top and the bottom of the flag, so the treatment neither stretches
    the flag to fill the parallelogram nor shears it — the flag keeps its own
    ratio and the parallelogram is a clip. Japan's rect also sits flush with the
    asset's right edge in the right-hand orientation, which is what fixes the
    anchor: the vertical edge is the flag's true edge, the slant is the cut.

    Nothing is left uncovered by anchoring outward: the clip is 87.75 wide at its
    widest and the narrowest flag in the AVC field (3:2) is 91.9 wide at this
    height, so the far corner always lands on flag rather than on a hole.
    """
    src = FLAGS / f"{code}.webp"
    if not src.exists():
        return
    im = Image.open(src).convert("RGBA")
    h = px(BAR["h"])
    w = round(im.width * h / im.height)  # the flag's own ratio, never stretched
    im = im.resize((w, h), Image.LANCZOS)
    wd = w / S  # image width back in design px
    poly = FLAG_CLIP_L if side == "left" else [(wd - x, y) for x, y in FLAG_CLIP_L]
    left = outer if side == "left" else outer - wd
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon([(px(a), px(b)) for a, b in poly], fill=255)
    im.putalpha(Image.composite(im.getchannel("A"), Image.new("L", (w, h), 0), mask))
    canvas.alpha_composite(im, (px(left), px(BAR["y"])))


def text(canvas: Image.Image, s: str, cx: float, baseline: float, size: float,
         face: str) -> None:
    font = ImageFont.truetype(str(FONTS / face), px(size))
    # "ms" = horizontally middle, vertically ON the baseline, which is the same
    # contract as SVG text-anchor=middle + y=baseline that the component uses.
    ImageDraw.Draw(canvas).text(
        (px(cx), px(baseline)), s, font=font, fill=(255, 255, 255, 255), anchor="ms"
    )


def build(teamL: str, teamR: str, codeL: str, codeR: str, scoreL: str, scoreR: str,
          setsL: str, setsR: str, serving: str | None) -> Image.Image:
    c = Image.new("RGBA", (1920 * S, 1080 * S), (0, 0, 0, 0))
    paste(c, ART / "bug-plate.png", PLATE["x"], PLATE["y"])
    flag(c, teamL, FLAG["lx"], "left")
    flag(c, teamR, FLAG["rx"], "right")
    paste(c, ART / "bug-accent-left.png", ACCENT_L["x"], ACCENT_L["y"])
    paste(c, ART / "bug-accent-right.png", ACCENT_R["x"], ACCENT_R["y"])
    if serving == "L":
        paste(c, ART / "bug-ball.png", BALL["lx"], BALL["y"])
    elif serving == "R":
        paste(c, ART / "bug-ball.png", BALL["rx"], BALL["y"])
    text(c, codeL, CODE["lcx"], CODE["baseline"], CODE["size"], "Ancorli.ttf")
    text(c, codeR, CODE["rcx"], CODE["baseline"], CODE["size"], "Ancorli.ttf")
    text(c, scoreL, SCORE["lcx"], SCORE["baseline"], SCORE["size"], "Ancorli.ttf")
    text(c, scoreR, SCORE["rcx"], SCORE["baseline"], SCORE["size"], "Ancorli.ttf")
    text(c, setsL, SETVAL["lcx"], SETVAL["baseline"], SETVAL["size"],
         "EncodeSansExpanded-SemiBold.ttf")
    text(c, setsR, SETVAL["rcx"], SETVAL["baseline"], SETVAL["size"],
         "EncodeSansExpanded-SemiBold.ttf")
    for cx in (SETLBL["lcx"], SETLBL["rcx"]):
        text(c, "SETS", cx, SETLBL["baseline"], SETLBL["size"],
             "EncodeSansExpanded-Bold.ttf")
    return c.resize((1920, 1080), Image.LANCZOS)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ours = build("THA", "KOR", "THA", "KOR", "10", "10", "0", "0", "L")
    # The artboard renders at 96 dpi (2560x1440 for a 1920x1080 page); bring it
    # down to design px the same way a browser would.
    ref = Image.open(REF).resize((1920, 1080), Image.LANCZOS).convert("RGBA")

    # Composite ours over the master's own photo so the only difference left is
    # the graphic itself, then compare the bar band.
    base = ref.copy()
    base.alpha_composite(ours)
    y0, y1 = int(BAR["y"]) - 6, int(BAR["y"] + BAR["h"]) + 6
    box = (500, y0, 1420, y1)
    a = base.crop(box).convert("RGB")
    b = ref.crop(box).convert("RGB")

    diff = Image.new("RGB", a.size)
    pa, pb, pd = a.load(), b.load(), diff.load()
    # Zones, because one number over the whole bar hides the answer. The flag
    # ends are reported separately and are NOT a pass/fail: the flags embedded in
    # this artboard are placeholders — Thailand's red is (249,19,25) there against
    # the official #A51931 in the supplied asset, and its Korean flag carries a
    # 1.37 ratio against the real 1.4988 — so the artboard is simply not the
    # authority on flags and the package's own webp files are.
    zones = {
        "left flag+accent": (0, 121),        # design x 500 → 621
        "BAR INTERIOR": (121, 801),          # design x 621 → 1301  ← the gate
        "right flag+accent": (801, 920),     # design x 1301 → 1420
    }
    stats = {k: [0, 0, 0, 0] for k in zones}  # total, n, worst, over40
    for yy in range(a.size[1]):
        for xx in range(a.size[0]):
            d = max(abs(pa[xx, yy][i] - pb[xx, yy][i]) for i in range(3))
            pd[xx, yy] = (min(255, d * 4), 0, 0) if d > 12 else (0, 0, 0)
            for k, (lo, hi) in zones.items():
                if lo <= xx < hi:
                    s = stats[k]
                    s[0] += d
                    s[1] += 1
                    s[2] = max(s[2], d)
                    s[3] += d > 40
                    break
    for k, (tot, n, worst, bad) in stats.items():
        print(f"  {k:18s} mean |Δ| {tot / n:5.2f}   max {worst:3d}   "
              f"over 40: {100 * bad / n:5.2f}%")
    a.resize((a.size[0] * 2, a.size[1] * 2), Image.NEAREST).save(OUT / "ours.png")
    b.resize((b.size[0] * 2, b.size[1] * 2), Image.NEAREST).save(OUT / "master.png")
    diff.resize((diff.size[0] * 2, diff.size[1] * 2), Image.NEAREST).save(OUT / "diff.png")
    stack = Image.new("RGB", (a.size[0], a.size[1] * 3 + 8), (20, 20, 20))
    stack.paste(b, (0, 0))
    stack.paste(a, (0, a.size[1] + 4))
    stack.paste(diff, (0, a.size[1] * 2 + 8))
    stack.resize((stack.size[0] * 2, stack.size[1] * 2), Image.NEAREST).save(
        OUT / "stack.png"
    )
    print(f"wrote {OUT}/ (master, ours, diff, stack)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
