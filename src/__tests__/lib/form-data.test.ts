import { describe, expect, it } from "vitest";
import {
  boolOrNull,
  dateOrNull,
  dateTimeOrNull,
  intOrNull,
  str,
  toUtcInputValue,
} from "@/lib/form-data";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("form-data helpers", () => {
  it("str trims and defaults to empty", () => {
    expect(str(fd({ a: "  x " }), "a")).toBe("x");
    expect(str(fd({}), "missing")).toBe("");
  });

  it("intOrNull parses integers and rejects junk", () => {
    expect(intOrNull(fd({ n: "42" }), "n")).toBe(42);
    expect(intOrNull(fd({ n: "" }), "n")).toBeNull();
    expect(intOrNull(fd({ n: "abc" }), "n")).toBeNull();
  });

  it("dateOrNull returns the raw value or null", () => {
    expect(dateOrNull(fd({ d: "2026-07-01" }), "d")).toBe("2026-07-01");
    expect(dateOrNull(fd({ d: "" }), "d")).toBeNull();
  });

  it("dateTimeOrNull treats zone-less input as UTC (spec/14 §E2)", () => {
    const d = dateTimeOrNull(fd({ t: "2026-07-12T14:00" }), "t")!;
    expect(d.toISOString()).toBe("2026-07-12T14:00:00.000Z");
  });

  it("dateTimeOrNull respects explicit zones", () => {
    const d = dateTimeOrNull(fd({ t: "2026-07-12T14:00+02:00" }), "t")!;
    expect(d.toISOString()).toBe("2026-07-12T12:00:00.000Z");
  });

  it("round-trips through toUtcInputValue", () => {
    const input = "2026-07-12T14:00";
    const d = dateTimeOrNull(fd({ t: input }), "t")!;
    expect(toUtcInputValue(d)).toBe(input);
    expect(toUtcInputValue(null)).toBe("");
  });

  it("boolOrNull maps the tri-state select values", () => {
    expect(boolOrNull(fd({ b: "on" }), "b")).toBe(true);
    expect(boolOrNull(fd({ b: "off" }), "b")).toBe(false);
    expect(boolOrNull(fd({ b: "" }), "b")).toBeNull();
    expect(boolOrNull(fd({}), "b")).toBeNull();
  });
});
