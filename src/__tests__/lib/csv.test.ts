import { describe, expect, it } from "vitest";
import { csvBool, parseCsv, parseCsvRecords } from "@/lib/csv";

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes, and CRLF", () => {
    const text = 'a,b\r\n"x,1","say ""hi"""\r\nplain,2\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["x,1", 'say "hi"'],
      ["plain", "2"],
    ]);
  });

  it("supports newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",y\n')).toEqual([
      ["a", "b"],
      ["line1\nline2", "y"],
    ]);
  });

  it("strips a BOM and drops fully blank rows", () => {
    expect(parseCsv("﻿h1,h2\n\n , \nv1,v2")).toEqual([
      ["h1", "h2"],
      ["v1", "v2"],
    ]);
  });

  it("flushes a final row without a trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsvRecords", () => {
  it("keys rows by trimmed header; missing columns become empty", () => {
    const { header, records } = parseCsvRecords(
      " name , seed \nBrazil,1\nPoland\n",
    );
    expect(header).toEqual(["name", "seed"]);
    expect(records).toEqual([
      { name: "Brazil", seed: "1" },
      { name: "Poland", seed: "" },
    ]);
  });

  it("returns empty for empty input", () => {
    expect(parseCsvRecords("")).toEqual({ header: [], records: [] });
  });
});

describe("csvBool", () => {
  it("is lenient and case-insensitive", () => {
    for (const v of ["true", "1", "yes", "Y", " X "]) expect(csvBool(v)).toBe(true);
    for (const v of ["false", "0", "no", "", undefined]) expect(csvBool(v)).toBe(false);
  });
});
