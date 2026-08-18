"""Compare component geometry between the master (4x) and a 1x board render,
so offsets are read as numbers instead of guessed from a picture (spec/35 W8)."""
import sys, json
sys.path.insert(0, ".")
from measure import png_rgb, components

RED = lambda r,g,b: r>200 and g<80 and b<95
WHITE = lambda r,g,b: r>235 and g>235 and b>235

def boxes(path, scale):
    w,h,px = png_rgb(path)
    # components() assumes 4x (mask px = 2 render px, /4 for design). Re-derive.
    out={}
    for name,pred in (("red",RED),("white",WHITE)):
        bs=components(w,h,px,pred,60)
        if scale==1:
            for b in bs:
                b["x"]*=4; b["y"]*=4; b["w"]*=4; b["h"]*=4
        out[name]=bs
    return out

def find(bs, x, y, tol=26):
    best=None; bd=1e9
    for b in bs:
        d=abs(b["x"]-x)+abs(b["y"]-y)
        if d<bd: bd=d; best=b
    return best if bd<=tol*2 else None

master = boxes(sys.argv[1], 4)
actual = boxes(sys.argv[2], 1)

TARGETS = [
    ("red",   "big digit 2 (L plate)", 797.5, 174.5),
    ("white", "SET letter S",   889.5, 69.0),
    ("white", "name letter B",  202.5, 210.5),
    ("white", "ladder 2 (row1)",851.0, 509.0),
    ("white", "counter 1 (r1)", 872.0, 769.5),
    ("red",   "score+ladder+counters form", 726.5, 128.5),
    ("white", "big plate L",   738.5, 140.5),
    ("white", "big plate R",   966.5, 140.5),
    ("white", "sets plate L",  813.0, 343.5),
    ("white", "sets plate R",  965.5, 343.5),
    ("white", "PTS col L",     647.5, 382.0),
    ("white", "PTS col R",     1168.5, 382.0),
    ("white", "jersey L row1", 109.0, 457.5),
    ("white", "jersey R row1", 1737.5, 457.5),
    ("white", "jersey L row6", 109.0, 923.0),
    ("red",   "serve frame L", 97.0, 445.5),
    ("white", "flag R box",    1301.0, 171.5),
    ("white", "ball",          575.5, 468.5),
]
print(f"{'element':<28} {'master (x,y,w,h)':<30} {'actual':<30} delta")
for kind,label,mx,my in TARGETS:
    m=find(master[kind],mx,my); a=find(actual[kind],mx,my,tol=40)
    ms=f"{m['x']},{m['y']},{m['w']},{m['h']}" if m else "—"
    as_=f"{a['x']},{a['y']},{a['w']},{a['h']}" if a else "—"
    if m and a:
        d=f"dx={a['x']-m['x']:+.1f} dy={a['y']-m['y']:+.1f} dw={a['w']-m['w']:+.1f} dh={a['h']-m['h']:+.1f}"
    else: d="MISSING"
    print(f"{label:<28} {ms:<30} {as_:<30} {d}")
