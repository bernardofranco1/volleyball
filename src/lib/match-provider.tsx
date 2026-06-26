"use client";

// Generic optimistic match provider (spec/14 §F1). The optimistic dispatch,
// realtime subscription, offline queue, and resync are identical across the
// rotation disciplines (indoor/grass/light) — this factory holds that logic
// once; each discipline wraps it with its `appendXEvent` + types.
//
// Realtime is treated as untrusted (spec/14 §B1): a `state-update` broadcast is
// only a "something advanced" signal carrying `lastSequence`; the provider then
// refetches authoritative state from `/api/matches/[id]/state`.

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

export interface PlayerLite {
  id: string;
  fullName: string;
  jerseyNumber: number | null;
  isLibero: boolean;
}

interface ClientState {
  lastSequence: number;
  status: string;
}

interface AppendOpts {
  nextSequence: number;
  timestamp: string;
  makeId: (seq: number) => string;
}

type AppendFn<S, P> = (
  state: S,
  payload: P,
  config: TournamentConfig,
  opts: AppendOpts,
) => { ok: true; state: S } | { ok: false; reason: string };

export interface MatchContextValue<S, P> {
  matchId: string;
  state: S;
  config: TournamentConfig;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  teamAName: string;
  teamBName: string;
  dispatch: (payload: P) => void;
  pending: boolean;
  online: boolean;
  serveClockDeadline: number | null;
  error: string | null;
}

export interface MatchProviderProps<S> {
  matchId: string;
  initialState: S;
  config: TournamentConfig;
  rosterA?: PlayerLite[];
  rosterB?: PlayerLite[];
  teamAName?: string;
  teamBName?: string;
  children: React.ReactNode;
}

export function createMatchProvider<
  S extends ClientState,
  P extends { type: string },
>(opts: { append: AppendFn<S, P>; isRallyWon: (p: P) => boolean }) {
  const Ctx = createContext<MatchContextValue<S, P> | null>(null);

  function useMatchCtx(): MatchContextValue<S, P> {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error("useMatch must be used within its MatchProvider");
    return ctx;
  }

  function Provider({
    matchId,
    initialState,
    config,
    rosterA = [],
    rosterB = [],
    teamAName = "",
    teamBName = "",
    children,
  }: MatchProviderProps<S>) {
    const [state, setState] = useState<S>(initialState);
    const [pending, setPending] = useState(false);
    const [online, setOnline] = useState(() =>
      typeof navigator === "undefined" ? true : navigator.onLine,
    );
    const [serveClockDeadline, setServeClockDeadline] = useState<number | null>(
      null,
    );
    const [error, setError] = useState<string | null>(null);

    const queue = useRef<P[]>([]);
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
        const data = (await res.json()) as { state: S };
        setState(data.state);
      } catch {
        /* offline — keep optimistic state */
      }
    }, [matchId]);

    const post = useCallback(
      async (payload: P) => {
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
          const data = (await res.json()) as { state: S };
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
      (payload: P) => {
        // UNDO re-replays server-side; skip optimism and take the authoritative response.
        if (payload.type === "UNDO") {
          void post(payload);
          return;
        }
        const result = opts.append(stateRef.current, payload, config, {
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
          opts.isRallyWon(payload) &&
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
          (msg: { payload?: { lastSequence?: number } }) => {
            const seq = msg.payload?.lastSequence;
            if (typeof seq === "number" && seq > stateRef.current.lastSequence)
              void resync();
          },
        )
        .on(
          "broadcast",
          { event: "serve-clock-start" },
          (msg: { payload?: { deadline?: number } }) => {
            if (msg.payload?.deadline)
              setServeClockDeadline(msg.payload.deadline);
          },
        )
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    }, [matchId, resync]);

    // Backstop reconcile: catches realtime signals that never arrived (broker
    // outage / dropped messages) so a live view can't silently go stale (§P11.2).
    useEffect(() => {
      const id = setInterval(() => {
        if (stateRef.current.status !== "FINISHED") void resync();
      }, 25000);
      return () => clearInterval(id);
    }, [resync]);

    const value = useMemo<MatchContextValue<S, P>>(
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

  return { Provider, useMatchCtx };
}
