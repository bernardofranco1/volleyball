import { describe, expect, it } from "vitest";
import { safeRedirect } from "@/lib/http";

describe("safeRedirect (open-redirect guard, spec/14 §A3)", () => {
  it("allows same-origin relative paths", () => {
    expect(safeRedirect("/t/x/dashboard")).toBe("/t/x/dashboard");
    expect(safeRedirect("/")).toBe("/");
  });

  it("rejects absolute, protocol-relative, and backslash tricks", () => {
    expect(safeRedirect("https://evil.com")).toBe("");
    expect(safeRedirect("//evil.com")).toBe("");
    expect(safeRedirect("/\\evil.com")).toBe("");
    expect(safeRedirect("javascript:alert(1)")).toBe("");
    expect(safeRedirect("")).toBe("");
    expect(safeRedirect("relative/path")).toBe("");
  });
});
