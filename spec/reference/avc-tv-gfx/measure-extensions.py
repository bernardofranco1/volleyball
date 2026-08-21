#!/usr/bin/env python3
"""
Measure the AVC TV-GFX score-bug extension graphics from the 1920x1080 reference
frames in ./frames, to sub-pixel precision, in DESIGN pixels (== image pixels).

Why not just eyeball a scanline
------------------------------
The graphics are flat colour composited over a photograph, so "where is the
panel edge" is a segmentation problem, and a single horizontal scanline through
a panel runs straight through the glyphs of its own text. Four things make the
numbers here trustworthy:

  * per-row edge finding, never one scanline. A slanted edge is traced row by
    row and then FITTED (slope + notch), so a stray row cannot move the answer.

  * sub-pixel edges from coverage, not from thresholding. At an edge the pixel
    is a linear blend  px = f*INSIDE + (1-f)*OUTSIDE.  Projecting the pixel onto
    (INSIDE-OUTSIDE) recovers f, and summing f across the transition window
    gives the edge position directly (see `edge_1d`). INSIDE/OUTSIDE are taken
    from real pixels a few px either side of the edge, which is what makes this
    survive both the photographic background and the faint diagonal maroon
    pinstripes inside the panels.

  * the panels are NOT flat: they are horizontal gradients at ~0.88 alpha, so
    type is measured against a ground colour estimated PER COLUMN from rows of
    the same panel above and below the type (`ink_bbox`), not against a single
    assumed panel colour.

  * ink is thresholded at 50% coverage. Taking "any non-ground pixel" as ink
    inflates every glyph by 1-2 px, which is the difference between reading
    20 px type and reading 24 px type.

Known limit: in these frames the HORIZONTAL panel edges are hard (row 939 is
pure photo, row 940 is pure panel), so a horizontal edge can only be reported to
the pixel boundary it lands on. Slanted and vertical edges carry real sub-pixel
information and are reported to ~0.05 px.

Usage:  python3 measure-extensions.py [calib|sub|challenge|timeout|keymoment|card|ball|all]
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

FRAMES = Path(__file__).resolve().parent / "frames"

# The only colours the graphics are allowed to use (AVC guidelines p10).
NAVY = np.array([0, 11, 53], float)
RED = np.array([232, 28, 55], float)
WHITE = np.array([255, 255, 255], float)
LIGHTBLUE = np.array([74, 144, 194], float)  # flag notch / position-code accent
PALETTE = {"NAVY": NAVY, "RED": RED, "WHITE": WHITE, "LB": LIGHTBLUE}

# Font ink-height -> em ratios (validated against the masters).
ANCORLI_CAP = 0.700
ANCORLI_DIGIT = 0.718
ENCODE_CAP = 0.740
ENCODE_DIGIT = 0.759


# --------------------------------------------------------------------------- #
# primitives
# --------------------------------------------------------------------------- #
BAND_Y0 = 860
"""
Where the stored frames begin, in frame coordinates.

