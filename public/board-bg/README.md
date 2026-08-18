# Board background artwork (spec/34)

Drop a file named after the competition id and every VIS board of that
competition picks it up on the next load — no code change, no deploy config:

    public/board-bg/comp_vis_1766.jpg    → AVC Women's Asian Championship
    public/board-bg/comp_vis_1765.jpg    → AVC Men's Asian Championship
    public/board-bg/comp_vis_1670.jpg    → Boys' U17 World Championship

Requirements
- **1920×1080** (16:9). The board is a 16:9 stage, so anything else is cropped
  by `background-size: cover`.
- JPEG at `.jpg`. The board references exactly that extension.
- Keep the middle and both flanks calm: the score plates sit centre-top, and the
  two line-ups run down the left and right thirds. Busy artwork under white
  text is the one way to make this board unreadable from the stands.

Until a file exists the board paints its built-in gradient, which is a
deliberate stand-in for the VNL artwork — a missing file is not an error, the
CSS simply falls through to the next background layer.

One-off override for a single screen (a rehearsal, a sponsor night):

    /t/<tenant>/scoreboard/vis/<competitionId>/<matchNo>?bg=/board-bg/other.jpg
    /t/<tenant>/scoreboard/vis/<competitionId>/<matchNo>?bg=https://…/art.jpg

Only same-origin paths and `https:` URLs are accepted.
