/**
 * What the operator pasted → something a browser can actually play (spec/47).
 *
 * Pure and dependency-free: the entry form calls it to validate a paste, the
 * viewer calls it again on the value it decoded from the URL, and the tests
 * call it on every shape we have seen in the wild. No network — a URL that
 * looks right and is dead is the player's problem to report, not this
 * function's to predict.
 *
 * A browser plays HLS and nothing else here. It cannot play RTMP at all, and
 * it cannot play SRT; both are ingest protocols, and turning one into HLS needs
 * a process holding a socket open, which Vercel does not do. So those two
 * resolve to a `relay` answer that is only useful when a relay is configured,
 * and otherwise to a refusal that says why.
 */

/** The one env var this feature adds. Unset on every deployment today. */
const RELAY_BASE = process.env.NEXT_PUBLIC_TV_RELAY_HLS_BASE;

export type StreamSource =
  /** Play this URL directly, via hls.js or Safari's native HLS. */
  | { kind: "hls"; url: string; label: string }
  /** An ingest URL mapped onto a configured HLS relay. */
  | { kind: "relay"; url: string; label: string; streamName: string }
  /** Nothing playable. `reason` is shown to the operator verbatim. */
  | { kind: "unsupported"; reason: string };

/**
 * Ant Media's player page, which is what VolleyStation hands out:
 *   https://streaming.volleystation.com:5443/FIVB/play.html?id=fivb15
 * The same server serves the stream itself one path along:
 *   https://streaming.volleystation.com:5443/FIVB/streams/fivb15.m3u8
 * Verified against FIVB/fivb15 on 2026-08-21 — 200, content-type
 * application/vnd.apple.mpegurl, and `access-control-allow-origin: *`, so the
 * browser fetches it cross-origin with no proxy of ours in the path.
 */
function antMedia(u: URL): StreamSource | null {
  if (!/\/play\.html$/.test(u.pathname)) return null;
  const id = u.searchParams.get("id") ?? u.searchParams.get("name");
  if (!id || !/^[\w.-]{1,128}$/.test(id)) {
    return {
      kind: "unsupported",
      reason: "That looks like an Ant Media player link but it carries no stream id.",
    };
  }
  const app = u.pathname.replace(/\/play\.html$/, "");
  const out = new URL(u.origin + app + "/streams/" + id + ".m3u8");
  // Token security, when the server has it switched on. Carried through
  // untouched: it is a credential for the stream, and dropping it turns a
  // working link into a 403 that looks like a dead stream.
  const token = u.searchParams.get("token");
  if (token) out.searchParams.set("token", token);
  return { kind: "hls", url: out.toString(), label: `${id} · Ant Media (HLS)` };
}

/**
 * rtmp://host/app/NAME and srt://host:port?streamid=publish:NAME both name a
 * stream; a relay republishes it as {base}/NAME/index.m3u8 (see spec/47
 * appendix A for the MediaMTX config that does this).
 */
function ingest(raw: string, scheme: "rtmp" | "srt"): StreamSource {
  const name = streamNameOf(raw, scheme);
  if (!name) {
    return {
      kind: "unsupported",
      reason: `A ${scheme.toUpperCase()} URL has to name a stream; this one does not.`,
    };
  }
  if (!RELAY_BASE) {
    return {
      kind: "unsupported",
      reason:
        `Browsers cannot play ${scheme.toUpperCase()}. Point the encoder at an HLS ` +
        `output instead, or set NEXT_PUBLIC_TV_RELAY_HLS_BASE to a relay that ` +
        `republishes "${name}" as HLS.`,
    };
  }
  const base = RELAY_BASE.replace(/\/$/, "");
  return {
    kind: "relay",
    url: `${base}/${encodeURIComponent(name)}/index.m3u8`,
    label: `${name} · via relay`,
    streamName: name,
  };
}

