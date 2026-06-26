import { describe, expect, it } from "vitest";
import { hasRole } from "@/lib/authz";

describe("hasRole (spec/14 §A1)", () => {
  it("TENANT_ADMIN is a superuser for any requirement", () => {
    expect(hasRole(["TENANT_ADMIN"], ["SCORER"])).toBe(true);
    expect(hasRole(["TENANT_ADMIN"], ["COMPETITION_ADMIN"])).toBe(true);
  });

  it("matches when the user holds one of the allowed roles", () => {
    expect(hasRole(["SCORER"], ["SCORER", "COMPETITION_ADMIN"])).toBe(true);
    expect(hasRole(["COMPETITION_ADMIN"], ["COMPETITION_ADMIN"])).toBe(true);
  });

  it("denies when the user has no overlapping role", () => {
    expect(hasRole(["SCORER"], ["COMPETITION_ADMIN"])).toBe(false);
    expect(hasRole([], ["SCORER"])).toBe(false);
  });
});
