"use client";

/**
 * The output surface (spec/47): footage, graphics on top, and an operator panel
 * that is not on top of anything.
 *
 * Three things it is careful about, all of them because this page goes to air:
 *
 *  1. **The overlay is registered to the PICTURE, not to the window.** The video
 *     is letterboxed with object-fit: contain, so on any window that is not
 *     exactly 16:9 the picture is inset — and a score bug positioned against the
 *     window would sit in the black bar. The stage is sized from the video's own
 *     ratio and the graphics live inside it.
 *  2. **The operator panel appears only for a pointer.** On a 16:9 window there
 *     is no room beside the picture, so the panel does overlay it — and what
 *     keeps it off air is that it is shown by mouse movement and hidden again
 *     when the pointer leaves. A vision mixer's browser source has no pointer,
 *     so it never draws at all. An operator driving the page in a browser
 *     window is looking at a monitor, not at the programme feed.
 *  3. **The graphics run on the DELAYED board.** See useDelayedBoard: the
 *     director's decisions are all made against the frame the viewer is looking
 *     at, not the frame the hall is in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VisBoardData } from "@/lib/vis-live/board-data";
import { useDelayedBoard } from "@/lib/tv/useDelayedBoard";
import { DELAY_STEP_S, clampDelay } from "@/lib/tv/delay";
import { delayStorageKey } from "@/lib/tv/stream-url";
import {
  CHALLENGE_CATEGORIES,
  NO_OPERATOR,
  demoGraphics,
  direct,
  seedDirector,
  type ChallengeCategory,
  type DemoGraphic,
  type DirectorMemory,
  type Graphics,
  type OperatorState,
} from "@/lib/tv/director";
import { handOf, sideState } from "@/lib/tv/derive";
import { StreamPlayer, type PlayerState } from "@/components/tv/StreamPlayer";
import { ScoreBug } from "@/components/tv/ScoreBug";
import {
  ChallengeAlert,
  ChallengeCard,
  KeyMomentStrap,
  SubstitutionBlock,
  TimeoutTab,
} from "@/components/tv/BugExtensions";
import { OperatorPanel } from "@/components/tv/OperatorPanel";

/** 16:9 until the stream says otherwise. Every AVC feed is 16:9. */
const DEFAULT_RATIO = 16 / 9;