function streamNameOf(raw: string, scheme: "rtmp" | "srt"): string | null {
  if (scheme === "srt") {
    // srt://host:9999?streamid=publish:NAME — the id may also be bare.
    const m = /[?&]streamid=([^&]+)/i.exec(raw);
    if (!m) return null;
    const id = decodeURIComponent(m[1]);
    const tail = id.split(":").pop() ?? "";
    return /^[\w.-]{1,128}$/.test(tail) ? tail : null;
  }
  // rtmp://host[:port]/app/NAME — the last non-empty path segment.
  const path = raw.replace(/^rtmp:\/\/[^/]+/i, "");
  const segs = path.split("?")[0].split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  return /^[\w.-]{1,128}$/.test(last) ? last : null;
}

/** Resolve one operator paste. Never throws. */
export function resolveStreamUrl(input: string): StreamSource {
  const raw = input.trim();
  if (!raw) return { kind: "unsupported", reason: "Paste a stream link first." };

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme === "rtmp" || scheme === "rtmps") return ingest(raw, "rtmp");
  if (scheme === "srt") return ingest(raw, "srt");

  if (scheme && scheme !== "http" && scheme !== "https") {
    return { kind: "unsupported", reason: `${scheme}: links cannot be played here.` };
  }

  let u: URL;
  try {
    u = new URL(scheme ? raw : `https://${raw}`);
  } catch {
    return { kind: "unsupported", reason: "That is not a URL." };
  }

  // http: would be blocked as mixed content the moment this page is served over
  // https, which it always is in production. Say so now rather than let the
  // operator debug a black frame during a warm-up.
  if (u.protocol === "http:" && !isLocal(u.hostname)) {
    return {
      kind: "unsupported",
      reason: "The stream must be https — an http stream is blocked on an https page.",
    };
  }

  const am = antMedia(u);
  if (am) return am;

  if (/\.m3u8$/i.test(u.pathname)) {
    return { kind: "hls", url: u.toString(), label: `${last(u)} · HLS` };
  }
  if (/\.mpd$/i.test(u.pathname)) {
    return {
      kind: "unsupported",
      reason: "DASH (.mpd) is not supported — use the HLS (.m3u8) output.",
    };
  }
  // Anything else https: try it as HLS. Plenty of CDNs serve a playlist from a
  // path with no extension, and the player reports a real failure in seconds;
  // refusing here would reject working links for the sake of being tidy.
  return { kind: "hls", url: u.toString(), label: `${last(u)} · assuming HLS` };
}

function isLocal(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function last(u: URL): string {
  const segs = u.pathname.split("/").filter(Boolean);
  return segs[segs.length - 1] || u.hostname;
}

// ── carrying the choice in the URL ───────────────────────────────────────────
//
// The resolved stream travels in `?s=` so that the output page is a bookmark
// and an OBS browser source, not a form that has to be filled in again after a
// refresh. base64url because a raw stream URL nested in a query string is a
// thicket of re-encoded ampersands, and one operator's copy-paste through a
// chat window is enough to lose a token.

// btoa/atob rather than Buffer: the entry form encodes in the browser and the
// output page decodes on the server, so this module is imported from both
// bundles and Buffer is not there for the client half. Both globals exist in
// Node 18 and every target browser; TextEncoder carries the UTF-8 step that
// btoa on its own gets wrong.

export function encodeStreamParam(url: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(url)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeStreamParam(param: string | undefined | null): string | null {
  if (!param) return null;
  try {
    const b64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const url = new TextDecoder().decode(bytes);
    // Round-trip guard: a truncated or hand-edited param decodes to mojibake,
    // and handing that to <video> is a silent failure.
    return /^(https?|rtmps?|srt):\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Where the remembered graphics delay for a stream host lives.
 *
 * Keyed by HOST because the delay is a property of the encoder and the path to
 * it, not of the match — it is the same for every fixture of an event. Written
 * by the output page as the operator dials it in, read by the launcher so the
 * next match starts where the last one ended.
 */
export function delayStorageKey(host: string): string {
  return `tv:delay:${host}`;
}
