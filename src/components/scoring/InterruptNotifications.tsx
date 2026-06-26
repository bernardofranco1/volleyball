"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

interface Pending {
  requestId: string;
  team: "A" | "B";
  requestType: string;
}

// Subscribed to `match:{id}:scorer`, this surfaces team-tablet interrupt requests
// to the scorer with approve/deny. Approving a TIMEOUT is applied server-side; the
// rest clear the request for the scorer to action via the bar.
export function InterruptNotifications({
  matchId,
  teamAName,
  teamBName,
}: {
  matchId: string;
  teamAName: string;
  teamBName: string;
}) {
  const [pending, setPending] = useState<Pending[]>([]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`match:${matchId}:scorer`)
      .on(
        "broadcast",
        { event: "interrupt-request" },
        (m: {
          payload?: { requestId?: string; team?: "A" | "B"; requestType?: string };
        }) => {
          const p = m.payload;
          if (!p?.requestId || !p.team || !p.requestType) return;
          const item: Pending = {
            requestId: p.requestId,
            team: p.team,
            requestType: p.requestType,
          };
          setPending((prev) =>
            prev.some((x) => x.requestId === item.requestId)
              ? prev
              : [...prev, item],
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId]);

  const resolve = async (requestId: string, status: "APPROVED" | "DENIED") => {
    setPending((prev) => prev.filter((x) => x.requestId !== requestId));
    await fetch(`/api/matches/${matchId}/interrupt-requests`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, status }),
    }).catch(() => {});
  };

  if (pending.length === 0) return null;
  const name = (t: "A" | "B") => (t === "A" ? teamAName : teamBName);

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