The reference stills are kept CROPPED to y 860-1020 — the band every graphic in
spec/47 lives in — because eight full 1920x1080 stills were 24 MB of repository
for 8% of the pixels anyone measures. `load` pads them back out, so every y in
this file is a frame coordinate and nothing downstream has to know.
"""


def load(name: str) -> np.ndarray:
    """Frame as float RGB, shape (1080, 1920, 3)."""
    band = name.replace("-1920x1080", f"-band-y{BAND_Y0}")
    path = FRAMES / band if (FRAMES / band).exists() else FRAMES / name
    if not path.exists():
        raise SystemExit(
            f"no frame {path.name}. The out-of-scope stills (match result, serve "
            f"points, yellow card) were dropped from the repo; re-extract from "
            f"the guidelines PDF with pdfimages if you need them."
        )
    im = np.asarray(Image.open(path).convert("RGB")).astype(float)
    if im.shape[0] == 1080:
        return im
    # Pad the crop back into a full frame so all coordinates stay frame-relative.
    full = np.zeros((1080, im.shape[1], 3), dtype=float)
    full[BAND_Y0 : BAND_Y0 + im.shape[0]] = im
    return full


def masks(a: np.ndarray, tol: float = 45.0) -> dict:
    """
    Per-palette-colour boolean masks. tol is generous (45/channel) on purpose:
    the panels carry faint diagonal maroon pinstripes, so a panel is not uniform
    and a tight tolerance segments the pinstripes out of their own panel.
    """
    return {k: (np.abs(a - c) <= tol).all(-1) for k, c in PALETTE.items()}


def edge_1d(seq: np.ndarray, i_out: int, i_in: int) -> float | None:
    """
    Sub-pixel position of the OUT->IN boundary along a 1-D RGB scan.

    seq[i_out] must be entirely outside the region, seq[i_in] entirely inside;
    indices between them are the antialiased transition. Pixel i covers
    [i, i+1). Coverage of pixel i by the region is clamp(i+1-e) when the region
    is at HIGHER index and clamp(e-i) when it is at LOWER index, so summing the
    coverages over the window pins e exactly.
    """
    out, ins = seq[i_out], seq[i_in]
    d = ins - out
    n2 = float(d @ d)
    if n2 < 400.0:  # the two sides are not distinguishable -> refuse to guess
        return None
    lo, hi = min(i_out, i_in), max(i_out, i_in)
    cov = sum(min(max(float((seq[i] - out) @ d) / n2, 0.0), 1.0) for i in range(lo, hi + 1))
    return (hi + 1 - cov) if i_in > i_out else (lo + cov)


def edge_x(a, y: int, x_out: int, x_in: int):
    """Sub-pixel x of a vertical/slanted edge on row y."""
    lo, hi = min(x_out, x_in), max(x_out, x_in)
    e = edge_1d(a[y, lo : hi + 1], x_out - lo, x_in - lo)
    return None if e is None else e + lo


def edge_y(a, x: int, y_out: int, y_in: int):
    """Sub-pixel y of a horizontal edge on column x."""
    lo, hi = min(y_out, y_in), max(y_out, y_in)
    e = edge_1d(a[lo : hi + 1, x], y_out - lo, y_in - lo)
    return None if e is None else e + lo


def med(vals, label, fmt="{:8.2f}"):
    v = [q for q in vals if q is not None]
    if not v:
        print(f"  {label:44s} n/a")
        return None
    m = float(np.median(v))
    print(f"  {label:44s} " + fmt.format(m) + f"   (sd {np.std(v):.2f}, n {len(v)})")
    return m


def runs(mask, y: int, x0: int, x1: int, minlen: int = 2):
    """Runs of a mask along row y, as inclusive [x_first, x_last] pixel indices."""
    out, start = [], None
    for x in range(x0, x1):
        if mask[y, x] and start is None:
            start = x
        elif not mask[y, x] and start is not None:
            out.append((start, x - 1))
            start = None
    if start is not None:
        out.append((start, x1 - 1))
    return [r for r in out if r[1] - r[0] + 1 >= minlen]


def trace_mask_edge(a, mask, y0, y1, xlo, xhi, which="start", pad=3):
    """
    Trace one slanted edge row by row -> {y: sub-pixel x}. The integer seed is
    the first ('start') or last ('end') pixel of the longest run of `mask`
    inside [xlo, xhi); it is then refined with edge_x.
    """
    out = {}
    for y in range(y0, y1):
        rs = runs(mask, y, xlo, xhi)
        if not rs:
            continue
        r = max(rs, key=lambda t: t[1] - t[0])
        seed = r[0] if which == "start" else r[1]
        e = edge_x(a, y, seed - pad, seed + pad) if which == "start" else edge_x(a, y, seed + pad, seed - pad)
        out[y] = float(seed) if e is None else e
    return out


def trace_dark_edge(a, y0, y1, xlo, xhi, which="start", thr=380.0, pad=3, minrun=6):
    """
    Trace a panel edge against the photograph by luminance instead of by palette
    colour. The court is bright (salmon sum 555, teal sum 424) and every panel
    pixel is dark (<=320 even at its reddest), so a sum threshold finds the panel
    on frames where the panel is a gradient and matches no single palette colour.

    `minrun` requires the dark region to persist for that many pixels: the white
    court markings and player shadows outside the panel are thinner than that,
    and without it they steal the seed on a handful of rows.
    """
    dark = a.sum(-1) < thr
    out = {}
    for y in range(y0, y1):
        rs = runs(dark, y, xlo, xhi, minlen=minrun)
        if not rs:
            continue
        r = rs[0] if which == "start" else rs[-1]
        seed = r[0] if which == "start" else r[1]
        e = edge_x(a, y, seed - pad, seed + pad) if which == "start" else edge_x(a, y, seed + pad, seed - pad)
        out[y] = float(seed) if e is None else e
    return out


def fit_line(trace, y0=None, y1=None):
    """Least-squares x = s*y + c over an optional row window -> (slope, x(y))."""
    ys = [y for y in sorted(trace) if (y0 is None or y >= y0) and (y1 is None or y <= y1)]
    s, c = np.polyfit(ys, [trace[y] for y in ys], 1)
    res = max(abs(trace[y] - (s * y + c)) for y in ys)
    return s, (lambda y: s * y + c), res


def find_notch(trace):
    """
    The one place where a slanted edge steps sideways. Returns
    (y_upper_last, y_lower_first, step) with the step corrected for the slope of
    the upper segment, or None. Detected as the single largest ABSOLUTE
    row-to-row jump (on a right-hand edge the step is positive in x but is still
    a step towards the bar's centre, i.e. "left" along the edge's own normal).
    """
    ys = sorted(trace)
    jumps = [(abs(trace[b] - trace[a]), a, b) for a, b in zip(ys, ys[1:]) if b == a + 1]
    if not jumps:
        return None
    _, a, b = max(jumps)
    if abs(trace[b] - trace[a]) < 1.5 or a - ys[0] < 4 or ys[-1] - b < 4:
        return None
    s_up = fit_line(trace, ys[0], a)[0]
    return a, b, (trace[b] - trace[a]) - s_up


def despike(trace, tol=2.5):
    """
    Drop rows whose x is off the local trend: on some frames the court markings
    under the panel confuse the luminance seed for a row or two.
    """
    ys = sorted(trace)
    keep = {}
    for i, y in enumerate(ys):
        lo, hi = max(0, i - 4), min(len(ys), i + 5)
        nb = [trace[ys[j]] for j in range(lo, hi) if ys[j] != y]
        if abs(trace[y] - float(np.median(nb))) <= tol + 0.34 * 4:
            keep[y] = trace[y]
    return keep


def ink_bbox(a, x0, x1, y0, y1, ink, ground_rows, thr=0.5):
    """
    Bounding box of `ink`-coloured type at 50% coverage, with the panel colour
    estimated PER COLUMN from `ground_rows` (rows of the same panel that carry no
    type). That is what lets this read type off a gradient panel.
    """
    g = np.median(a[ground_rows, x0:x1], axis=0)  # (n,3) ground per column
    d = ink - g  # (n,3)
    sub = a[y0:y1, x0:x1]
    f = ((sub * d).sum(-1) - (g * d).sum(-1)) / (d * d).sum(-1)
    m = f >= thr
    if not m.any():
        return None
    ys, xs = np.where(m)
    return (x0 + xs.min(), x0 + xs.max() + 1, y0 + ys.min(), y0 + ys.max() + 1)


def ink_glyphs(a, x0, x1, y0, y1, ink, ground_rows, thr=0.5):
    """Same mask as ink_bbox, split into per-glyph column runs (finds the true
    cap height: the only tall glyph in 'JANTHAWISUT' is the descending J)."""
    g = np.median(a[ground_rows, x0:x1], axis=0)
    d = ink - g
    sub = a[y0:y1, x0:x1]
    m = ((sub * d).sum(-1) - (g * d).sum(-1)) / (d * d).sum(-1) >= thr
    cols, out, st = m.sum(0), [], None
    for i, v in enumerate(cols):
        if v > 0 and st is None:
            st = i
        elif v == 0 and st is not None:
            out.append((st, i - 1))
            st = None
    if st is not None:
        out.append((st, len(cols) - 1))
    res = []
    for s, e in out:
        ys = np.where(m[:, s : e + 1].any(1))[0]
        res.append((x0 + s, x0 + e + 1, y0 + ys.min(), y0 + ys.max() + 1))
    return res


def show(tag, bb, ratio=None, fname=""):
    if bb is None:
        print(f"  {tag:30s} n/a")
        return
    x0, x1, y0, y1 = bb
    s = (
        f"  {tag:30s} x {x0:7.2f}->{x1:7.2f} (w {x1 - x0:6.2f})  "
        f"y {y0:7.2f}->{y1:7.2f} (h {y1 - y0:5.2f})"
    )
    if ratio:
        s += f"  -> {fname} {(y1 - y0) / ratio:.1f}px"
    print(s)


def px(a, y, x):
    return tuple(int(v) for v in a[y, x])


def modal(a, y0, y1, x0, x1):
    """Modal colour of a region (robust to pinstripes and glyphs)."""
    q = a[y0:y1, x0:x1].reshape(-1, 3).astype(int)
    u, c = np.unique(q, axis=0, return_counts=True)
    return tuple(u[c.argmax()])


def darkest(a, y0, y1, x0, x1):
    """Darkest pixel of a region: the panel base colour, ignoring pinstripes."""
    q = a[y0:y1, x0:x1].reshape(-1, 3)
    return tuple(int(v) for v in q[q.sum(1).argmin()])


def gradient(a, y0, y1, xs, label):
    print(f"  {label}")
    for x in xs:
        print(f"     x {x:4d}  {darkest(a, y0, y1, x, x + 3)}")


# --------------------------------------------------------------------------- #
# 1. CALIBRATION on p23 (the permanent score bug)
# --------------------------------------------------------------------------- #
def calib():
    a = load("p23-04-scoreboard-1920x1080.png")
    m = masks(a)
    print("=== CALIBRATION: p23-04-scoreboard ===")

    # Bar top / bottom. Columns inside the navy panel, clear of type.
    cols = list(range(606, 650)) + list(range(1240, 1300))
    med((edge_y(a, x, 936, 943) for x in cols), "bar top edge y")
    med((edge_y(a, x, 1003, 996) for x in cols), "bar bottom edge y")
    print(f"  team-colour accent strip under the bar, x=700:  "
          f"{[px(a, y, 700) for y in range(999, 1006)]}")
    print(f"  team-colour accent strip under the bar, x=1250: "
          f"{[px(a, y, 1250) for y in range(999, 1006)]}")

    # Flag panels: vertical outer edges.
    med((edge_x(a, y, 521, 528) for y in range(945, 995)), "left flag panel LEFT edge x")
    med((edge_x(a, y, 1400, 1392) for y in range(945, 995)), "right flag panel RIGHT edge x")

    # Red SETS blocks, at the bar's top row and bottom row.
    for label, y, xo, xi in (
        ("left red block  LEFT  edge @y940", 940, 751, 759),
        ("left red block  RIGHT edge @y940", 940, 831, 823),
        ("right red block LEFT  edge @y940", 940, 1088, 1096),
        ("right red block RIGHT edge @y940", 940, 1169, 1161),
        ("right red block LEFT  edge @y999", 999, 1075, 1083),
    ):
        print(f"  {label:44s} {edge_x(a, y, xo, xi):8.2f}")

    # The navy panel's own left/right edges are OCCLUDED by the flag + notch
    # slivers, so only the VISIBLE navy boundary can be read from this frame.
    print(f"  {'visible navy left  edge @y940':44s} {edge_x(a, 940, 612, 620):8.2f}")
    print(f"  {'visible navy right edge @y940':44s} {edge_x(a, 940, 1307, 1299):8.2f}")

    # Mirror axis, from the two red blocks and the two flag panels.
    lo = edge_x(a, 940, 751, 759)
    hi = edge_x(a, 940, 1169, 1161)
    fl = np.median([q for q in (edge_x(a, y, 521, 528) for y in range(945, 995)) if q])
    fr = np.median([q for q in (edge_x(a, y, 1400, 1392) for y in range(945, 995)) if q])
    print(f"  {'mirror axis from red blocks':44s} {(lo + hi) / 2:8.2f}")
    print(f"  {'mirror axis from flag panels':44s} {(fl + fr) / 2:8.2f}")

    # Slope + notch on independent panel edges.
    print("\n-- slope / notch, per edge "
          f"(1/3 = {1/3:.4f}, tan 18deg = {np.tan(np.radians(18)):.4f}) --")
    for label, (mk, xlo, xhi, which) in {
        "left red block  LEFT  edge": ("RED", 745, 775, "start"),
        "left red block  RIGHT edge": ("RED", 818, 850, "end"),
        "right red block LEFT  edge": ("RED", 1070, 1100, "start"),
        "right red block RIGHT edge": ("RED", 1140, 1175, "end"),
        "right flag-notch LB sliver": ("LB", 1285, 1320, "start"),
    }.items():
        tr = trace_mask_edge(a, m[mk], 941, 999, xlo, xhi, which)
        n = find_notch(tr)
        if n is None:
            s, f, r = fit_line(tr)
            print(f"  {label:28s} slope {s:+.4f}  no notch  maxres {r:.2f}")
            continue
        yu, yl, step = n
        su, fu, ru = fit_line(tr, min(tr), yu)
        sl, fl_, rl = fit_line(tr, yl, max(tr))
        print(
            f"  {label:28s} slope upper {su:+.4f} lower {sl:+.4f}   "
            f"notch between y{yu} and y{yl}, dx {step:+.2f}   "
            f"x@940 {fu(940):.2f}  x@1000 {fl_(1000):.2f}  maxres {max(ru, rl):.2f}"
        )

    # AVC roundel. Window 930..992 excludes the "10" glyphs either side of it.
    logo = m["RED"] | m["WHITE"] | m["LB"]
    ys, xs = np.where(logo[941:1000, 930:992])
    print(f"\n  {'AVC roundel bbox':30s} x {930 + xs.min():.2f}->{930 + xs.max() + 1:.2f}"
          f"  y {941 + ys.min():.2f}->{941 + ys.max() + 1:.2f}")

    # Serve ball. The Mikasa is yellow + dark blue + white; the panel and its
    # pinstripes all sit at B~53 and G<40, so (|B-53|>25 or G>60) isolates it.
    # The window stops at 876 so the white "10" cannot leak in.
    ball = (np.abs(a[..., 2] - 53) > 25) | (a[..., 1] > 60)
    ys, xs = np.where(ball[945:998, 838:876])
    print(f"  {'serve ball bbox (LEFT slot)':30s} x {838 + xs.min():.2f}->{838 + xs.max() + 1:.2f}"
          f"  y {945 + ys.min():.2f}->{945 + ys.max() + 1:.2f}")

    # Type on the bug: a check that the ink-height -> font-size ratios hold.
    print("\n-- type on the bug --")
    gr_navy = list(range(944, 950)) + list(range(991, 997))
    gr_red = [943, 944, 945]
    for label, (x0, x1, y0, y1, gr, ratio, fname) in {
        "THA country code": (638, 745, 948, 992, gr_navy, ANCORLI_CAP, "Ancorli caps"),
        "left game score 10": (874, 928, 948, 992, gr_navy, ANCORLI_DIGIT, "Ancorli digits"),
        "right game score 10": (995, 1048, 948, 992, gr_navy, ANCORLI_DIGIT, "Ancorli digits"),
        "left SETS digit 0": (786, 812, 946, 976, gr_red, ENCODE_DIGIT, "Encode digits"),
        "left SETS word": (778, 822, 977, 995, gr_red, ENCODE_CAP, "Encode caps"),
    }.items():
        show(label, ink_bbox(a, x0, x1, y0, y1, WHITE, gr), ratio, fname)


# --------------------------------------------------------------------------- #
# 2. SUBSTITUTION (p32)
# --------------------------------------------------------------------------- #
def substitution():
    a = load("p32-18-substitution-left-1920x1080.png")
    print("\n=== SUBSTITUTION  p32-18-substitution-left ===")
    _two_row_block(a, upper_text=(238, 470), has_arrows=True)

    print("\n-- UPPER row elements (navy-side row, player 11 JANTHAWISUT) --")
    gr = list(range(899, 907)) + list(range(929, 936))
    show("position code OH (LB ink)", ink_bbox(a, 125, 168, 900, 935, LIGHTBLUE, gr),
         ENCODE_CAP, "Encode caps")
    for g in ink_glyphs(a, 238, 470, 900, 935, WHITE, gr):
        show("  name glyph", g)
    show("number 11 (white ink)", ink_bbox(a, 186, 216, 905, 932, WHITE, [903, 904, 930, 931]),
         ENCODE_DIGIT, "Encode digits")
    _shirt(a, 896, 939, 166, 240, "upper")
    _arrow(a, 905, 930, 478, 520, "upper")

    print("\n-- LOWER row elements (red-side row, player 10 MOONJAKHAM) --")
    gr2 = list(range(946, 956)) + list(range(988, 998))
    show("position code OP (LB ink)", ink_bbox(a, 136, 178, 945, 998, LIGHTBLUE, gr2),
         ENCODE_CAP, "Encode caps")
    for g in ink_glyphs(a, 262, 470, 946, 998, WHITE, gr2):
        show("  name glyph", g)
    show("number 10 (white ink)", ink_bbox(a, 196, 236, 955, 985, WHITE, [950, 951, 986, 987]),
         ENCODE_DIGIT, "Encode digits")
    _shirt(a, 941, 1000, 172, 265, "lower")
    _arrow(a, 955, 980, 476, 520, "lower")


def _two_row_block(a, upper_text, has_arrows):
    """Geometry shared by the substitution and card blocks: two docked rows."""
    med((edge_y(a, x, 888, 900) for x in range(300, 470)), "upper row TOP edge y")
    print(f"  {'row separator (column probe x=430)':44s} "
          f"{[(y, px(a, y, 430)) for y in range(936, 942)]}")
    med((edge_y(a, x, 1004, 996) for x in range(300, 470)), "lower row BOTTOM edge y")
    med((edge_x(a, y, 532, 518) for y in range(900, 932)), "upper row RIGHT edge x")
    med((edge_x(a, y, 532, 518) for y in range(945, 998)), "lower row RIGHT edge x")

    for label, (y0, y1, xlo, xhi) in {
        "upper row LEFT edge": (894, 938, 60, 200),
        "lower row LEFT edge": (940, 1000, 60, 200),
    }.items():
        tr = despike(trace_dark_edge(a, y0, y1, xlo, xhi, "start"))
        n = find_notch(tr)
        if n is None:
            s, f, r = fit_line(tr)
            print(f"  {label:28s} slope {s:+.4f} no notch  x@{y0} {f(y0):.2f}  "
                  f"x@{y1} {f(y1):.2f}  maxres {r:.2f}")
        else:
            yu, yl, step = n
            su, fu, ru = fit_line(tr, min(tr), yu)
            sl, fl_, rl = fit_line(tr, yl, max(tr))
            print(f"  {label:28s} slope upper {su:+.4f} lower {sl:+.4f}  "
                  f"notch between y{yu} and y{yl} dx {step:+.2f}  "
                  f"x@{y0} {fu(y0):.2f}  x@{y1} {fl_(y1):.2f}")

    gradient(a, 928, 936, [120, 140, 170, 200, 260, 320, 380, 440, 500, 522],
             "upper row fill, base colour (darkest px) across x:")
    gradient(a, 990, 999, [130, 150, 180, 200, 260, 320, 380, 440, 500, 522],
             "lower row fill, base colour (darkest px) across x:")


def _shirt(a, y0, y1, x0, x1, tag):
    """Jersey icon: red body, ~1px white outline, clipped by the row's bottom."""
    m = masks(a, 55)
    ys, xs = np.where(m["RED"][y0:y1, x0:x1])
    print(f"  shirt {tag} RED body            x {x0 + xs.min():.2f}->{x0 + xs.max() + 1:.2f}"
          f"  y {y0 + ys.min():.2f}->{y0 + ys.max() + 1:.2f}"
          f"   fill {modal(a, y0 + 8, y0 + 14, x0 + 12, x0 + 20)}")
    w = (a[..., 0] > 150) & (a[..., 1] > 150) & (a[..., 2] > 150)
    ys, xs = np.where(w[y0:y1, x0:x1])
    print(f"  shirt {tag} + white outline     x {x0 + xs.min():.2f}->{x0 + xs.max() + 1:.2f}"
          f"  y {y0 + ys.min():.2f}->{y0 + ys.max() + 1:.2f}")


