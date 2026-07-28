"use client";

/**
 * Signature status for a finished match (spec/20). Kept out of the match
 * provider on purpose: signatures are not engine state (no replay, no
 * snapshot), so the console asks the server for them once the match is over —
 * and again after each signature — rather than deriving them from the log.
 */

import { useCallback, useEffect, useState } from "react";

export interface SignOffStatus {
  policy: "REQUIRED" | "OPTIONAL" | "OFF";
  complete: boolean;
  missing: string[];
  /** Every live signature role on record (trio + pre-match + bench). */
  signedRoles: string[];
}

export function useSignOffStatus(matchId: string, enabled: boolean) {
  const [status, setStatus] = useState<SignOffStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/signatures`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as SignOffStatus & {
        signatures?: { role: string }[];
      };
      setStatus({
        policy: json.policy,
        complete: json.complete,
        missing: json.missing ?? [],
        signedRoles: (json.signatures ?? []).map((s) => s.role),
      });
    } catch {
      // Offline or transient — the panel surfaces its own errors; the console
      // just keeps the last known status.
    }
  }, [matchId]);

  useEffect(() => {
    if (!enabled) return;
    // Deferred by a tick (same pattern as the interrupt poller): fetching
    // synchronously in the effect body would setState during the render commit.
    const first = setTimeout(refresh, 0);
    return () => clearTimeout(first);
  }, [enabled, refresh]);

  return { status, refresh };
}
