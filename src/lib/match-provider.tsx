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
import { channelConfig, ensureRealtimeAuth } from "@/lib/realtime-client";
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
  teamAColor: string | null;
  teamBColor: string | null;
  dispatch: (payload: P) => void;
  pending: boolean;
  online: boolean;
  /** Events applied locally but not yet accepted by the server. */
  queuedCount: number;
  serveClockDeadline: number | null;
  error: string | null;
  /** Event types removed by the latest UNDO (auto-clears) — undo feedback. */
  undoneNotice: string[] | null;
}

export interface MatchProviderProps<S> {
  matchId: string;
  initialState: S;
  config: TournamentConfig;
  rosterA?: PlayerLite[];
  rosterB?: PlayerLite[];
  teamAName?: string;
  teamBName?: string;
  teamAColor?: string | null;
  teamBColor?: string | null;
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
    teamAColor = null,
    teamBColor = null,
    children,
  }: MatchProviderProps<S>) {
    const [state, setState] = useState<S>(initialState);
    const [pending, setPending] = useState(false);
    const [online, setOnline] = useState(() =>
      typeof navigator === "undefined" ? true : navigator.onLine,
    );
    const [queuedCount, setQueuedCount] = useState(0);
    const [serveClockDeadline, setServeClockDeadline] = useState<number | null>(
      null,
    );
    const [error, setError] = useState<string | null>(null);
    const [undoneNotice, setUndoneNotice] = useState<string[] | null>(null);

    const queue = useRef<P[]>([]);
    const stateRef = useRef(state);
    useEffect(() => {
      stateRef.current = state;
    }, [state]);

    // Undo feedback: show what the last UNDO removed, then clear it. The timer
    // lives in a ref so back-to-back undos restart it instead of stacking.
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashUndone = useCallback((types: string[]) => {
      setUndoneNotice(types);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setUndoneNotice(null), 5000);
    }, []);
    useEffect(
      () => () => {
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
      },
      [],
    );

    // Queued-but-unsent events survive a reload/navigation while offline —
    // previously they lived only in a ref and were silently lost.
    const storageKey = `vbqueue_${matchId}`;
    const persistQueue = useCallback(() => {
      setQueuedCount(queue.current.length);
      try {
        if (queue.current.length === 0) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify(queue.current));
      } catch {
        /* storage unavailable (private mode) — queue stays in memory */
      }
    }, [storageKey]);

    const resync = useCallback(
      async (since?: number, opts?: { force?: boolean }) => {
        try {
          const url =
            since != null
              ? `/api/matches/${matchId}/state?since=${since}`
              : `/api/matches/${matchId}/state`;
          const res = await fetch(url, { cache: "no-store" });
          if (res.status === 204) return; // already up to date
          if (!res.ok) return;
          const data = (await res.json()) as { state: S };
          // Monotonic guard: a resync that raced a write (e.g. an UNDO in
          // flight) can come back with an OLDER state; applying it re-showed
          // the undone point and scorers "retried", removing extra points. It
          // also keeps optimistic local events awaiting flush from being
          // clobbered. `force` (server rejected our event) restores authority.
          if (
            opts?.force ||
            data.state.lastSequence >= stateRef.current.lastSequence
          )
            setState(data.state);
        } catch {
          /* offline — keep optimistic state */
        }
      },
      [matchId],
    );

    /** Returns true when the event reached the server (even if rejected). */
    const post = useCallback(
      async (payload: P): Promise<boolean> => {
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
            // Rejected ⇒ our optimistic state is wrong; force past the
            // monotonic guard to restore the server's authoritative state.
            await resync(undefined, { force: true });
            return true; // delivered — the server rejected it, don't retry
          }
          const data = (await res.json()) as { state: S; undone?: string[] };
          setState(data.state);
          setError(null);
          if (payload.type === "UNDO" && Array.isArray(data.undone))
            flashUndone(data.undone);
          return true;
        } catch {
          queue.current.push(payload);
          persistQueue();
          return false;
        } finally {
          setPending(false);
        }
      },
      [matchId, resync, persistQueue, flashUndone],
    );

    // Posts are serialized through a promise chain: two quick taps otherwise
    // race server-side for the same sequence number and one 409s ("concurrent
    // write") even though both came from this device in order.
    const postChain = useRef<Promise<unknown>>(Promise.resolve());
    const enqueuePost = useCallback(
      (payload: P) => {
        postChain.current = postChain.current.then(() => post(payload));
      },
      [post],
    );

    const dispatch = useCallback(
      (payload: P) => {
        // UNDO re-replays server-side; skip optimism and take the authoritative response.
        if (payload.type === "UNDO") {
          enqueuePost(payload);
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
        enqueuePost(payload);
      },
      [config, enqueuePost],
    );

    const flush = useCallback(async () => {
      while (queue.current.length > 0) {
        const next = queue.current.shift()!;
        persistQueue();
        const delivered = await post(next);
        // Still unreachable: post() re-queued the payload — stop, or this loop
        // would spin forever on a captive portal / flaky venue Wi-Fi.
        if (!delivered) break;
      }
    }, [post, persistQueue]);

    // Restore any queue persisted before a reload and try to drain it.
    useEffect(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const items = JSON.parse(raw) as P[];
          if (Array.isArray(items) && items.length > 0) {
            queue.current.push(...items);
            setQueuedCount(queue.current.length);
            void flush();
          }
        }
      } catch {
        /* corrupt/unavailable storage — ignore */
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey]);

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
      ensureRealtimeAuth(supabase);
      const channel = supabase
        .channel(`match:${matchId}`, channelConfig())
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
    // When nothing is in flight, pass `since` — the server answers 204 from one
    // indexed MAX() instead of a snapshot load + tail replay.
    useEffect(() => {
      const id = setInterval(() => {
        if (stateRef.current.status === "FINISHED") return;
        const idle = queue.current.length === 0;
        void resync(idle ? stateRef.current.lastSequence : undefined);
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
        teamAColor,
        teamBColor,
        dispatch,
        pending,
        online,
        queuedCount,
        serveClockDeadline,
        error,
        undoneNotice,
      }),
      [
        matchId,
        state,
        config,
        rosterA,
        rosterB,
        teamAName,
        teamBName,
        teamAColor,
        teamBColor,
        dispatch,
        pending,
        online,
        queuedCount,
        serveClockDeadline,
        error,
        undoneNotice,
      ],
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }

  return { Provider, useMatchCtx };
}
