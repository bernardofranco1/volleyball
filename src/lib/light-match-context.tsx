"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PlayerLite } from "@/lib/indoor-match-context";
import type { TournamentConfig } from "@/engine/config";
import { appendLightEvent } from "@/engine/light/reducer";
import type { LightEventPayload, LightMatchState } from "@/engine/light/types";

export type { PlayerLite };

interface LightMatchContextValue {
  matchId: string;
  state: LightMatchState;
  config: TournamentConfig;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  teamAName: string;
  teamBName: string;
  dispatch: (payload: LightEventPayload) => void;
  pending: boolean;
  online: boolean;
  serveClockDeadline: number | null;
  error: string | null;
}

const Ctx = createContext<LightMatchContextValue | null>(null);

export function useLightMatch(): LightMatchContextValue {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useLightMatch must be used within <LightMatchProvider>");
  return ctx;
}

export function LightMatchProvider({
  matchId,
  initialState,
  config,
  rosterA,
  rosterB,
  teamAName,
  teamBName,
  children,
}: {
  matchId: string;
  initialState: LightMatchState;
  config: TournamentConfig;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  teamAName: string;
  teamBName: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<LightMatchState>(initialState);
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [serveClockDeadline, setServeClockDeadline] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const queue = useRef<LightEventPayload[]>([]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const resync = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/state`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { state: LightMatchState };
      setState(data.state);
    } catch {
      /* offline — keep optimistic state */
    }
  }, [matchId]);

  const post = useCallback(
    async (payload: LightEventPayload) => {
      setPending(true);
      try {
        const res = await fetch(`/api/matches/${matchId}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(body.error ?? `Request failed (${res.status})`);
          await resync();
          return;
        }
        const data = (await res.json()) as { state: LightMatchState };
        setState(data.state);
        setError(null);
      } catch {
        queue.current.push(payload);
      } finally {
        setPending(false);
      }
    },
    [matchId, resync],
  );

  const dispatch = useCallback(
    (payload: LightEventPayload) => {
      if (payload.type === "UNDO") {
        void post(payload);
        return;
      }
      const result = appendLightEvent(stateRef.current, payload, config, {
        nextSequence: stateRef.current.lastSequence + 1,
        timestamp: new Date().toISOString(),
        makeId: (seq) => `temp-${seq}`,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setState(result.state);
      setError(null);
      if (
        config.serveClockEnabled &&
        (payload.type === "RALLY_WON_A" || payload.type === "RALLY_WON_B") &&
        result.state.status === "LIVE"
      ) {
        setServeClockDeadline(Date.now() + config.serveClockSecs * 1000);
      }
      void post(payload);
    },
    [config, post],
  );

  const flush = useCallback(async () => {
    while (queue.current.length > 0) {
      const next = queue.current.shift()!;
      await post(next);
    }
  }, [post]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flush();
      void resync();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flush, resync]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        "broadcast",
        { event: "state-update" },
        (msg: { payload?: { state?: LightMatchState } }) => {
          const incoming = msg.payload?.state;
          if (!incoming) return;
          if (incoming.lastSequence >= stateRef.current.lastSequence)
            setState(incoming);
        },
      )
      .on(
        "broadcast",
        { event: "serve-clock-start" },
        (msg: { payload?: { deadline?: number } }) => {
          if (msg.payload?.deadline) setServeClockDeadline(msg.payload.deadline);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId]);

  const value = useMemo<LightMatchContextValue>(
    () => ({
      matchId,
      state,
      config,
      rosterA,
      rosterB,
      teamAName,
      teamBName,
      dispatch,
      pending,
      online,
      serveClockDeadline,
      error,
    }),
    [
      matchId,
      state,
      config,
      rosterA,
      rosterB,
      teamAName,
      teamBName,
      dispatch,
      pending,
      online,
      serveClockDeadline,
      error,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
