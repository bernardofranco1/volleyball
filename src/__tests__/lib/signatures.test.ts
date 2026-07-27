import { describe, expect, it } from "vitest";
import {
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
import { DISCIPLINE_DEFAULTS, resolveConfig } from "@/engine/config";
import { DISCIPLINES } from "@/engine/types";

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

describe("signature obligation per discipline", () => {
  it("beach and indoor require a signed scoresheet; grass and air do not", () => {
    expect(DISCIPLINE_DEFAULTS.BEACH.resultSignatures).toBe("REQUIRED");
    expect(DISCIPLINE_DEFAULTS.INDOOR.resultSignatures).toBe("REQUIRED");
    expect(DISCIPLINE_DEFAULTS.GRASS.resultSignatures).toBe("OFF");
    expect(DISCIPLINE_DEFAULTS.LIGHT.resultSignatures).toBe("OFF");
  });

  it("is overridable per competition", () => {
    expect(
      resolveConfig("BEACH", { resultSignatures: "OPTIONAL" }).resultSignatures,
    ).toBe("OPTIONAL");
    expect(resolveConfig("BEACH", { resultSignatures: null as never }).resultSignatures).toBe(
      "REQUIRED",
    );
    // Every discipline resolves to one of the three policies.
    for (const d of DISCIPLINES)
      expect(["REQUIRED", "OPTIONAL", "OFF"]).toContain(
        resolveConfig(d).resultSignatures,
      );
  });
});
