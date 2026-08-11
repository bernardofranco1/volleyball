// People registry pure logic (spec/24 §6).
//
// The name handling is the part that has already gone wrong in production once,
// in the VIS-derived Stats-hub: a shirt/scoreboard label was used as a surname
// fallback and names rendered as "Thatdao N.Thatdao". These tests pin the rule
// that display/shirt name is a SEPARATE field and never becomes a surname.
import { describe, expect, it } from "vitest";
import {
  isPersonRole,
  personName,
  PERSON_POSITIONS,
  PERSON_ROLES,
  POSITION_LABEL,
  STAFF_FUNCTIONS,
  STAFF_FUNCTION_LABEL,
} from "@/lib/people";

describe("personName", () => {
  it('renders "Last, First" when both are known', () => {
    expect(
      personName({ firstName: "Anders", lastName: "Mol", jerseyName: "Mol, A." }),
    ).toBe("Mol, Anders");
  });

  it("uses the surname alone when there is no first name", () => {
    expect(
      personName({ firstName: null, lastName: "Egonu", jerseyName: "EGONU" }),
    ).toBe("Egonu");
  });

  it("uses the first name alone when there is no surname", () => {
    expect(
      personName({ firstName: "Thatdao", lastName: null, jerseyName: "N.THATDAO" }),
    ).toBe("Thatdao");
  });

  it("falls back to the shirt label only when there is no name at all", () => {
    // Real VIS players exist with only this. It is a last resort, not a surname.
    expect(
      personName({ firstName: null, lastName: null, jerseyName: "N.THATDAO" }),
    ).toBe("N.THATDAO");
  });

  it("never concatenates the shirt label onto a real name", () => {
    // The exact production bug: "Thatdao N.Thatdao".
    const out = personName({
      firstName: "Thatdao",
      lastName: null,
      jerseyName: "N.THATDAO",
    });
    expect(out).not.toContain("N.THATDAO");
  });

  it("keeps a surname that legitimately equals the shirt label", () => {
    // A guard that rejected this produced false positives and had to be removed
    // upstream; equality is valid data, not a duplicate.
    expect(
      personName({
        firstName: "Marketa",
        lastName: "Brancuska",
        jerseyName: "BRANCUSKA",
      }),
    ).toBe("Brancuska, Marketa");
  });
});

describe("role and enum guards", () => {
  it("accepts the four registry roles and nothing else", () => {
    for (const r of PERSON_ROLES) expect(isPersonRole(r)).toBe(true);
    for (const bad of ["player", "ADMIN", "", "REF"])
      expect(isPersonRole(bad)).toBe(false);
  });

  it("labels every position, and keeps the VIS name discoverable", () => {
    for (const p of PERSON_POSITIONS) {
      expect(POSITION_LABEL[p]).toBeTruthy();
    }
    // VIS calls it WingSpiker; the sport says outside hitter. Show both so a
    // mapping to VIS stays obvious.
    expect(POSITION_LABEL.WING_SPIKER.toLowerCase()).toContain("wing spiker");
    expect(POSITION_LABEL.WING_SPIKER.toLowerCase()).toContain("outside");
  });

  it("labels every staff function", () => {
    for (const f of STAFF_FUNCTIONS) expect(STAFF_FUNCTION_LABEL[f]).toBeTruthy();
  });

  it("staff functions mirror the VIS VolleyTeam staff slots", () => {
    // VIS has HeadCoach, AssistCoach, AssistCoach2, Doctor, Trainer, Manager —
    // keeping the same six means a future push is a 1:1 mapping (spec/24 §7.3).
    expect([...STAFF_FUNCTIONS]).toEqual([
      "HEAD_COACH",
      "ASSISTANT_COACH",
      "ASSISTANT_COACH_2",
      "DOCTOR",
      "TRAINER",
      "MANAGER",
    ]);
  });

  it("exactly one head-coach slot exists — the scoresheet prints one name", () => {
    expect(STAFF_FUNCTIONS.filter((f) => f === "HEAD_COACH")).toHaveLength(1);
  });
});
