import { describe, expect, it } from "vitest";
import {
  fitStrokes,
  parseStrokes,
  resultDigest,
  resultFingerprint,
  signatureProgress,
  signatureRoleLabel,
  STROKE_LIMITS,
  SIGNATURE_ROLES,
  type SignableState,
  type SignatureRecord,
} from "@/lib/match-signatures";

const STATE: SignableState = {
  matchId: "m1",
  status: "FINISHED",
  winner: "A",
  setsWonA: 2,
  setsWonB: 1,
  lastSequence: 148,
  sets: [
    { scoreA: 21, scoreB: 15, winner: "A" },
    { scoreA: 19, scoreB: 21, winner: "B" },
    { scoreA: 15, scoreB: 11, winner: "A" },
  ],
};

function sig(
  role: (typeof SIGNATURE_ROLES)[number],
  digest: string,
): SignatureRecord {
  return {
    id: `sig-${role}`,
    role,
    signerName: "Someone",
    signerPlayerId: null,
    strokes: { pad: { w: 1, h: 0.32 }, strokes: [[[0, 0], [1, 0.3]]] },
    intent: "ACCEPT",
    remarks: null,
    signedAt: new Date("2026-07-27T12:00:00.000Z"),
    signedSequence: 148,
    resultDigest: digest,
    capturedBy: "user-1",
  };
}

describe("result digest", () => {
  it("is stable for the same result", () => {
    expect(resultDigest(STATE)).toBe(resultDigest({ ...STATE }));
  });

  it("changes when any part of the result changes", () => {
    const base = resultDigest(STATE);
    // One more event appended (an undo, a note) — the log moved on.
    expect(resultDigest({ ...STATE, lastSequence: 149 })).not.toBe(base);
    // A set score corrected.
    expect(
      resultDigest({
        ...STATE,
        sets: [{ scoreA: 21, scoreB: 16, winner: "A" }, ...STATE.sets.slice(1)],
      }),
    ).not.toBe(base);
    // The winner flipped.
    expect(resultDigest({ ...STATE, winner: "B", setsWonA: 1, setsWonB: 2 })).not.toBe(
      base,
    );
  });

  it("fingerprints the whole result so the hash is auditable", () => {
    const fp = resultFingerprint(STATE);
    expect(fp).toContain("sw:2-1");
    expect(fp).toContain("seq:148");
    expect(fp).toContain("21-15:A|19-21:B|15-11:A");
  });
});

describe("signature progress", () => {
  const digest = resultDigest(STATE);

  it("reports every role missing when nothing is signed", () => {
    const p = signatureProgress([], digest);
    expect(p.missing).toEqual([...SIGNATURE_ROLES]);
    expect(p.complete).toBe(false);
  });

  it("is complete only with all three on the same digest", () => {
    const two = [sig("TEAM_A_CAPTAIN", digest), sig("TEAM_B_CAPTAIN", digest)];
    expect(signatureProgress(two, digest).complete).toBe(false);
    const three = [...two, sig("FIRST_REFEREE", digest)];
    expect(signatureProgress(three, digest).complete).toBe(true);
    expect(signatureProgress(three, digest).missing).toEqual([]);
  });

  it("treats a signature for an older result as stale — and missing", () => {
    const three = [
      sig("TEAM_A_CAPTAIN", digest),
      sig("TEAM_B_CAPTAIN", "an-older-digest"),
      sig("FIRST_REFEREE", digest),
    ];
    const p = signatureProgress(three, digest);
    expect(p.stale).toEqual(["TEAM_B_CAPTAIN"]);
    expect(p.missing).toEqual(["TEAM_B_CAPTAIN"]);
    expect(p.complete).toBe(false);
  });

  it("ignores digests when none is supplied (the manager override check)", () => {
    const three = SIGNATURE_ROLES.map((r) => sig(r, "whatever"));
    expect(signatureProgress(three, null).complete).toBe(true);
  });

  it("labels every role", () => {
    for (const role of SIGNATURE_ROLES)
      expect(signatureRoleLabel(role).length).toBeGreaterThan(3);
  });
});

