// Person identity keys (spec/25 §2) — the fields that make "one human, one row"
// enforceable rather than aspirational.
//
// The rules under test exist because of specific failure modes:
//   - a plain UNIQUE on email would make it mandatory, and minors, shared family
//     addresses and unreachable veterans are all normal in a federation registry;
//   - a placeholder at a real domain would send genuine mail to a stranger, and
//     this app has a working sender;
//   - one shared placeholder value would collide on the second row.
import { describe, expect, it } from "vitest";
import {
  isPlaceholderEmail,
  looksLikeEmail,
  normalizeEmail,
  placeholderEmail,
} from "@/lib/people-domain";

describe("normalizeEmail", () => {
  it("trims and lower-cases so matching is case-insensitive", () => {
    expect(normalizeEmail("  Bernardo.Franco@FIVB.com ")).toBe(
      "bernardo.franco@fivb.com",
    );
  });

  it("treats blank and whitespace-only as absent, not as an empty string", () => {
    // An empty string would occupy the unique index and block the next person
    // who also has no email.
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("looksLikeEmail", () => {
  it("accepts ordinary and awkward-but-valid addresses", () => {
    for (const ok of [
      "a@b.co",
      "bernardo.franco@fivb.com",
      "first+tag@sub.example.org",
      "o'brien@team.ie",
    ])
      expect(looksLikeEmail(ok)).toBe(true);
  });

  it("rejects what is obviously not an address", () => {
    for (const bad of ["", "nope", "no@domain", "two@@at.com", "spa ce@x.com"])
      expect(looksLikeEmail(bad)).toBe(false);
  });
});

describe("placeholder addresses", () => {
  it("are per-person, so they cannot collide under a unique index", () => {
    const a = placeholderEmail("per_aaa");
    const b = placeholderEmail("per_bbb");
    expect(a).not.toBe(b);
  });

  it("use the reserved .invalid TLD so they can never receive real mail", () => {
    // The point: a plausible domain like gg.com is registered by someone, and a
    // stray invite would reach them.
    expect(placeholderEmail("per_x")).toMatch(/@example\.invalid$/);
  });

  it("are recognisable, so the UI can warn that they are not reachable", () => {
    expect(isPlaceholderEmail(placeholderEmail("per_x"))).toBe(true);
    expect(isPlaceholderEmail("real@fivb.com")).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });

  it("pass the format check, so seeded data survives validation", () => {
    expect(looksLikeEmail(placeholderEmail("per_x"))).toBe(true);
  });

  it("normalise to themselves — no surprise case changes on round-trip", () => {
    const p = placeholderEmail("per_ABC");
    expect(normalizeEmail(p)).toBe(p.toLowerCase());
  });
});
