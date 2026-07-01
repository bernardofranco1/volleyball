import { describe, expect, it } from "vitest";
import {
  COMPETITION_STATUSES,
  DISCIPLINES,
  NEXT_STATUS,
  canTransition,
  isCompetitionStatus,
  isDiscipline,
  isGender,
} from "@/lib/domain";

describe("domain constants", () => {
  it("guards recognise their members and reject junk", () => {
    for (const d of DISCIPLINES) expect(isDiscipline(d)).toBe(true);
    expect(isDiscipline("FOOTBALL")).toBe(false);
    for (const s of COMPETITION_STATUSES) expect(isCompetitionStatus(s)).toBe(true);
    expect(isCompetitionStatus("ARCHIVED")).toBe(false);
    expect(isGender("MEN")).toBe(true);
    expect(isGender("X")).toBe(false);
  });

  it("every status has an entry in NEXT_STATUS", () => {
    for (const s of COMPETITION_STATUSES) expect(NEXT_STATUS[s]).toBeDefined();
  });

  it("canTransition matches the offered buttons and rejects jumps", () => {
    expect(canTransition("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("ACTIVE", "FINISHED")).toBe(true);
    expect(canTransition("ACTIVE", "DRAFT")).toBe(true);
    expect(canTransition("FINISHED", "ACTIVE")).toBe(true);
    // A crafted POST must not jump DRAFT → FINISHED.
    expect(canTransition("DRAFT", "FINISHED")).toBe(false);
    expect(canTransition("FINISHED", "DRAFT")).toBe(false);
  });
});
