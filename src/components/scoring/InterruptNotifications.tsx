"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { channelConfig, ensureRealtimeAuth } from "@/lib/realtime-client";

interface Pending {
  requestId: string;
  team: "A" | "B";
  requestType: string;
  outPlayerId?: string;
  inPlayerId?: string;
}

export interface RosterEntry {
  jerseyNumber: number | null;
  fullName: string;
}

// Surfaces team-tablet interrupt requests to the scorer with approve/deny.
// Two delivery paths (brief §2.2):
//  1. Realtime broadcast on `match:{id}:scorer` — instant, but fire-and-forget
//     (a missed/dropped socket loses the message).
//  2. A 15s poll of the scorer GET endpoint (authoritative PENDING set from
//     the DB) — a safety net for missed broadcasts, so it doesn't need to be
//     fast. Pass `active={false}` (match finished / tablets disabled) to stop
//     polling entirely.
// Approving a TIMEOUT is applied server-side; the rest clear for the scorer.
export function InterruptNotifications({
  matchId,
  teamAName,
  teamBName,
  active = true,
  rosterById,
}: {
  matchId: string;
  teamAName: string;
  teamBName: string;
  active?: boolean;
  /** Resolves a substitution request's player ids to readable labels. */
  rosterById?: ReadonlyMap<string, RosterEntry>;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  // Requests this scorer just resolved — kept briefly so the poll doesn't
  // re-add them in the window before the PATCH commits. Cleared on a timer so a
  // failed PATCH lets the request resurface.
  const resolvedRef = useRef<Set<string>>(new Set());

  // Authoritative source of truth: poll the scorer GET endpoint (DB-backed).
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/interrupt-requests`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        requests?: {
          id: string;
          team: "A" | "B";
          requestType: string;
          payload?: { outPlayerId?: string; inPlayerId?: string } | null;
        }[];
      };
      if (!Array.isArray(data.requests)) return;
      const fresh = data.requests
        .filter((r) => !resolvedRef.current.has(r.id))
        .map((r) => ({
          requestId: r.id,
          team: r.team,
          requestType: r.requestType,
          outPlayerId: r.payload?.outPlayerId,
          inPlayerId: r.payload?.inPlayerId,
        }));
      setPending(fresh);
    } catch {
      // Keep whatever realtime delivered; next tick retries.
    }
  }, [matchId]);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(poll, 0);
    const iv = setInterval(poll, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [poll, active]);

  // Fast path: a realtime broadcast is only a *signal* — never trust its payload
  // (any anon-key holder can forge one). On any broadcast, re-fetch the
  // authoritative PENDING set from the server so forged events can't inject fake
  // prompts onto the scorer's screen.
  useEffect(() => {
    if (!active) return;
    const supabase = createSupabaseBrowserClient();
    ensureRealtimeAuth(supabase);
    const channel = supabase
      .channel(`match:${matchId}:scorer`, channelConfig())
      .on("broadcast", { event: "interrupt-request" }, () => {
        void poll();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId, active, poll]);

  const resolve = async (requestId: string, status: "APPROVED" | "DENIED") => {
    resolvedRef.current.add(requestId);
    setTimeout(() => resolvedRef.current.delete(requestId), 12000);
    setPending((prev) => prev.filter((x) => x.requestId !== requestId));
    await fetch(`/api/matches/${matchId}/interrupt-requests`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, status }),
    }).catch(() => {});
  };

  if (pending.length === 0) return null;
  const name = (t: "A" | "B") => (t === "A" ? teamAName : teamBName);
  const player = (id?: string) => {
    if (!id) return "?";
    const p = rosterById?.get(id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.fullName}` : id;
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
      {pending.map((p) => (
        <div
          key={p.requestId}
          className="rounded-xl border border-amber-500/50 bg-surface-raised p-3 shadow-lg"
        >
          <div className="text-sm font-medium">
            {name(p.team)} requests <span className="text-amber-400">{p.requestType}</span>
          </div>
          {p.requestType === "SUBSTITUTION" && (p.outPlayerId || p.inPlayerId) ? (
            <div className="mt-0.5 text-xs text-score-dim">
              {player(p.outPlayerId)} → {player(p.inPlayerId)}
            </div>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => resolve(p.requestId, "APPROVED")}
              className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => resolve(p.requestId, "DENIED")}
              className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm text-score-dim hover:text-foreground"
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