def _arrow(a, y0, y1, x0, x1, tag):
    """Triangle: print an ASCII map, then its bbox. G=green fill, W=white."""
    print(f"  {tag} arrow map (x {x0}..{x1}):")
    gmin, gmax, wxs, wys = None, None, [], []
    for y in range(y0, y1):
        row = ""
        for x in range(x0, x1):
            c = a[y, x]
            if c[1] > 110 and c[0] < 170:
                row += "G"
                wxs.append(x)
                wys.append(y)
            elif min(c) > 150:
                row += "W"
                wxs.append(x)
                wys.append(y)
            else:
                row += "."
        print(f"     {y} {row}")
    print(f"  {tag} arrow bbox              x {min(wxs):.2f}->{max(wxs) + 1:.2f}"
          f"  y {min(wys):.2f}->{max(wys) + 1:.2f}")


# --------------------------------------------------------------------------- #
# 3/4. the CHALLENGE and TIMEOUT tabs share one shape
# --------------------------------------------------------------------------- #
def tab(frame, label, text_window):
    a = load(frame)
    print(f"\n=== {label}  {frame} ===")
    # columns 700..742 are tab-only (right of the type, left of the slant)
    med((edge_y(a, x, 899, 912) for x in range(700, 742)), "tab TOP edge y")
    print(f"  {'tab bottom (column probe x=730)':44s} "
          f"{[(y, px(a, y, 730)) for y in range(936, 942)]}")
    med((edge_x(a, y, 519, 530) for y in range(912, 936)), "tab LEFT edge x (vertical)")
    tr = trace_dark_edge(a, 905, 940, 700, 790, "end", thr=400)
    s, f, r = fit_line(tr)
    print(f"  {'tab RIGHT edge (slanted)':44s} slope {s:+.4f}  "
          f"x@904 {f(904):.2f}  x@938 {f(938):.2f}  maxres {r:.2f}")
    gradient(a, 906, 912, [527, 560, 600, 640, 680, 720, 745],
             "tab fill, base colour (darkest px) across x:")
    gr = list(range(906, 912)) + list(range(931, 937))
    show("text ink (all glyphs)", ink_bbox(a, *text_window, 906, 937, WHITE, gr),
         ENCODE_CAP, "Encode caps")
    for g in ink_glyphs(a, *text_window, 906, 937, WHITE, gr):
        show("  glyph", g)
    return a


