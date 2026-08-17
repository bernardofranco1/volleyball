/**
 * Bench officials on the roster (spec/29 F1).
 *
 * Rosters carry staff as well as players now. Two properties matter and both
 * are easy to regress:
 *
 * 1. A bench official must NEVER be offered for the court. Before staff rows
 *    existed no picker filtered by role, so the first coach added to a roster
 *    would have appeared in lineup entry, the substitution panel and the libero
 *    picker (spec/29 §Revalidation §1).
 * 2. Staff must still be reachable where they belong — sanctions, the TEAMS
 *    block, the pre-match coach signature — in the scoresheet's own order.
 */
import { describe, expect, it } from "vitest";
import {
  STAFF_FUNCTIONS,
  courtEligible,
  courtRoster,
  isStaff,
  isStaffFunction,
  staffFunctionLabel,
  staffRoster,
} from "@/lib/roster";

const row = (
  id: string,
  role?: "PLAYER" | "BENCH" | "STAFF",
  staffFunction?: (typeof STAFF_FUNCTIONS)[number] | null,
) => ({ id, role, staffFunction: staffFunction ?? null });

describe("courtEligible", () => {
  it("keeps players and bench players", () => {
    expect(courtEligible(row("p1", "PLAYER"))).toBe(true);
    expect(courtEligible(row("p2", "BENCH"))).toBe(true);
  });

  it("excludes bench officials", () => {
    expect(courtEligible(row("s1", "STAFF", "C1"))).toBe(false);
  });

  it("treats a row with no role as a player", () => {
    // PlayerLite.role is optional so surfaces built before staff existed keep
    // compiling; those rosters were all players.
    expect(courtEligible(row("p3"))).toBe(true);
  });
});

describe("courtRoster", () => {
  it("removes staff and preserves the order of the rest", () => {
    const roster = [
      row("p1", "PLAYER"),
      row("s1", "STAFF", "C1"),
      row("p2", "PLAYER"),
      row("s2", "STAFF", "D1"),
      row("p3", "BENCH"),
    ];
    expect(courtRoster(roster).map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("leaves an all-player roster untouched — the common case", () => {
    const roster = [row("p1", "PLAYER"), row("p2", "PLAYER")];
    expect(courtRoster(roster)).toEqual(roster);
  });
});

describe("staffRoster", () => {
  it("returns only staff, in scoresheet function order", () => {
    // Deliberately shuffled: the sheet's TEAM OFFICIALS block reads C1, A1…,
    // D1, T, P regardless of the order rows were added to the roster.
    const roster = [
      row("s3", "STAFF", "D1"),
      row("p1", "PLAYER"),
      row("s1", "STAFF", "A2"),
      row("s2", "STAFF", "C1"),
      row("s4", "STAFF", "P"),
    ];
    expect(staffRoster(roster).map((r) => r.staffFunction)).toEqual([
      "C1",
      "A2",
      "D1",
      "P",
    ]);
  });

  it("still lists a bench official with no declared function, last", () => {
    // A sloppy roster is a real roster; hiding the row would silently drop a
    // sanctionable person from the sheet.
    const roster = [row("s1", "STAFF", null), row("s2", "STAFF", "C1")];
    expect(staffRoster(roster).map((r) => r.id)).toEqual(["s2", "s1"]);
  });

  it("is empty for a roster of players", () => {
    expect(staffRoster([row("p1", "PLAYER"), row("p2")])).toEqual([]);
  });
});

describe("isStaff / isStaffFunction", () => {
  it("identifies staff rows", () => {
    expect(isStaff(row("s1", "STAFF"))).toBe(true);
    expect(isStaff(row("p1", "PLAYER"))).toBe(false);
  });

  it("validates function codes coming off a form", () => {
    expect(isStaffFunction("C1")).toBe(true);
    expect(isStaffFunction("A3")).toBe(true);
    // "" is what the select submits for "Player" — must not become a staff row.
    expect(isStaffFunction("")).toBe(false);
    expect(isStaffFunction("HEAD_COACH")).toBe(false);
    expect(isStaffFunction(null)).toBe(false);
  });

  it("labels every code, so no picker can render a blank option", () => {
    for (const fn of STAFF_FUNCTIONS) {
      expect(staffFunctionLabel(fn)).toContain(fn);
      expect(staffFunctionLabel(fn).length).toBeGreaterThan(fn.length + 2);
    }
    expect(staffFunctionLabel(null)).toBe("Bench official");
  });
});
