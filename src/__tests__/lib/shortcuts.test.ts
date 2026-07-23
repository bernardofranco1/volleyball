import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYMAP,
  SHORTCUT_ACTION_IDS,
  keymapConflicts,
  mergeKeymap,
  normalizeKey,
} from "@/lib/shortcuts";

describe("shortcuts keymap", () => {
  it("normalizes KeyboardEvent.key values", () => {
    expect(normalizeKey("Enter")).toBe("enter");
    expect(normalizeKey(" ")).toBe("space");
    expect(normalizeKey(",")).toBe(",");
    expect(normalizeKey("Backspace")).toBe("backspace");
    expect(normalizeKey("?")).toBe("?");
  });

  it("defaults are complete and conflict-free", () => {
    for (const id of SHORTCUT_ACTION_IDS)
      expect(typeof DEFAULT_KEYMAP[id]).toBe("string");
    expect(keymapConflicts({ ...DEFAULT_KEYMAP }).size).toBe(0);
  });

  it("merges stored overrides over defaults (new actions keep defaults)", () => {
    const map = mergeKeymap({ pointLeft: "q", undo: "Backspace" });
    expect(map.pointLeft).toBe("q");
    expect(map.undo).toBe("backspace"); // normalized on load
    expect(map.pointRight).toBe(DEFAULT_KEYMAP.pointRight);
    expect(map.advance).toBe(DEFAULT_KEYMAP.advance);
  });

  it("ignores corrupt stored values", () => {
    expect(mergeKeymap(null)).toEqual({ ...DEFAULT_KEYMAP });
    expect(mergeKeymap("junk")).toEqual({ ...DEFAULT_KEYMAP });
    const map = mergeKeymap({
      pointLeft: 42,
      pointRight: "",
      replay: "x".repeat(40),
      bogusAction: "z",
    });
    expect(map).toEqual({ ...DEFAULT_KEYMAP });
  });

  it("flags keys bound to more than one action", () => {
    const map = mergeKeymap({ pointLeft: "x", pointRight: "x" });
    const conflicts = keymapConflicts(map);
    expect(conflicts.has("x")).toBe(true);
    expect(conflicts.has(DEFAULT_KEYMAP.undo)).toBe(false);
  });
});