def challenge():
    tab("p33-21-challenge-alert-left-1920x1080.png", "VIDEO CHALLENGE ALERT", (555, 710))


def timeout():
    a = tab("p35-22-timeout-left-1920x1080.png", "TIMEOUT", (555, 730))
    print("  pip map (x 666..718): W=white stroke, B=lightblue fill, +=antialias")
    for y in range(910, 932):
        row = ""
        for x in range(666, 718):
            c = a[y, x]
            if min(c) > 150:
                row += "W"
            elif c[2] > 140 and c[1] > 110 and c[0] < 130:
                row += "B"
            elif min(c) > 90:
                row += "+"
            else:
                row += "."
        print(f"     {y} {row}")
    for tag, (x0, x1) in (("pip 1 (used)", (664, 692)), ("pip 2 (available)", (692, 718))):
        sub = np.zeros((22, x1 - x0), bool)
        for i, y in enumerate(range(910, 932)):
            for j, x in enumerate(range(x0, x1)):
                c = a[y, x]
                sub[i, j] = min(c) > 130 or (c[2] > 140 and c[1] > 110 and c[0] < 130)
        ys, xs = np.where(sub)
        bx0, bx1, by0, by1 = x0 + xs.min(), x0 + xs.max() + 1, 910 + ys.min(), 910 + ys.max() + 1
        print(f"  {tag:18s} bbox x {bx0:.2f}->{bx1:.2f} y {by0:.2f}->{by1:.2f}"
              f"  centre ({(bx0 + bx1) / 2:.2f},{(by0 + by1) / 2:.2f})"
              f"  r {((bx1 - bx0) + (by1 - by0)) / 4:.2f}"
              f"  interior {px(a, (by0 + by1) // 2, (bx0 + bx1) // 2)}")


