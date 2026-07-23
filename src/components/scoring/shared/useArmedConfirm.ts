"use client";

// Two-tap confirm shared by all four discipline action bars: the first tap
// arms a button, the second (within ARM_MS) commits; otherwise it auto-disarms.
import { useEffect, useState } from "react";

export type Armed = "A" | "B" | "UNDO" | "REPLAY" | null;
export const ARM_MS = 3000;

export function useArmedConfirm() {
  const [armed, setArmed] = useState<Armed>(null);

  // Auto-disarm a two-tap button after a few seconds.
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  /** First tap arms `key`; a second tap while armed runs `action`. */
  const tapConfirm = (key: Exclude<Armed, null>, action: () => void) => {
    if (armed === key) {
      action();
      setArmed(null);
    } else {
      setArmed(key);
    }
  };

  return { armed, setArmed, tapConfirm };
}
