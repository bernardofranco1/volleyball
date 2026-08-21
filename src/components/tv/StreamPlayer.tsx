"use client";

/**
 * The video underneath the graphics (spec/47).
 *
 * One job, done defensively: get an operator-supplied HLS URL playing and keep
 * it playing for the length of a match, without ever throwing up a browser
 * error poster where a picture should be.
 *
 * Safari (and iPad, which is what a small production sometimes uses) plays HLS
 * natively and does it better than hls.js can — lower latency, hardware
 * decoding — so it gets the plain `src` path and hls.js is not loaded at all.
 * Everywhere else, hls.js.
 *
 * The element is muted, and stays muted. Autoplay with sound is blocked without
 * a user gesture, and a page that silently fails to start is useless in a
 * gallery; the programme audio on a TV feed is not this page's job anyway.
 */

import { useEffect, useRef, useState } from "react";
import { AVC } from "@/lib/tv/bug-geometry";

export type PlayerState = "loading" | "playing" | "recovering" | "failed";

/** Recovery backoff: a stream that drops at half-time comes back on its own. */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 20_000;

export function StreamPlayer({
  src,
  onState,
  onGeometry,
}: {
  src: string;
  onState?: (s: PlayerState) => void;
  /**
   * The video's own aspect ratio once known. The overlay is positioned on the
   * PICTURE, not on the element: a 16:9 graphic drawn over a letterboxed 4:3
   * feed has to sit inside the picture or the score bug floats in the black.
   */
  onGeometry?: (ratio: number) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<PlayerState>("loading");
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
    onState?.(state);
  }, [state, onState]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let cancelled = false;
    let retryAt = RETRY_MIN_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hls.js is loaded lazily
    let hls: any = null;

    const onPlaying = () => {
      if (cancelled) return;
      retryAt = RETRY_MIN_MS;
      setState("playing");
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onGeometry?.(video.videoWidth / video.videoHeight);
      }
    };

    const retry = () => {
      if (cancelled) return;
      setState("recovering");
      timer = setTimeout(() => {
        if (cancelled) return;
        retryAt = Math.min(RETRY_MAX_MS, retryAt * 2);
        void start();
      }, retryAt);
    };

    const start = async () => {
      if (cancelled) return;
      // Native HLS first: if the browser can play the manifest itself, let it.
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        try {
          await video.play();
        } catch {
          // Autoplay refused despite muted, or the manifest is not there yet.
          retry();
        }
        return;
      }
      const mod = await import("hls.js");
      const Hls = mod.default;
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setState("failed");
        return;
      }
      hls?.destroy();
      hls = new Hls({
        // Live tuning. Three segments back from the live edge is the usual
        // trade: closer stalls on any hiccup, further adds delay the operator
        // then has to dial into the graphics.
        liveSyncDurationCount: 3,
        // Cap the back buffer. This page is left open for a whole session, and
        // an uncapped back buffer on a three-hour match is how a browser tab
        // ends up holding a gigabyte.
        backBufferLength: 90,
        enableWorker: true,
      });
      hls.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean; type?: string }) => {
        if (!data?.fatal) return;
        // Fatal media errors are often recoverable in place; network errors
        // need the manifest re-read. Either way never surface a dead element —
        // the operator wants the picture back, not a diagnosis.
        if (data.type === "mediaError") {
          try {
            hls.recoverMediaError();
            return;
          } catch {
            /* fall through to a full restart */
          }
        }
        retry();
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      try {
        await video.play();
      } catch {
        /* the play() promise rejects harmlessly while the manifest loads */
      }
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("loadedmetadata", onPlaying);
    void start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("loadedmetadata", onPlaying);
      try {
        hls?.destroy();
      } catch {
        /* nothing left to do on teardown */
      }
    };
  }, [src, onGeometry]);

  return (
    <>
      <video
        ref={ref}
        muted
        autoPlay
        playsInline
        // contain, never cover: cropping a broadcast frame moves the graphics
        // off the picture they are registered to.
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "#000000",
        }}
      />
      {state !== "playing" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: AVC.navy,
            color: AVC.white,
            font: "500 18px/1.4 system-ui, sans-serif",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {state === "failed" ? "no signal" : "connecting…"}
        </div>
      ) : null}
    </>
  );
}