# --------------------------------------------------------------------------- #
# 5. KEY MOMENT (p40) - the MATCH POINT strap
# --------------------------------------------------------------------------- #
def keymoment():
    a = load("p40-40-match-point-left-1920x1080.png")
    print("\n=== KEY MOMENT (MATCH POINT)  p40-40-match-point-left ===")
    med((edge_y(a, x, 936, 944) for x in range(160, 300)), "strap TOP edge y")
    med((edge_y(a, x, 1004, 996) for x in range(160, 300)), "strap BOTTOM edge y")
    med((edge_x(a, y, 532, 518) for y in range(945, 998)), "strap RIGHT edge x (docks at flag)")
    tr = despike(trace_dark_edge(a, 941, 1000, 80, 200, "start"))
    yu, yl, step = find_notch(tr)
    su, fu, _ = fit_line(tr, min(tr), yu)
    sl, fl_, _ = fit_line(tr, yl, max(tr))
    print(f"  {'strap LEFT edge (slanted)':44s} slope upper {su:+.4f} lower {sl:+.4f}"
          f"  notch between y{yu} and y{yl} dx {step:+.2f}"
          f"  x@940 {fu(940):.2f}  x@1000 {fl_(1000):.2f}")
    gradient(a, 943, 950, [125, 150, 180, 220, 260, 300, 350, 400, 450, 500, 522],
             "strap fill, base colour (darkest px) across x:")
    gr = list(range(943, 950)) + list(range(991, 998))
    show("text ink (all glyphs)", ink_bbox(a, 170, 500, 948, 992, WHITE, gr),
         ANCORLI_CAP, "Ancorli caps")
    for g in ink_glyphs(a, 170, 500, 948, 992, WHITE, gr):
        show("  glyph", g)


