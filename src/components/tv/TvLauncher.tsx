"use client";

/**
 * The launcher form (spec/47). Resolves the paste before navigating, so a bad
 * link is refused here rather than becoming a black rectangle on the output
 * page.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  delayStorageKey,
  encodeStreamParam,
  resolveStreamUrl,
  type StreamSource,
} from "@/lib/tv/stream-url";
import { DEFAULT_DELAY_S, MAX_DELAY_S, clampDelay } from "@/lib/tv/delay";

export interface LaunchableMatch {
  matchNo: number;
  competition: string;
  label: string;
  status: "LIVE" | "UPCOMING" | "FINISHED";
  when: string | null;
  hall: string | null;
}

export function TvLauncher({ matches }: { matches: LaunchableMatch[] }) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [match, setMatch] = useState("");
  const [delay, setDelay] = useState(String(DEFAULT_DELAY_S));

  const resolved: StreamSource | null = useMemo(
    () => (link.trim() ? resolveStreamUrl(link) : null),
    [link],
  );
  const ok = resolved?.kind === "hls" || resolved?.kind === "relay";
  const target = match.trim();

  const go = () => {
    if (!ok || !target) return;
    const d = clampDelay(delay);
    router.push(
      `/tv/${encodeURIComponent(target)}` +
        `?s=${encodeStreamParam(resolved.url)}&delay=${d}`,
    );
  };

  return (
    <main style={S.page}>
      <div style={S.card}>
        <h1 style={S.h1}>TV graphics overlay</h1>
        <p style={S.sub}>
          The output page is what goes to air. Add it to the vision mixer as a
          browser source at 1920&times;1080 and press F for fullscreen.
        </p>

        <label style={S.label} htmlFor="tv-link">
          Stream link
        </label>
        <input
          id="tv-link"
          style={S.input}
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            // Recall the delay this host was last run at. Done here, on the
            // change, rather than in an effect on mount: it is a response to
            // the operator naming a stream, which is exactly when the answer
            // becomes knowable.
            const s = resolveStreamUrl(e.target.value);
            if (s.kind === "unsupported") return;
            try {
              const saved = window.localStorage.getItem(
                delayStorageKey(new URL(s.url).host),
              );
              if (saved != null && Number.isFinite(Number(saved))) setDelay(saved);
            } catch {
              /* private window, or an unparseable host: keep the default */
            }
          }}
          placeholder="https://streaming.volleystation.com:5443/FIVB/play.html?id=fivb15"
          spellCheck={false}
          autoComplete="off"
        />
        {resolved ? (
          <p style={resolved.kind === "unsupported" ? S.bad : S.good}>
            {resolved.kind === "unsupported" ? resolved.reason : resolved.label}
          </p>
        ) : (
          <p style={S.hint}>
            A VolleyStation/Ant Media player link, or an .m3u8 (HLS) URL.
          </p>
        )}

        <label style={S.label} htmlFor="tv-match">
          Match
        </label>
        <input
          id="tv-match"
          style={S.input}
          value={match}
          onChange={(e) => setMatch(e.target.value)}
          placeholder="VIS match number, or mock / replay"
          list="tv-matches"
          spellCheck={false}
          autoComplete="off"
        />
        <datalist id="tv-matches">
          {matches.map((m) => (
            <option key={m.matchNo} value={String(m.matchNo)}>
              {`${m.status} · ${m.label} · ${m.competition}`}
            </option>
          ))}
        </datalist>
        <p style={S.hint}>
          <button type="button" style={S.linkish} onClick={() => setMatch("replay")}>
            replay
          </button>{" "}
          is a real match on a permanent loop — use it to set the delay and learn
          the keys without waiting for a fixture.
        </p>

        <label style={S.label} htmlFor="tv-delay">
          Graphics delay — {delay}s
        </label>
        <input
          id="tv-delay"
          style={{ ...S.input, padding: 0 }}
          type="range"
          min={0}
          max={MAX_DELAY_S}
          step={0.5}
          value={delay}
          onChange={(e) => setDelay(e.target.value)}
        />
        <p style={S.hint}>
          How far the stream runs behind the data. Tune it on air with{" "}
          <kbd style={S.kbd}>[</kbd> and <kbd style={S.kbd}>]</kbd> until the score
          changes as the point lands.
        </p>

        <button type="button" style={ok && target ? S.go : S.goOff} onClick={go}>
          Open output
        </button>

        {matches.length > 0 ? (
          <div style={S.list}>
            {matches.slice(0, 12).map((m) => (
              <button
                key={m.matchNo}
                type="button"
                style={S.row}
                onClick={() => setMatch(String(m.matchNo))}
              >
                <span style={{ ...S.pill, ...pillFor(m.status) }}>{m.status}</span>
                <span style={{ flex: 1 }}>{m.label}</span>
                <span style={S.dim}>{m.competition}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function pillFor(s: LaunchableMatch["status"]) {
  if (s === "LIVE") return { background: "#E81C37", color: "#fff" };
  if (s === "UPCOMING") return { background: "#1f2937", color: "#9ca3af" };
  return { background: "#111827", color: "#6b7280" };
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#05070f",
    color: "#e5e7eb",
    display: "grid",
    placeItems: "start center",
    padding: "48px 16px",
    font: "400 15px/1.5 system-ui, -apple-system, sans-serif",
  },
  card: { width: "min(680px, 100%)" },
  h1: { font: "600 26px/1.2 system-ui, sans-serif", margin: "0 0 6px" },
  sub: { color: "#9ca3af", margin: "0 0 28px" },
  label: {
    display: "block",
    font: "600 12px/1 system-ui, sans-serif",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#9ca3af",
    margin: "20px 0 8px",
  },
  input: {
    width: "100%",
    background: "#0d1220",
    border: "1px solid #1f2937",
    borderRadius: 8,
    color: "#e5e7eb",
    padding: "11px 13px",
    font: "400 14px/1.4 ui-monospace, monospace",
  },
  hint: { color: "#6b7280", font: "400 13px/1.5 system-ui, sans-serif", margin: "8px 0 0" },
  good: { color: "#34d399", font: "400 13px/1.5 ui-monospace, monospace", margin: "8px 0 0" },
  bad: { color: "#f87171", font: "400 13px/1.5 system-ui, sans-serif", margin: "8px 0 0" },
  go: {
    marginTop: 28,
    width: "100%",
    background: "#E81C37",
    color: "#fff",
    border: 0,
    borderRadius: 8,
    padding: "13px 16px",
    font: "600 15px/1 system-ui, sans-serif",
    cursor: "pointer",
  },
  goOff: {
    marginTop: 28,
    width: "100%",
    background: "#1f2937",
    color: "#6b7280",
    border: 0,
    borderRadius: 8,
    padding: "13px 16px",
    font: "600 15px/1 system-ui, sans-serif",
    cursor: "not-allowed",
  },
  list: { marginTop: 34, borderTop: "1px solid #1f2937" },
  row: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: 0,
    borderBottom: "1px solid #111827",
    color: "#d1d5db",
    padding: "10px 2px",
    font: "400 14px/1.3 system-ui, sans-serif",
    cursor: "pointer",
  },
  pill: {
    font: "600 10px/1 system-ui, sans-serif",
    letterSpacing: "0.06em",
    padding: "4px 6px",
    borderRadius: 4,
    minWidth: 62,
    textAlign: "center",
  },
  dim: { color: "#6b7280", font: "400 12px/1.3 system-ui, sans-serif" },
  linkish: {
    background: "transparent",
    border: 0,
    color: "#60a5fa",
    padding: 0,
    font: "inherit",
    textDecoration: "underline",
    cursor: "pointer",
  },
  kbd: {
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: 4,
    padding: "1px 5px",
    font: "400 12px/1 ui-monospace, monospace",
  },
};
