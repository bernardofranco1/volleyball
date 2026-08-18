"""Measure the AVC masters: connected-component bounding boxes of the accent-red
and plate-white regions, at 4x (288 dpi), reported in DESIGN PX (1920x1080).
Pure-python PNG reader (no PIL in this environment)."""
import zlib, struct, sys, json

def png_rgb(path):
    d = open(path, "rb").read()
    pos = 8; w=h=None; idat=b""; ctype=None; plte=None
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos+4])[0]; typ = d[pos+4:pos+8]
        data = d[pos+8:pos+8+ln]
        if typ == b"IHDR": w,h,_,ctype = struct.unpack(">IIBB", data[:10])
        elif typ == b"IDAT": idat += data
        elif typ == b"PLTE": plte = data
        pos += 12+ln
    raw = zlib.decompress(idat)
    ch = {0:1,2:3,3:1,4:2,6:4}[ctype]
    stride = w*ch
    out = bytearray(w*h*3); prev = bytearray(stride)
    i=0
    for row in range(h):
        f = raw[i]; i+=1
        line = bytearray(raw[i:i+stride]); i+=stride
        if f==1:
            for x in range(ch,stride): line[x]=(line[x]+line[x-ch])&255
        elif f==2:
            for x in range(stride): line[x]=(line[x]+prev[x])&255
        elif f==3:
            for x in range(stride):
                a=line[x-ch] if x>=ch else 0
                line[x]=(line[x]+((a+prev[x])>>1))&255
        elif f==4:
            for x in range(stride):
                a=line[x-ch] if x>=ch else 0; b=prev[x]; c=prev[x-ch] if x>=ch else 0
                p=a+b-c; pa,pb,pc=abs(p-a),abs(p-b),abs(p-c)
                pr=a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                line[x]=(line[x]+pr)&255
        prev=line
        o=row*w*3
        if ctype==3:
            for x in range(w):
                idx=line[x]; out[o+x*3:o+x*3+3]=plte[idx*3:idx*3+3]
        else:
            for x in range(w):
                out[o+x*3:o+x*3+3]=line[x*ch:x*ch+3]
    return w,h,bytes(out)

def components(w,h,px,pred,minarea):
    """4-connected components on a downsampled (2x2) mask for speed."""
    W,H=w//2,h//2
    mask=bytearray(W*H)
    for y in range(H):
        oy=(y*2)*w*3
        for x in range(W):
            o=oy+(x*2)*3
            if pred(px[o],px[o+1],px[o+2]): mask[y*W+x]=1
    seen=bytearray(W*H); boxes=[]
    for start in range(W*H):
        if mask[start] and not seen[start]:
            stack=[start]; seen[start]=1
            minx=miny=10**9; maxx=maxy=-1; n=0
            while stack:
                p=stack.pop(); n+=1
                y,x=divmod(p,W)
                if x<minx:minx=x
                if x>maxx:maxx=x
                if y<miny:miny=y
                if y>maxy:maxy=y
                for q in (p-1,p+1,p-W,p+W):
                    if 0<=q<W*H and mask[q] and not seen[q]:
                        qy,qx=divmod(q,W)
                        if abs(qx-x)+abs(qy-y)==1:
                            seen[q]=1; stack.append(q)
            if n>=minarea:
                # scale: mask px = 2 render px = 0.5 design px at 4x → design = *2/4
                boxes.append({
                    "x": round(minx*2/4,1), "y": round(miny*2/4,1),
                    "w": round((maxx-minx+1)*2/4,1), "h": round((maxy-miny+1)*2/4,1),
                    "area_px": n,
                })
    return sorted(boxes, key=lambda b:(b["y"],b["x"]))

RED = lambda r,g,b: r>200 and g<70 and b<90
WHITE = lambda r,g,b: r>235 and g>235 and b>235

for name in sys.argv[1:]:
    w,h,px = png_rgb(name)
    out={"file":name,"render":[w,h],
         "red":components(w,h,px,RED,80),
         "white":components(w,h,px,WHITE,80)}
    j=name.replace(".png",".measure.json")
    json.dump(out,open(j,"w"),indent=1)
    print(j, "red:",len(out["red"]),"white:",len(out["white"]))
