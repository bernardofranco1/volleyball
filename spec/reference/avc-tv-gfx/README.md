# AVC Continental 2026 TV GFX — reference and measurement tools

Everything spec/47's geometry is measured from, plus the tools that measured it
and the two gates that keep it honest.

Source package: `07 OSDP/` — the official AVC broadcast graphics delivery
(guidelines PDF, After Effects projects, licensed fonts, flag assets). It is a
licensed delivery and is **not** in the repo; the extracts here exist so the
feature can be maintained without it. When the two disagree, the package wins.

## What is here

| | |
|---|---|
| `frames/` | The eight reference stills, extracted from the guidelines PDF at **native 1920×1080** — design px == image px. The guidelines embed them full-size, which is what makes them measurable. |
| `artwork/` | `04_Scoreboard.ai` as vector (`pdftocairo -svg`) and as a 96 dpi render, plus the lower-third bar shapes. The artboard is exactly 1920×1080, so path coordinates are screen coordinates. |
| `guideline-pages/` | 150 dpi renders of the pages that carry specifications (colours, codes, flags, and each graphic's spec table). |
| `validate/` | Output of the two gates: `browser.png` and the diff stack. |

## Tools

```
layers.py            list | show | bbox        isolate an Illustrator master's layers
extract-assets.py                              cut the bar's artwork into public/tv-gfx/
measure-extensions.py                          read the extension graphics off frames/
validate-bug.py                                artwork integrity vs the artboard
check-render.py                                what the browser drew vs the constants
```

The layer trick is the whole basis of the measurements: the `.ai` files are
PDF-compatible **and Illustrator preserves its layer stack as PDF
optional-content groups**, so each element — "Blue Bar", "THA", "Left Block",
"Logo" — renders on its own and gets an exact ink box.

```bash
AI="07 OSDP/TV GFX/AVC_Lower_Third_GFX_v01/(Footage)/04_Artwork/Ai Files/04_Scoreboard.ai"
python3 spec/reference/avc-tv-gfx/layers.py bbox "$AI" --each --dpi 288
```

Two traps, both of which produced confidently wrong numbers first time:

- **Threshold the alpha.** Antialiasing feathers a glyph a pixel past its
  outline; taking any non-zero alpha as ink reads 48 px type as 50 px. Render at
  4× and threshold at 50 % coverage.
- **The slant is tan 18° (0.3249), not 1/3.**

## The two gates

They answer different questions and both are needed.

```bash
# do the constants and the artwork still reproduce the master?
python3 spec/reference/avc-tv-gfx/validate-bug.py

# does the BROWSER reproduce the constants?  (needs the dev server up)
node scripts/check-tv-bug.mjs
python3 spec/reference/avc-tv-gfx/check-render.py
```

`validate-bug.py` works in the **artboard's** coordinates (a 61.25 px bar), which
are deliberately not what the component ships (60 px — spec/47 explains why), so
it is an asset-integrity check rather than a check on the component. It diffs
against the artboard rather than the guidelines frame because the frame's
pinstripe field sits 3 px off the artboard's — an After Effects/Illustrator phase
difference in a 22.5 px repeating texture, invisible to a viewer and enough to
put a naive diff at a mean of 50.

`check-render.py` is the component gate, and it caught the
`preserveAspectRatio` bug that neither the eye nor the Python validator could
see. It expects `/tv/mock` — a fixed capture, so the strings are known, which
matters because turning a measured ink box back into a baseline needs to know how
far that particular string's ink falls below it.

## Regenerating the assets

```bash
python3 spec/reference/avc-tv-gfx/extract-assets.py   # needs the package mounted
node scripts/gen-board-metrics.mjs                    # font metrics + flag lists
```