# --------------------------------------------------------------------------- #
# 6. YELLOW CARD (p44) - same two-row block as the substitution
# --------------------------------------------------------------------------- #
def card():
    a = load("p44-45-yellow-card-left-1920x1080.png")
    print("\n=== YELLOW CARD  p44-45-yellow-card-left ===")
    _two_row_block(a, upper_text=(175, 520), has_arrows=False)
    yellow = (a[..., 0] > 190) & (a[..., 1] > 170) & (a[..., 2] < 110)
    ys, xs = np.where(yellow[890:940, 100:400])
    print(f"  {'yellow card swatch':30s} x {100 + xs.min():.2f}->{100 + xs.max() + 1:.2f}"
          f"  y {890 + ys.min():.2f}->{890 + ys.max() + 1:.2f}"
          f"   fill {modal(a, 900, 930, 118, 138)}")
    gr = list(range(899, 907)) + list(range(929, 936))
    show("YELLOW CARD text ink", ink_bbox(a, 175, 520, 900, 935, WHITE, gr),
         ENCODE_CAP, "Encode caps")
    gr2 = list(range(946, 956)) + list(range(988, 998))
    show("lower row name ink", ink_bbox(a, 262, 470, 946, 998, WHITE, gr2),
         ENCODE_CAP, "Encode caps")


