#!/usr/bin/env python3
"""
Isolate the named Illustrator layers of an AVC TV-GFX master and measure them.

The masters ship as .ai files that are PDF-compatible, and Illustrator preserves
its layer stack as PDF optional-content groups (OCGs). So each element of a
graphic — "Blue Bar", "THA", "Left Block", "Logo" — can be rendered ON ITS OWN,
which is what makes the geometry in src/components/tv/* measured rather than
estimated: a text layer alone has an exact ink bounding box, and that box is the
anchor the live text must land on.

The page box is 1920x1080 POINTS, so rendering at -r 72 gives one pixel per
design pixel and every number this prints is already in the units the components
use.

A master may use one NAME twice — 04_Scoreboard has two layers called "10", two
"SETS" and two "0", one per side of the bar — so selections are also accepted as
`#index` (the position `list` prints), which is the only way to measure one side
of such a pair on its own.

Usage:
  layers.py list  <master.ai>
  layers.py show  <master.ai> <out.png> [--only NAME|#i,...] [--not NAME|#i,...] [--dpi N]
  layers.py bbox  <master.ai> [--each] [--only NAME|#i,...]
"""

import subprocess
import sys
import tempfile
from pathlib import Path

import pikepdf
from PIL import Image

DESIGN_DPI = 72  # 1 pt == 1 design px on these masters


def layer_names(pdf: pikepdf.Pdf) -> list[str]:
    return [str(g.Name) for g in pdf.Root.OCProperties.OCGs]


def selected(ocgs: list, sel: list[str]) -> set[int]:
    """Indices matching a selection list of names and/or `#index` tokens."""
    out: set[int] = set()
    for token in sel:
        if token.startswith("#"):
            out.add(int(token[1:]))
        else:
            out.update(i for i, g in enumerate(ocgs) if str(g.Name) == token)
    return out


def render(
    master: Path, out: Path, only: list[str] | None, off: list[str], dpi: int
) -> Path:
    """Render the master with a chosen subset of layers visible."""
    with pikepdf.open(master) as pdf:
        ocgs = list(pdf.Root.OCProperties.OCGs)
        keep = selected(ocgs, only) if only is not None else set(range(len(ocgs)))
        drop = selected(ocgs, off)
        hide = [g for i, g in enumerate(ocgs) if i not in keep or i in drop]
        d = pdf.Root.OCProperties.D
        d["/OFF"] = pikepdf.Array(hide)
        d["/ON"] = pikepdf.Array([g for g in ocgs if g not in hide])
        # BaseState stays ON: poppler reads /OFF as the authority, and an
        # explicit /ON list keeps Acrobat agreeing with it if anyone opens the
        # intermediate file to check.
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            pdf.save(tmp.name)
            tmp_path = Path(tmp.name)
    stem = out.with_suffix("")
    subprocess.run(
        [
            "pdftocairo",
            "-png",
            "-transp",  # no white ground: the bar must key over video
            "-r",
            str(dpi),
            "-singlefile",
            str(tmp_path),
            str(stem),
        ],
        check=True,
    )
    tmp_path.unlink()
    return out


def ink_bbox(png: Path, threshold: int = 128) -> tuple[int, int, int, int] | None:
    """
    Bounding box of the layer's ink, in the PNG's own pixels.

    Thresholded at half alpha, not at "any alpha above zero": antialiasing feathers
    a glyph about a pixel past its outline on every side, and taking the feather as
    ink inflated every measurement here by 1-2 px. That is the difference between
    reading the country codes as 50 px type and reading them as the 48 px the
    guidelines specify — so render at 4x, threshold at 50% coverage, and divide.
    """
    im = Image.open(png).convert("RGBA")
    return im.getchannel("A").point(lambda a: 255 if a >= threshold else 0).getbbox()


def fmt(box: tuple[int, int, int, int] | None, dpi: int) -> str:
    if box is None:
        return "empty"
    s = DESIGN_DPI / dpi  # PNG px -> design px
    x0, y0, x1, y1 = (v * s for v in box)
    return (
        f"x {x0:8.2f} → {x1:8.2f}  (w {x1 - x0:7.2f})   "
        f"y {y0:8.2f} → {y1:8.2f}  (h {y1 - y0:6.2f})"
    )


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    cmd, master = sys.argv[1], Path(sys.argv[2])
    args = sys.argv[3:]

    def opt(flag: str) -> list[str] | None:
        if flag not in args:
            return None
        return args[args.index(flag) + 1].split(",")

    dpi = int(opt("--dpi")[0]) if opt("--dpi") else DESIGN_DPI

    if cmd == "list":
        with pikepdf.open(master) as pdf:
            for i, name in enumerate(layer_names(pdf)):
                print(f"[{i:2d}] {name}")
        return 0

    if cmd == "show":
        out = Path(args[0])
        render(master, out, opt("--only"), opt("--not") or [], dpi)
        print(out, ink_bbox(out))
        return 0

    if cmd == "bbox":
        with pikepdf.open(master) as pdf:
            names = layer_names(pdf)
        targets = opt("--only") or [f"#{i}" for i in range(len(names))]
        with tempfile.TemporaryDirectory() as td:
            if "--each" in args:
                # One layer at a time: this is the measurement pass.
                for token in targets:
                    png = Path(td) / "l.png"
                    render(master, png, [token], [], dpi)
                    label = (
                        f"#{token[1:]} {names[int(token[1:])]}"
                        if token.startswith("#")
                        else token
                    )
                    print(f"{label:22s} {fmt(ink_bbox(png), dpi)}")
            else:
                png = Path(td) / "l.png"
                render(master, png, targets, [], dpi)
                print(f"{'+'.join(targets)[:40]:40s} {fmt(ink_bbox(png), dpi)}")
        return 0

    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