describe("stroke payload validation", () => {
  const pad = { w: 1, h: 0.32 };

  it("accepts a normal signature and rounds coordinates", () => {
    const res = parseStrokes({
      pad,
      strokes: [[[0.123456, 0.2], [0.5, 0.25]]],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.strokes[0][0]).toEqual([0.1235, 0.2]);
  });

  it("clamps coordinates into the pad box", () => {
    const res = parseStrokes({ pad, strokes: [[[-3, 0.1], [9, 0.2]]] });
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.value.strokes[0].map((p) => p[0])).toEqual([0, 1]);
  });

  it("rejects an empty or absent signature", () => {
    expect(parseStrokes(null).ok).toBe(false);
    expect(parseStrokes({ pad, strokes: [] }).ok).toBe(false);
    expect(parseStrokes({ pad, strokes: [[]] }).ok).toBe(false);
    expect(parseStrokes({ strokes: [[[0, 0]]] }).ok).toBe(false); // no pad
  });

  it("rejects payloads past the size limits", () => {
    const long = Array.from(
      { length: STROKE_LIMITS.maxPointsPerStroke + 1 },
      (_, i) => [i / 10000, 0.1],
    );
    expect(parseStrokes({ pad, strokes: [long] }).ok).toBe(false);
    const many = Array.from({ length: STROKE_LIMITS.maxStrokes + 1 }, () => [
      [0.1, 0.1],
    ]);
    expect(parseStrokes({ pad, strokes: many }).ok).toBe(false);
    // Total-point cap across strokes.
    const chunk = Array.from({ length: 500 }, (_, i) => [i / 1000, 0.1]);
    const overTotal = Array.from({ length: 9 }, () => chunk);
    expect(parseStrokes({ pad, strokes: overTotal }).ok).toBe(false);
  });

  it("drops junk points instead of failing the whole signature", () => {
    const res = parseStrokes({
      pad,
      strokes: [[[0.1, 0.1], ["x", 2], [Number.NaN, 0.2], [0.3, 0.3]]],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.strokes[0]).toHaveLength(2);
  });
});

// ── Placing ink on the page (spec/20) ───────────────────────────────────────
// Strokes are stored in a UNIT SQUARE (x and y both 0..1). `fitStrokes` maps them
// into a page box, letterboxed so the ink is never stretched and clamped so a
// signature can never spill over neighbouring cells of the scoresheet — the bug
// that made the first exports illegible was a y axis normalised 0..1 but drawn as
// though it were 0..pad.h, which multiplied the ink ~3x out of its box.
describe("fitStrokes", () => {
  const pad = { w: 1, h: 0.32 };
  const box = { x: 100, y: 200, w: 150, h: 48 };

  it("keeps every point inside the box", () => {
    const full = fitStrokes(
      { pad, strokes: [[[0, 0], [1, 1], [0.5, 0.5], [1, 0], [0, 1]]] },
      box,
    );
    for (const [x, y] of full[0]) {
      expect(x).toBeGreaterThanOrEqual(box.x);
      expect(x).toBeLessThanOrEqual(box.x + box.w);
      expect(y).toBeGreaterThanOrEqual(box.y);
      expect(y).toBeLessThanOrEqual(box.y + box.h);
    }
  });

  it("letterboxes to the pad's aspect ratio instead of stretching", () => {
    // Pad ratio 0.32; the box is 150x48 (ratio 0.32) → a perfect fit, so the
    // corners land on the box corners.
    const [line] = fitStrokes({ pad, strokes: [[[0, 0], [1, 1]]] }, box);
    expect(line[0][0]).toBeCloseTo(100);
    expect(line[0][1]).toBeCloseTo(200);
    expect(line[1][0]).toBeCloseTo(250);
    expect(line[1][1]).toBeCloseTo(248);
  });

  it("centres the ink when the box is a different shape", () => {
    // A tall box: the width binds, so the drawing is vertically centred.
    const tall = { x: 0, y: 0, w: 100, h: 100 };
    const [line] = fitStrokes({ pad, strokes: [[[0, 0], [1, 1]]] }, tall);
    expect(line[0][0]).toBeCloseTo(0);
    expect(line[1][0]).toBeCloseTo(100);
    // Drawn height is 100 * 0.32 = 32, centred in 100 → 34..66.
    expect(line[0][1]).toBeCloseTo(34);
    expect(line[1][1]).toBeCloseTo(66);
  });

  it("survives a nonsense pad ratio", () => {
    const [line] = fitStrokes(
      { pad: { w: 0, h: 0 }, strokes: [[[0.5, 0.5]]] },
      box,
    );
    expect(Number.isFinite(line[0][0])).toBe(true);
    expect(Number.isFinite(line[0][1])).toBe(true);
  });
});
