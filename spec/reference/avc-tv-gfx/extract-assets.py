#!/usr/bin/env python3
"""
Cut the TV score bug's own artwork out of the Illustrator master into
public/tv-gfx/, the way spec/35 cut the venue boards' backgrounds.

The bar is not flat colour. Its navy panels carry the AVC diagonal pinstripe,
every panel edge is slanted 1:3 with a 4 px notch at mid-height, and the flag
sits behind a stepped two-part accent. Redrawing that in CSS would be a
sincere imitation of the venue branding, which is not the same thing as the
venue branding — so the panels, the pinstripes, the red SETS blocks, the AVC
roundel, the accents and the serve ball are LIFTED FROM THE MASTER and the code
only positions live text on top of them.

What is deliberately NOT baked in: the country codes, the scores, the SETS
values and the flags. Those are the match.

Layer order matters. The flag is drawn OVER the bar's left end in the master
(the bar continues behind it), so the plate is emitted without the flag or its
accent and the component layers flag → accent → text above it.

Run:  python3 spec/reference/avc-tv-gfx/extract-assets.py
"""

import subprocess
import sys
import tempfile
from pathlib import Path

import pikepdf
from PIL import Image

MASTER = Path(
    "/home/fivb1/07 OSDP/TV GFX/AVC_Lower_Third_GFX_v01/(Footage)/04_Artwork/"
    "Ai Files/04_Scoreboard.ai"
)
OUT = Path("public/tv-gfx")
# 4x the design frame: the bar is 61 design px tall and lands on a 4K rail at
# 2x, so 4x leaves headroom and still weighs a few tens of KB.
SCALE = 4
DPI = 72 * SCALE

# name -> (layers to render, crop box in design px or None for the ink bbox)
ASSETS: dict[str, list[str]] = {
    # The static bar: navy ground, both pinstripe fields, both red SETS blocks
    # and the centre roundel.
    "bug-plate": [
        "Blue Bar",
        "Left Pattern",
        "Right Pattern",
        "Left Block",
        "Right Block",
        "Logo",
    ],
    # The stepped accent beside each flag — country-independent, so it is
    # artwork rather than markup, and it draws OVER the flag.
    "bug-accent-left": ["#17", "#18"],  # "Layer 24", "Layer 21"
    "bug-accent-right": ["#20", "#21"],  # "Layer 23", "Layer 22"
    # The serve ball. Its slot mirrors across the bar, so one asset serves both
    # sides and the component moves it.
    "bug-ball": ["#19"],  # "Layer 25"
}


def render(layers: list[str], dest: Path) -> tuple[float, float, float, float]:
    """Render `layers` alone on transparency; return the ink box in design px."""
    with pikepdf.open(MASTER) as pdf:
        ocgs = list(pdf.Root.OCProperties.OCGs)
        keep: set[int] = set()
        for token in layers:
            if token.startswith("#"):
                keep.add(int(token[1:]))
            else:
                keep.update(i for i, g in enumerate(ocgs) if str(g.Name) == token)
        hide = [g for i, g in enumerate(ocgs) if i not in keep]
        pdf.Root.OCProperties.D["/OFF"] = pikepdf.Array(hide)
        pdf.Root.OCProperties.D["/ON"] = pikepdf.Array(
            [g for i, g in enumerate(ocgs) if i in keep]
        )
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            pdf.save(tmp.name)
            tmp_path = Path(tmp.name)

    with tempfile.TemporaryDirectory() as td:
        stem = Path(td) / "page"
        subprocess.run(
            ["pdftocairo", "-png", "-transp", "-r", str(DPI), "-singlefile",
             str(tmp_path), str(stem)],
            check=True,
        )
        tmp_path.unlink()
        full = Image.open(stem.with_suffix(".png")).convert("RGBA")
        # Threshold at half alpha for the BOX only; the saved crop keeps the
        # real antialiasing, which is what makes a 1:3 slant look like an edge
        # rather than a staircase.
        box = full.getchannel("A").point(lambda a: 255 if a >= 128 else 0).getbbox()
        if box is None:
            raise SystemExit(f"nothing rendered for {layers}")
        full.crop(box).save(dest, optimize=True)
        return tuple(v / SCALE for v in box)  # type: ignore[return-value]


def main() -> int:
    if not MASTER.exists():
        print(f"master not found: {MASTER}", file=sys.stderr)
        print("(the AVC TV GFX package is not in the repo — it is a licensed "
              "delivery; re-run this from a machine that has it)", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"{'asset':22s} {'design px box':44s} size")
    for name, layers in ASSETS.items():
        dest = OUT / f"{name}.png"
        x0, y0, x1, y1 = render(layers, dest)
        kb = dest.stat().st_size / 1024
        print(
            f"{name:22s} x {x0:8.2f} → {x1:8.2f}  y {y0:8.2f} → {y1:8.2f}   "
            f"{kb:6.1f} KB"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
