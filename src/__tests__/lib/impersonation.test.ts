import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  IMPERSONATION_TTL_S,
  makeImpersonationCookie,
  readImpersonationCookie,
} from "@/lib/impersonation";

// Pure crypto surface of spec/26 — no Next context, no DB. The overlay's other
// half (session + live global-admin checks) lives in authz and is tested there.

beforeAll(() => {
  process.env.PIN_HMAC_SECRET ??= "test-secret-for-impersonation";
});

const ACTOR = "usr_admin";
const TARGET = "usr_target";
const NOW = new Date("2026-08-12T12:00:00.000Z");

function tamperPayload(value: string, payload: object): string {
  const [v, , sig] = value.split(".");
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${v}.${b64}.${sig}`;
}

describe("impersonation cookie", () => {
  it("round-trips actor, target and expiry", () => {
    const { value, expiresAt } = makeImpersonationCookie(ACTOR, TARGET, NOW);
    const claim = readImpersonationCookie(value, NOW);
    expect(claim).toEqual({
      actorUserId: ACTOR,
      targetUserId: TARGET,
      issuedAt: Math.floor(NOW.getTime() / 1000),
      expiresAt,
    });
    expect(expiresAt - Math.floor(NOW.getTime() / 1000)).toBe(IMPERSONATION_TTL_S);
  });

  it("rejects a tampered payload (swapped target)", () => {
    const { value } = makeImpersonationCookie(ACTOR, TARGET, NOW);
    const iat = Math.floor(NOW.getTime() / 1000);
    const forged = tamperPayload(value, {
      a: ACTOR,
      t: "usr_someone_else",
      iat,
      exp: iat + IMPERSONATION_TTL_S,
    });
    expect(readImpersonationCookie(forged, NOW)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const { value } = makeImpersonationCookie(ACTOR, TARGET, NOW);
    const [v, b64, sig] = value.split(".");
    const flipped = sig[0] === "a" ? `b${sig.slice(1)}` : `a${sig.slice(1)}`;
    expect(readImpersonationCookie(`${v}.${b64}.${flipped}`, NOW)).toBeNull();
  });

  it("rejects an unsigned / malformed value", () => {
    expect(readImpersonationCookie(undefined)).toBeNull();
    expect(readImpersonationCookie("")).toBeNull();
    expect(readImpersonationCookie("garbage")).toBeNull();
    expect(readImpersonationCookie("v1.only-two-parts")).toBeNull();
    const { value } = makeImpersonationCookie(ACTOR, TARGET, NOW);
    // A payload with no signature at all must not be accepted.
    expect(readImpersonationCookie(`${value.split(".")[1]}`, NOW)).toBeNull();
  });

  it("rejects an unknown version prefix", () => {
    const { value } = makeImpersonationCookie(ACTOR, TARGET, NOW);
    const [, b64, sig] = value.split(".");
    expect(readImpersonationCookie(`v2.${b64}.${sig}`, NOW)).toBeNull();
  });

  it("expires exactly at exp, and stays valid a second before", () => {
    const { value, expiresAt } = makeImpersonationCookie(ACTOR, TARGET, NOW);
    const justBefore = new Date((expiresAt - 1) * 1000);
    const atExpiry = new Date(expiresAt * 1000);
    expect(readImpersonationCookie(value, justBefore)).not.toBeNull();
    expect(readImpersonationCookie(value, atExpiry)).toBeNull();
  });

  it("rejects a self-signed cookie claiming a lifetime beyond the cap", () => {
    // Signed with the real key (as a future bug or a rogue caller might), but
    // with a week-long window — the cap is enforced on read too.
    const iat = Math.floor(NOW.getTime() / 1000);
    const { value } = makeImpersonationCookie(ACTOR, TARGET, NOW);
    const [v] = value.split(".");
    const payload = { a: ACTOR, t: TARGET, iat, exp: iat + 7 * 24 * 3600 };
    const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    // Re-sign properly so only the lifetime rule can reject it.
    const sig = crypto
      .createHmac("sha256", process.env.PIN_HMAC_SECRET as string)
      .update("vbimp:v1:" + b64)
      .digest("hex");
    expect(readImpersonationCookie(`${v}.${b64}.${sig}`, NOW)).toBeNull();
  });

  it("rejects self-impersonation", () => {
    const { value } = makeImpersonationCookie(ACTOR, ACTOR, NOW);
    expect(readImpersonationCookie(value, NOW)).toBeNull();
  });
});
