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
import type { TournamentConfig } from "@/engine/config";
import { appendBeachEvent } from "@/engine/beach/reducer";
import type {
  BeachEventPayload,
  BeachMatchState,
} from "@/engine/beach/types";

interface MatchContextValue {
  matchId: string;
  state: BeachMatchState;
  config: TournamentConfig;
  /** Send an event: applied optimistically, then confirmed by the server. */
  dispatch: (payload: BeachEventPayload) => void;
  pending: boolean;
  online: boolean;
  serveClockDeadline: number | null;
  error: string | null;
}

const MatchContext = createContext<MatchContextValue | null>(null);

export function useMatch(): MatchContextValue {
  const ctx = useContext(MatchContext);
  if (!ctx) throw new Error("useMatch must be used within <MatchProvider>");
  return ctx;
}

export function MatchProvider({
  matchId,
  initialState,
  config,
  children,
}: {
  matchId: string;
  initialState: BeachMatchState;
  config: TournamentConfig;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<BeachMatchState>(initialState);
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [serveClockDeadline, setServeClockDeadline] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Authoritative sequence we've confirmed from the server. Optimistic updates
  // may run ahead; a server/realtime payload with a >= sequence replaces them.
  const queue = useRef<BeachEventPayload[]>([]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Full resync from the server (used on error / reconnect).
  const resync = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/state`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { state: BeachMatchState };
      setState(data.state);
    } catch {
      /* offline — keep optimistic state */
    }
  }, [matchId]);

  const post = useCallback(
    async (payload: BeachEventPayload) => {
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
        const data = (await res.json()) as { state: BeachMatchState };
        setState(data.state); // authoritative
        setError(null);
      } catch {
        // Network error — queue for flush on reconnect; keep optimistic state.
        queue.current.push(payload);
      } finally {
        setPending(false);
      }
    },
    [matchId, resync],
  );

  const dispatch = useCallback(
    (payload: BeachEventPayload) => {
      // UNDO removes a prior event — the server resolves the target and
      // re-replays, so we skip optimism and apply the authoritative response.
      if (payload.type === "UNDO") {
        void post(payload);
        return;
      }
      // Optimistic: run the same pure engine the server uses.
      const result = appendBeachEvent(stateRef.current, payload, config, {
        nextSequence: stateRef.current.lastSequence + 1,
        timestamp: new Date().toISOString(),
        makeId: (seq) => `temp-${seq}`,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setState(result.state);
      // Start the local serve-clock immediately on our own rally.
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

  // Flush the offline queue when connectivity returns.
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

  // Realtime: other devices' updates + serve-clock countdowns.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        "broadcast",
        { event: "state-update" },
        (msg: { payload?: { state?: BeachMatchState } }) => {
          const incoming = msg.payload?.state;
          if (!incoming) return;
          // Only accept updates at or beyond our confirmed sequence.
          if (incoming.lastSequence >= stateRef.current.lastSequence) {
            setState(incoming);
          }
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

  const value = useMemo<MatchContextValue>(
    () => ({
      matchId,
      state,
      config,
      dispatch,
      pending,
      online,
      serveClockDeadline,
      error,
    }),
    [matchId, state, config, dispatch, pending, online, serveClockDeadline, error],
  );

  return <MatchContext.Provider value={value}>{children}</MatchContext.Provider>;
}
