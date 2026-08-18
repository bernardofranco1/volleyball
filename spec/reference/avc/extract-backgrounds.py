"""How the official backgrounds in public/board-bg/avc-*.png were extracted
(2026-08-18): the .ai masters are PDF-compatible and carry named layers; turn
every layer except "Background" OFF in the default OC config, then render.
Requires: pikepdf, poppler (pdftoppm).

    python3 extract-backgrounds.py <master.ai> <out-prefix>
    pdftoppm -png -r 72 -singlefile <out-prefix>.pdf <out-prefix>
"""
import sys
import pikepdf

src, out = sys.argv[1], sys.argv[2]
pdf = pikepdf.open(src)
ocp = pdf.Root.OCProperties
ocgs = list(ocp.OCGs)
keep = [o for o in ocgs if str(o.Name) == "Background"]
off = [o for o in ocgs if str(o.Name) != "Background"]
ocp.D.OFF = pdf.make_indirect(pikepdf.Array(off))
ocp.D.ON = pdf.make_indirect(pikepdf.Array(keep))
pdf.save(out + ".pdf")
print("layers off:", [str(o.Name) for o in off])
