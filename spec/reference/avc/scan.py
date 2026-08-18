"""Targeted scanlines over a 4x master render (288dpi → 1 render px = .25 design px).
Reports colour-run transitions along a design-space row or column, so exact frame
edges and stroke thicknesses can be read instead of estimated."""
import zlib, struct, sys

def load(path):
    d=open(path,"rb").read(); pos=8; w=h=None; idat=b""; ctype=None; plte=None
    while pos<len(d):
        ln=struct.unpack(">I",d[pos:pos+4])[0]; typ=d[pos+4:pos+8]; data=d[pos+8:pos+8+ln]
        if typ==b"IHDR": w,h,_,ctype=struct.unpack(">IIBB",data[:10])
        elif typ==b"IDAT": idat+=data
        elif typ==b"PLTE": plte=data
        pos+=12+ln
    raw=zlib.decompress(idat); ch={0:1,2:3,3:1,4:2,6:4}[ctype]; stride=w*ch
    out=bytearray(w*h*3); prev=bytearray(stride); i=0
    for row in range(h):
        f=raw[i]; i+=1; line=bytearray(raw[i:i+stride]); i+=stride
        if f==1:
            for x in range(ch,stride): line[x]=(line[x]+line[x-ch])&255
        elif f==2:
            for x in range(stride): line[x]=(line[x]+prev[x])&255
        elif f==3:
            for x in range(stride):
                a=line[x-ch] if x>=ch else 0; line[x]=(line[x]+((a+prev[x])>>1))&255
        elif f==4:
            for x in range(stride):
                a=line[x-ch] if x>=ch else 0; b=prev[x]; c=prev[x-ch] if x>=ch else 0
                p=a+b-c; pa,pb,pc=abs(p-a),abs(p-b),abs(p-c)
                pr=a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                line[x]=(line[x]+pr)&255
        prev=line; o=row*w*3
        if ctype==3:
            for x in range(w): idx=line[x]; out[o+x*3:o+x*3+3]=plte[idx*3:idx*3+3]
        else:
            for x in range(w): out[o+x*3:o+x*3+3]=line[x*ch:x*ch+3]
    return w,h,bytes(out)

W=H=PX=None
import os
SCALE=int(os.environ.get("SCAN_SCALE","4"))  # render px per design px

def rgb(dx,dy):
    x=int(dx*SCALE); y=int(dy*SCALE)
    o=(y*W+x)*3
    return PX[o],PX[o+1],PX[o+2]

def cls(c):
    r,g,b=c
    if r>225 and g>225 and b>225: return "W"       # plate white
    if r>200 and g<80 and b<95: return "R"         # accent red
    if r<60 and g<60 and b<80: return "K"          # deep navy ground
    if g>90 and r<90: return "G"                   # green (BRA flag)
    return "."                                      # gradient/other

def runs(fixed, frm, to, axis):
    """axis 'x': scan x from..to at y=fixed. Returns [(class, start, end_exclusive)]."""
    out=[]; prev=None; start=None
    n=int((to-frm)*SCALE)
    for i in range(n+1):
        d=frm+i/SCALE
        c=cls(rgb(d,fixed) if axis=="x" else rgb(fixed,d))
        if c!=prev:
            if prev is not None: out.append((prev,round(start,2),round(d,2)))
            prev=c; start=d
    out.append((prev,round(start,2),round(to,2)))
    return [(c,a,b,round(b-a,2)) for c,a,b in out]

if __name__=="__main__":
    W,H,PX=load(sys.argv[1])
    print(f"loaded {W}x{H} (design {W//SCALE}x{H//SCALE})")
    for spec in sys.argv[2:]:
        axis,fixed,frm,to = spec.split(",")
        r=runs(float(fixed),float(frm),float(to),axis)
        label=f"{axis}-scan at {'y' if axis=='x' else 'x'}={fixed} [{frm}..{to}]"
        print(f"\n{label}")
        for c,a,b,ln in r:
            if ln>=0.5 or c in ("R","W"): print(f"   {c}  {a:>8} → {b:>8}   len={ln}")
