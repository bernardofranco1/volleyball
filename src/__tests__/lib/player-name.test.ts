import { describe, expect, it } from "vitest";
import { pairDisplayName, surnameOf } from "@/lib/player-name";

describe("pairDisplayName — the name a beach player is known by", () => {
  it("picks the matching pair-name segment (single known name)", () => {
    expect(pairDisplayName("Duda / Ana Patrícia", "Duda Lisboa")).toBe("Duda");
    expect(pairDisplayName("Duda / Ana Patrícia", "Ana Patrícia Ramos")).toBe(
      "Ana Patrícia",
    );
  });

  it("picks surname segments for surname-named pairs", () => {
    expect(pairDisplayName("Graudina / Kravcenoka", "Tina Graudina")).toBe(
      "Graudina",
    );
    expect(
      pairDisplayName("Graudina / Kravcenoka", "Anastasija Kravcenoka"),
    ).toBe("Kravcenoka");
  });

  it("matches case- and diacritic-insensitively", () => {
    expect(pairDisplayName("DUDA / ANA PATRICIA", "Duda Lisboa")).toBe("DUDA");
    expect(pairDisplayName("Duda / Ana Patricia", "Ana Patrícia Ramos")).toBe(
      "Ana Patricia",
    );
  });

  it("falls back to the surname when nothing matches or not a pair", () => {
    expect(pairDisplayName("Beach Stars", "Anders Mol")).toBe("Mol");
    expect(pairDisplayName("Mol / Sørum", "Somebody Else")).toBe("Else");
  });

  it("surnameOf returns the last token (or the whole single-word name)", () => {
    expect(surnameOf("Anders Mol")).toBe("Mol");
    expect(surnameOf("Duda")).toBe("Duda");
  });
});