# --------------------------------------------------------------------------- #
# 7. serve-ball slot across every frame
# --------------------------------------------------------------------------- #
def ball():
    print("\n=== serve ball slots, all frames ===")
    print("  (left slot window x838-876, right slot window x1044-1082, both y945-998)")
    for f in sorted(p.name for p in FRAMES.glob("*.png")):
        a = load(f)
        bm = (np.abs(a[..., 2] - 53) > 25) | (a[..., 1] > 60)
        out = []
        for slot, (x0, x1) in (("LEFT", (838, 876)), ("RIGHT", (1044, 1082))):
            sub = bm[945:998, x0:x1]
            if sub.sum() < 80:
                out.append(f"{slot}: empty ({int(sub.sum())}px)")
                continue
            ys, xs = np.where(sub)
            out.append(f"{slot}: x {x0 + xs.min()}->{x0 + xs.max() + 1} "
                       f"y {945 + ys.min()}->{945 + ys.max() + 1}")
        print(f"  {f:48s} " + " | ".join(out))
    print("  mirror of the measured left ball about the frame's axis x=960.00:"
          " x 1051.00->1074.00")


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    todo = {
        "calib": [calib],
        "sub": [substitution],
        "challenge": [challenge],
        "timeout": [timeout],
        "keymoment": [keymoment],
        "card": [card],
        "ball": [ball],
        "all": [calib, substitution, challenge, timeout, keymoment, card, ball],
    }[what]
    for fn in todo:
        fn()


if __name__ == "__main__":
    main()