export function TvViewer({
  boardId,
  initialBoard,
  streamUrl,
  streamNote,
  initialDelay,
  sourceParam,
  startHidden,
  demo,
}: {
  boardId: string;
  initialBoard: VisBoardData;
  streamUrl: string | null;
  /** Why there is no picture, when the link could not be resolved. */
  streamNote: string | null;
  initialDelay: number;
  sourceParam: "vis" | "vs" | null;
  startHidden: boolean;
  /** A graphic forced on for rehearsal (`?demo=sub`). */
  demo: DemoGraphic | null;
}) {
  const [delay, setDelay] = useState(initialDelay);
  const [operator, setOperator] = useState<OperatorState>({
    ...NO_OPERATOR,
    hideAll: startHidden,
  });
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [playerState, setPlayerState] = useState<PlayerState>("loading");
  const [panelOpen, setPanelOpen] = useState(false);

  const { board, live, staleFor, buffered } = useDelayedBoard(
    boardId,
    initialBoard,
    delay,
    sourceParam,
  );

  // Remember the delay per stream HOST, not per match: it is a property of the
  // encoder and the path to it, and it is the same for every match of an event.
  //
  // Written here, read in the launcher. The output page deliberately does not
  // restore it: the URL is the authority on air — an operator who sends a
  // colleague a link with ?delay= in it means that number — and reading storage
  // on mount to overwrite state would be a cascading render for no gain.
  const delayKey = useMemo(() => {
    try {
      return streamUrl ? delayStorageKey(new URL(streamUrl).host) : null;
    } catch {
      return null;
    }
  }, [streamUrl]);
  useEffect(() => {
    if (!delayKey) return;
    try {
      window.localStorage.setItem(delayKey, String(delay));
    } catch {
      /* private window, or storage blocked: nothing to do */
    }
  }, [delayKey, delay]);

  // ── the director ───────────────────────────────────────────────────────────
  // Memory in a ref, not in state: it is advanced from an effect on every frame
  // and the graphics it yields are what render. Putting it in state would make
  // each frame two renders.
  const memoryRef = useRef<DirectorMemory>(seedDirector(initialBoard));
  const [graphics, setGraphics] = useState<Graphics>(() => ({
    bug: !startHidden,
    keyMoment: null,
    timeout: null,
    substitution: null,
    challenge: null,
  }));

  useEffect(() => {
    // Re-run on a clock as well as on every board change: substitution and
    // time-out windows expire on time, not on the next poll.
    const step = () => {
      const { memory, graphics: g } = direct(
        memoryRef.current,
        board,
        operator,
        Date.now(),
      );
      memoryRef.current = memory;
      // The director still runs under a demo, so nothing is missed on the way
      // back out of it; only what is DRAWN is replaced.
      const shown = demo ? demoGraphics(demo, board, operator.category) : g;
      setGraphics((prev) => (sameGraphics(prev, shown) ? prev : shown));
    };
    step();
    const id = setInterval(step, 250);
    return () => clearInterval(id);
  }, [board, operator, demo]);

  // ── hotkeys ────────────────────────────────────────────────────────────────
  const nudgeDelay = useCallback((by: number) => {
    setDelay((d) => clampDelay(Math.round((d + by) / DELAY_STEP_S) * DELAY_STEP_S));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never swallow a key the operator is typing into the panel.
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const k = e.key;
      if (k === "[") return nudgeDelay(-DELAY_STEP_S);
      if (k === "]") return nudgeDelay(DELAY_STEP_S);
      if (k === "h" || k === "H") {
        return setOperator((o) => ({ ...o, hideAll: !o.hideAll }));
      }
      if (k === "f" || k === "F") {
        void document.documentElement.requestFullscreen?.().catch(() => {});
        return;
      }
      if (k === "Escape") {
        return setOperator((o) => ({
          ...o,
          manualChallenge: null,
          manualTimeout: null,
          category: null,
        }));
      }
      if (k === "c" || k === "C") {
        // Arm a challenge for whichever side the feed last named, else the left.
        const side = live.challenge?.side ?? handOf(board).left;
        return setOperator((o) => ({
          ...o,
          manualChallenge: { side, status: "REQUESTED" },
        }));
      }
      if (k === "a" || k === "A" || k === "b" || k === "B") {
        const side = k.toLowerCase() === "a" ? "A" : "B";
        return setOperator((o) =>
          o.manualChallenge
            ? { ...o, manualChallenge: { ...o.manualChallenge, side } }
            : o,
        );
      }
      if (k === "r" || k === "R") {
        return setOperator((o) =>
          o.manualChallenge
            ? { ...o, manualChallenge: { ...o.manualChallenge, status: "REVIEW" } }
            : o,
        );
      }
      if (k === "s" || k === "S" || k === "u" || k === "U") {
        const status = k.toLowerCase() === "s" ? "SUCCESSFUL" : "UNSUCCESSFUL";
        return setOperator((o) =>
          o.manualChallenge
            ? { ...o, manualChallenge: { ...o.manualChallenge, status } }
            : o,
        );
      }
      if (k === "t" || k === "T") {
        const side = handOf(board).left;
        return setOperator((o) => ({
          ...o,
          manualTimeout: { side, at: Date.now() },
        }));
      }
      if (/^[1-6]$/.test(k)) {
        const cat = CHALLENGE_CATEGORIES[Number(k) - 1] as ChallengeCategory;
        return setOperator((o) => ({ ...o, category: cat }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, live, nudgeDelay]);

  // ── the stage ──────────────────────────────────────────────────────────────
  const hand = handOf(board);
  const leftSide = sideState(board, hand.left);
  const rightSide = sideState(board, hand.right);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}
      onMouseMove={() => setPanelOpen(true)}
      onMouseLeave={() => setPanelOpen(false)}
    >
      {/* The stage: the picture's own rectangle, centred and letterboxed exactly
          as the video element letterboxes itself. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          margin: "auto",
          width: `min(100vw, ${(ratio * 100).toFixed(4)}vh)`,
          height: `min(100vh, ${(100 / ratio).toFixed(4)}vw)`,
        }}
      >
        {streamUrl ? (
          <StreamPlayer
            src={streamUrl}
            onState={setPlayerState}
            onGeometry={setRatio}
          />
        ) : (
          <div style={S.noStream}>
            {streamNote ?? "No stream — open /tv to add one."}
          </div>
        )}

        <ScoreBug
          left={{ ...leftSide, serving: leftSide.serving }}
          right={{ ...rightSide, serving: rightSide.serving }}
          hidden={!graphics.bug}
        />

        {/* The extensions ride in their own SVG over the bug's, so a graphic
            coming and going never re-rasterises the bar's artwork. */}
        <svg
          viewBox="0 0 1920 1080"
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          aria-hidden
        >
          {graphics.keyMoment ? (
            <KeyMomentStrap
              hand={graphics.keyMoment.hand}
              text={graphics.keyMoment.text}
            />
          ) : null}
          {graphics.timeout ? (
            <TimeoutTab
              hand={graphics.timeout.hand}
              taken={
                (graphics.timeout.hand === "left" ? leftSide : rightSide).timeoutsTaken
              }
            />
          ) : null}
          {graphics.substitution ? (
            <SubstitutionBlock
              hand={graphics.substitution.hand}
              sub={graphics.substitution.sub}
            />
          ) : null}
          {graphics.challenge ? (
            graphics.challenge.status === "REQUESTED" ? (
              <ChallengeAlert hand={graphics.challenge.hand} />
            ) : (
              <ChallengeCard
                hand={graphics.challenge.hand}
                status={graphics.challenge.status}
                teamName={graphics.challenge.teamName}
                category={graphics.challenge.category}
              />
            )
          ) : null}
        </svg>
      </div>

      <OperatorPanel
        open={panelOpen}
        delay={delay}
        onDelay={setDelay}
        operator={operator}
        onOperator={setOperator}
        graphics={graphics}
        board={board}
        live={live}
        staleFor={staleFor}
        buffered={buffered}
        playerState={playerState}
        boardId={boardId}
      />
    </div>
  );
}

/** Cheap structural comparison, to keep a 4 Hz tick from re-rendering the SVG. */
function sameGraphics(a: Graphics, b: Graphics): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const S: Record<string, React.CSSProperties> = {
  noStream: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: "0 10%",
    textAlign: "center",
    background: "#000B35",
    color: "#fff",
    font: "500 17px/1.5 system-ui, sans-serif",
  },
};
