"use client";

/**
 * The status page (spec/41).
 *
 * The "this screen" group is measured HERE, in the browser, and not on the
 * server: no datacentre can see a hall's wifi, a captive portal that logged
 * itself out, or a TV that has quietly dropped off the network. Everything else
 * comes from /api/status.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardStatus, CheckState } from "@/lib/board-status";

const REFRESH_MS = 10_000;

const LED: Record<CheckState, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  down: "bg-rose-500",
  idle: "bg-slate-600",
};
const TEXT: Record<CheckState, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  down: "text-rose-400",
  idle: "text-slate-400",
};

function Row({
  state, label, detail, value,
}: { state: CheckState; label: string; detail: string; value: string }) {
  return (
    <li className="flex items-center gap-4 border border-slate-800 bg-slate-950/60 px-4 py-3">
      <span className={`h-3 w-3 shrink-0 rounded-full ${LED[state]}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-slate-100">{label}</span>
        <span className="mt-0.5 block font-mono text-[11.5px] text-slate-500">{detail}</span>
      </span>
      <span className={`shrink-0 text-right font-mono text-[12.5px] ${TEXT[state]}`}>{value}</span>
      <span className="sr-only">{state}</span>
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-500">
        {title}
      </h2>
      <ul className="grid gap-2">{children}</ul>
    </section>
  );
}

export function StatusBoard({ initial }: { initial: BoardStatus }) {
  const [status, setStatus] = useState(initial);
  const [rtt, setRtt] = useState<number | null>(null);
  const [reachable, setReachable] = useState(true);
  const [probing, setProbing] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async (probe = false) => {
    if (busy.current) return;
    busy.current = true;
    const started = performance.now();
    try {
      const res = await fetch(`/api/status${probe ? "?probe=1" : ""}`, { cache: "no-store" });
      // A 503 is a legitimate answer here — it is how an uptime monitor learns
      // the boards are down — so parse the body either way.
      const data = (await res.json()) as BoardStatus;
      setRtt(Math.round(performance.now() - started));
      setReachable(true);
      setStatus(data);
    } catch {
      // The page itself could not reach the host: that IS the finding, and it
      // is the one thing the server could never have reported.
      setReachable(false);
    } finally {
      busy.current = false;
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    // Deferred rather than called straight from the effect: the first read
    // resolves into setState, and firing it synchronously cascades a render.
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const screenState: CheckState = !reachable ? "down" : (rtt ?? 0) > 1500 ? "warn" : "ok";
  const overall: CheckState = !reachable ? "down" : status.overall;
  const headline = !reachable ? "This screen cannot reach the board host" : status.headline;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-800 pb-4">
          <h1 className="font-mono text-sm uppercase tracking-[0.18em] text-slate-400">
            Scoreboard status
          </h1>
          <span className="font-mono text-[11.5px] text-slate-500">
            {status.environment}
            {status.commit ? ` · ${status.commit}` : ""} · refreshing every{" "}
            {REFRESH_MS / 1000}s
          </span>
        </header>

        <div className="mt-6 flex items-center gap-4 border border-slate-800 bg-slate-900/50 px-5 py-4">
          <span className={`h-5 w-5 shrink-0 rounded-full ${LED[overall]}`} aria-hidden />
          <div className="min-w-0">
            <p className="text-xl font-semibold">{headline}</p>
            <p className="mt-0.5 text-sm text-slate-400">
              {status.matches.filter((m) => m.state !== "idle").length} match
              {status.matches.filter((m) => m.state !== "idle").length === 1 ? "" : "es"} live ·{" "}
              {status.fromCache ? "read from cache" : "VIS probed live"}
            </p>
          </div>
        </div>

        <Group title="This screen">
          <Row
            state={screenState}
            label="Internet"
            detail="measured from this browser — no server can see it"
            value={reachable ? (rtt == null ? "…" : `round trip ${rtt} ms`) : "no connection"}
          />
          <Row
            state={reachable ? "ok" : "down"}
            label="Board host reachable"
            detail="the deployment serving this page"
            value={status.commit ? `commit ${status.commit}` : "—"}
          />
        </Group>

        <Group title="Platform">
          {status.checks.filter((c) => c.group === "platform").map((c) => (
            <Row key={c.id} state={c.state} label={c.label} detail={c.detail} value={c.value} />
          ))}
        </Group>

        <Group title="VIS">
          {status.checks.filter((c) => c.group === "vis").map((c) => (
            <Row key={c.id} state={c.state} label={c.label} detail={c.detail} value={c.value} />
          ))}
        </Group>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => { setProbing(true); void load(true); }}
            disabled={probing}
            className="border border-slate-700 px-3 py-1.5 font-mono text-[12px] text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            {probing ? "calling VIS…" : "Test VIS now"}
          </button>
          <span className="ml-3 font-mono text-[11.5px] text-slate-500">
            one live call — not done on the automatic refresh
          </span>
        </div>

        {status.matches.length > 0 ? (
          <Group title={`Matches this instance is serving — ${status.matches.length}`}>
            {status.matches.map((m) => (
              <Row key={m.matchNo} state={m.state} label={m.label} detail={m.detail} value={m.value} />
            ))}
          </Group>
        ) : null}

        {status.notes.length > 0 ? (
          <div className="mt-8 grid gap-2">
            {status.notes.map((n) => (
              <p key={n} className="border-l-2 border-slate-700 pl-3 text-[13px] leading-relaxed text-slate-400">
                {n}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
