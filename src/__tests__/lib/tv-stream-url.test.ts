/**
 * What an operator can paste into /tv (spec/47).
 *
 * The interesting cases are the ones that must be REFUSED with a reason, because
 * the alternative is a black rectangle on air and an operator with nothing to go
 * on. The Ant Media case is the one that matters most: it is the link
 * VolleyStation actually hands out, and it is not itself playable.
 */

import { describe, expect, it } from "vitest";
import {
  decodeStreamParam,
  encodeStreamParam,
  resolveStreamUrl,
} from "@/lib/tv/stream-url";

describe("Ant Media player links", () => {
  it("turns VolleyStation's own link into its HLS manifest", () => {
    // Verified live on 2026-08-21: this manifest answers 200 with
    // content-type application/vnd.apple.mpegurl and access-control-allow-origin: *
    const got = resolveStreamUrl(
      "https://streaming.volleystation.com:5443/FIVB/play.html?id=fivb15",
    );
    expect(got.kind).toBe("hls");
    expect(got.kind === "hls" && got.url).toBe(
      "https://streaming.volleystation.com:5443/FIVB/streams/fivb15.m3u8",
    );
  });

  it("carries a stream token through, because dropping it reads as a dead stream", () => {
    const got = resolveStreamUrl(
      "https://s.example.com:5443/APP/play.html?id=abc&token=SECRET123",
    );
    expect(got.kind === "hls" && got.url).toBe(
      "https://s.example.com:5443/APP/streams/abc.m3u8?token=SECRET123",
    );
  });

  it("accepts ?name= as well as ?id=", () => {
    const got = resolveStreamUrl("https://s.example.com/LIVE/play.html?name=court1");
    expect(got.kind === "hls" && got.url).toContain("/LIVE/streams/court1.m3u8");
  });

  it("refuses a player link with no stream id, rather than guessing one", () => {
    const got = resolveStreamUrl("https://s.example.com/FIVB/play.html");
    expect(got.kind).toBe("unsupported");
    expect(got.kind === "unsupported" && got.reason).toMatch(/stream id/i);
  });
});

describe("direct URLs", () => {
  it("takes an .m3u8 as it is", () => {
    const u = "https://cdn.example.com/live/master.m3u8?wowzasessionid=9";
    expect(resolveStreamUrl(u)).toMatchObject({ kind: "hls", url: u });
  });

  it("assumes HLS for an extensionless https path rather than refusing it", () => {
    // Plenty of CDNs serve a playlist from a path with no extension, and the
    // player reports a real failure in seconds.
    expect(resolveStreamUrl("https://cdn.example.com/live/abc").kind).toBe("hls");
  });

  it("adds https:// to a bare host", () => {
    const got = resolveStreamUrl("cdn.example.com/live/x.m3u8");
    expect(got.kind === "hls" && got.url).toBe("https://cdn.example.com/live/x.m3u8");
  });

  it("refuses DASH by name, since the package always has an HLS output too", () => {
    const got = resolveStreamUrl("https://cdn.example.com/live/manifest.mpd");
    expect(got.kind === "unsupported" && got.reason).toMatch(/HLS/);
  });

  it("refuses http, because the page is https and the browser would block it", () => {
    const got = resolveStreamUrl("http://cdn.example.com/live/x.m3u8");
    expect(got.kind).toBe("unsupported");
    expect(got.kind === "unsupported" && got.reason).toMatch(/https/);
  });

  it("allows http on localhost, which is where it is legitimate", () => {
    expect(resolveStreamUrl("http://localhost:8888/live/x.m3u8").kind).toBe("hls");
  });

  it("refuses anything that is not a stream protocol", () => {
    for (const u of ["javascript:alert(1)", "data:text/html,<b>", "file:///etc/passwd"]) {
      expect(resolveStreamUrl(u).kind, u).toBe("unsupported");
    }
  });

  it("asks for a link rather than failing silently on an empty box", () => {
    expect(resolveStreamUrl("   ").kind).toBe("unsupported");
  });
});

describe("ingest protocols a browser cannot play", () => {
  it("explains RTMP instead of pretending, when no relay is configured", () => {
    const got = resolveStreamUrl("rtmp://encoder.example.com/live/court1");
    expect(got.kind).toBe("unsupported");
    expect(got.kind === "unsupported" && got.reason).toMatch(/cannot play RTMP/i);
    // The stream name is quoted back, so the operator knows it was understood.
    expect(got.kind === "unsupported" && got.reason).toContain("court1");
  });

  it("reads an SRT streamid, publish: prefix and all", () => {
    const got = resolveStreamUrl("srt://relay.example.com:8890?streamid=publish:court2");
    expect(got.kind === "unsupported" && got.reason).toContain("court2");
  });

  it("refuses an SRT URL that names no stream", () => {
    const got = resolveStreamUrl("srt://relay.example.com:8890");
    expect(got.kind === "unsupported" && got.reason).toMatch(/name a stream/i);
  });
});

describe("carrying the stream in the URL", () => {
  it("round-trips a URL with a query string intact", () => {
    const u = "https://s.example.com:5443/FIVB/streams/fivb15.m3u8?token=a+b/c=";
    expect(decodeStreamParam(encodeStreamParam(u))).toBe(u);
  });

  it("produces a param with nothing that needs escaping again", () => {
    const p = encodeStreamParam("https://a.example.com/x.m3u8?q=1&r=2");
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a truncated or hand-edited param instead of handing mojibake to <video>", () => {
    const p = encodeStreamParam("https://a.example.com/x.m3u8");
    expect(decodeStreamParam(p.slice(0, 6))).toBeNull();
    expect(decodeStreamParam("!!!!not base64!!!!")).toBeNull();
    expect(decodeStreamParam(encodeStreamParam("not a url at all"))).toBeNull();
  });

  it("treats a missing param as no stream", () => {
    expect(decodeStreamParam(undefined)).toBeNull();
    expect(decodeStreamParam("")).toBeNull();
  });
});
