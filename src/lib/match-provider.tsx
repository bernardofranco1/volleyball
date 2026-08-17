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
import { matchTopic } from "@/lib/realtime-topics";
import type { StaffFunction } from "@/lib/roster";

/**
 * How stale an unsent queue may be before it is discarded instead of replayed
 * (spec/29 Phase 7 audit).
 *
 * Long enough to cover a real venue outage and a scorer walking back into
 * range — a set, a change of ends, a device sleeping through half-time. Short
 * enough that it can never reach the NEXT match on the same device, which is
 * the case that would put someone else's rallies into this scoresheet.
 */
export const QUEUE_MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours

export interface PlayerLite {
  id: string;
  /**
   * The jersey/shirt name — the ONLY name a match surface prints (spec/26).
   * Registration names never reach here, which is why the field is not called
   * `jerseyName` any more.
   */
  jerseyName: string;
  jerseyNumber: number | null;
  isLibero: boolean;
  /** Team captain per the roster — pre-selects the signer on the sign-off panel. */
  isCaptain?: boolean;
  /**
   * What kind of roster row this is (spec/29 F1). Rosters now carry bench
   * officials as well as players, so anything choosing a body for the COURT
   * must filter with `courtEligible` from @/lib/roster — otherwise the coach
   * appears in lineup entry and the substitution panel.
   *
   * Optional for the same reason as `isCaptain`: surfaces that were built
   * before staff existed keep compiling, and a row without a role is treated
   * as a player.
   */
  role?: "PLAYER" | "BENCH" | "STAFF";
  /** Scoresheet letter for a bench official: C1, A1-A3, D1, T, P. */
  staffFunction?: StaffFunction | null;
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
    //
    // sessionStorage, NOT localStorage (spec/29 Phase 7 audit). localStorage is
    // shared by every tab on the origin, and nothing here coordinated them:
    //
    //   • two consoles open on the same match both restored the SAME persisted
    //     queue on mount and both flushed it — every queued point scored twice;
    //   • `persistQueue` overwrites the key with the calling tab's queue, so a
    //     second tab going idle (queue empty → removeItem) silently DELETED the
    //     first tab's unsent events.
    //
    // sessionStorage is per tab and survives reload and navigation, which is
    // exactly the documented purpose. The only thing given up is a queue
    // surviving the tab being closed outright — a far smaller loss than
    // double-scoring a match.
    const storageKey = `vbqueue_${matchId}`;
    const persistQueue = useCallback(() => {
      setQueuedCount(queue.current.length);
      try {
        if (queue.current.length === 0) sessionStorage.removeItem(storageKey);
        else
          sessionStorage.setItem(
            storageKey,
            // Stamped so a queue restored after a long disconnect can be aged
            // out rather than replayed into a match that has moved on.
            JSON.stringify({ savedAt: Date.now(), items: queue.current }),
          );
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
        // The queue moved from localStorage to sessionStorage (spec/29 Phase
        // 7). Nothing migrated it, so a scorer with events queued under the
        // OLD build who reloaded onto the NEW one lost them silently, and the
        // legacy keys sat on every scoring device forever (spec/30 R3).
        //
        // A legacy queue is CLEARED and its contents are NOT replayed. That
        // looks harsh, so the reasoning matters:
        //
        //   • The legacy shape is a bare array with no timestamp, so its age
        //     cannot be bounded — and the age-out below exists precisely
        //     because replaying old rallies into a match that has since been
        //     scored, corrected or signed corrupts the official record.
        //   • The loss it risks is small and largely theoretical. A scorer who
        //     is OFFLINE cannot load a new build; they keep running the old
        //     one, which flushes its own queue on reconnect. For the new code
        //     to meet a fresh legacy queue, the device must have been online —
        //     in which case the queue had already drained.
        //   • What remains on devices is therefore mostly old keys from
        //     sessions long over: exactly what must not be replayed.
        //
        // So: clear it, say so, and let the scorer check the court. Clearing
        // also ends the cross-tab hazard that moving to sessionStorage was
        // meant to close, and stops the keys accumulating forever.
        const legacy = localStorage.getItem(storageKey);
        if (legacy) {
          localStorage.removeItem(storageKey);
          try {
            const items = JSON.parse(legacy) as unknown;
            if (Array.isArray(items) && items.length > 0) {
              setError(
                `${items.length} unsent action(s) from an earlier session could not be dated and were not replayed. Check the score against the court.`,
              );
            }
          } catch {
            /* unreadable legacy value — dropping it silently is right */
          }
        }

        const raw = sessionStorage.getItem(storageKey);
        if (!raw) return;
        // Only ever the stamped shape here: sessionStorage was introduced
        // together with the stamp, so an unstamped value in it is corruption,
        // not history — and it is treated as such (dropped, below).
        const parsed = JSON.parse(raw) as { savedAt?: number; items?: P[] };
        const items = Array.isArray(parsed) ? [] : (parsed.items ?? []);
        const savedAt = Array.isArray(parsed) ? null : (parsed.savedAt ?? null);
        if (!Array.isArray(items) || items.length === 0) return;

        // Age-out (spec/29 Phase 7 audit). Replaying rallies from hours ago
        // into a match that has since been scored, corrected or signed would
        // corrupt the official record, and the scorer has no way to see it
        // coming. An undatable queue counts as too old for the same reason.
        if (savedAt == null || Date.now() - savedAt > QUEUE_MAX_AGE_MS) {
          sessionStorage.removeItem(storageKey);
          setError(
            "Unsent actions from an earlier session were too old to send and have been discarded. Check the score against the court.",
          );
          return;
        }

        queue.current.push(...items);
        setQueuedCount(queue.current.length);
        void flush();
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
        .channel(matchTopic(matchId), channelConfig())
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
