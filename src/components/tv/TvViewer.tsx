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
 *
 * MOTION (spec/48) is all here rather than in the graphics: the bug and the
 * extensions stay pure server-renderable components, and every animation is a
 * client overlay in this stage. Three stacked SVG layers, why they are stacked
 * the way they are, and the presence wrappers that let a dropped graphic leave
 * are documented at the stage below.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VisBoardData } from "@/lib/vis-live/board-data";
import { useDelayedBoard } from "@/lib/tv/useDelayedBoard";
import { DELAY_STEP_S, clampDelay } from "@/lib/tv/delay";
import { delayStorageKey } from "@/lib/tv/stream-url";
import {
  CHALLENGE_CATEGORIES,
  DEMO_BEAT_MS,
  NO_OPERATOR,
  demoBoard,
  demoGraphics,
  direct,
  seedDirector,
  type ChallengeCategory,
  type DemoGraphic,
  type DirectorMemory,
  type Graphics,
  type OperatorState,
} from "@/lib/tv/director";
import { handOf, sideState, type Hand } from "@/lib/tv/derive";
import { MOTION } from "@/lib/tv/motion";
import { usePresence } from "@/lib/tv/usePresence";
import { useHydrated } from "@/lib/tv/useHydrated";
import {
  ChallengeCardStack,
  MotionGroup,
  RollingCell,
  ServeBallFlight,
} from "@/components/tv/BugMotion";
import { StreamPlayer, type PlayerState } from "@/components/tv/StreamPlayer";
import { ScoreBug } from "@/components/tv/ScoreBug";
import {
  ChallengeAlert,
  KeyMomentStrap,
  SubstitutionBlock,
  TimeoutTab,
} from "@/components/tv/BugExtensions";
import { OperatorPanel } from "@/components/tv/OperatorPanel";

/** 16:9 until the stream says otherwise. Every AVC feed is 16:9. */
const DEFAULT_RATIO = 16 / 9;

/**
 * Where a docked panel hides: fully under the flag and the plate, on the bug's
 * side of its own docking edge. The sign is the only thing that mirrors.
 */
function slideHidden(hand: Hand) {
  return { x: hand === "left" ? MOTION.slide.hidden : -MOTION.slide.hidden };
}

export function TvViewer({
  boardId,
  initialBoard,
  streamUrl,
  streamNote,
  initialDelay,
  sourceParam,
  startHidden,
  demo,
  schema,
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
  /** Non-production schema name, for the operator panel's warning. */
  schema: string | null;
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

  // The rehearsal beat, and the only reason this component has a counter in it:
  // `?demo=sideout` and `?demo=point` drive the SCORE and the SERVING SIDE
  // rather than a graphic, so they need something to move (spec/48 G4). It only
  // advances under a demo, and only when the beat itself turns over — React
  // bails out of the three identical sets in between.
  const [beat, setBeat] = useState(0);

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
      if (demo) setBeat(Math.floor(Date.now() / DEMO_BEAT_MS));
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
  // Under a motion rehearsal the BUG runs off a driven board — the score rolls,
  // the serve flips — while the director, the operator panel and everything else
  // still run off the real one. Identity-stable when there is no demo, so the
  // memo is free.
  const stage = useMemo(
    () => (demo ? demoBoard(demo, board, beat) : board),
    [demo, board, beat],
  );
  const hand = handOf(stage);
  const leftSide = sideState(stage, hand.left);
  const rightSide = sideState(stage, hand.right);

  // The challenge arrives as one graphic and leaves as two: the small alert tab
  // rides ON the bug, the decided card REPLACES it, and they enter and leave
  // independently — REQUESTED → REVIEW drops the tab and raises the card at the
  // same moment, which is the hand-off the design describes (spec/48 M5).
  const alertIn =
    graphics.challenge?.status === "REQUESTED" ? graphics.challenge : null;
  const cardIn =
    graphics.challenge && graphics.challenge.status !== "REQUESTED"
      ? graphics.challenge
      : null;

  // Presence (spec/48 G2): the director drops a graphic the instant its window
  // closes, so without this there is never an element on screen to animate out
  // of. Each slot keeps the last value mounted for exactly its own exit.
  // The hand-off to the motion layer. False on the server and in the hydrating
  // render, so the FIRST PAINTED FRAME is byte-for-byte what spec/47 shipped —
  // which is what e2e and both browser gates measure (spec/48 §0.2-0.3). It
  // flips once, and the bug's own digits and ball go dark in the same commit as
  // the animated ones appear, so there is never a frame with two of either.
  const motion = useHydrated();

  const keyMomentP = usePresence(graphics.keyMoment, MOTION.slide.exit.duration);
  const timeoutP = usePresence(graphics.timeout, MOTION.tab.exit.duration);
  const subP = usePresence(graphics.substitution, MOTION.slide.exit.duration);
  const alertP = usePresence(alertIn, MOTION.tab.exit.duration);
  const cardP = usePresence(cardIn, MOTION.card.exit.duration);

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

        {/* THREE STACKED SVG LAYERS, and the order is the whole of spec/48 G1.
            Each stays its own SVG so a graphic coming and going never
            re-rasterises the bar's artwork (spec/47), and the paint order is set
            with z-index rather than by reordering the siblings:

              1  extensions — UNDER the bar, so a docked panel slides out from
                 beneath it instead of appearing on top of it;
              2  the bug itself (the z-index lives in ScoreBug's own style);
              3  motion — the serve ball's flight and the challenge card, the two
                 things that must draw OVER the bar.

            Why z-index and not the sibling swap spec/48 G1 describes: both of
            the browser gates find the bug with `querySelector("svg")` — the
            FIRST one — and so does e2e's first-frame assertion. Reordering the
            siblings makes them measure an empty extensions layer and report a
            vacuous PASS, and the gates may not be edited (spec/48 §0.2). The
            paint order is identical, the DOM and the server output are
            unchanged, and it is less code than the per-panel reveal clips the
            spec offers as the fallback. */}
        <ScoreBug
          left={{ ...leftSide, serving: leftSide.serving }}
          right={{ ...rightSide, serving: rightSide.serving }}
          hidden={!graphics.bug}
          scoreHidden={motion}
          ballHidden={motion}
        />

        <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={S.layerUnder} aria-hidden>
          {keyMomentP.value ? (
            <MotionGroup
              key={`km-${keyMomentP.value.hand}`}
              hidden={slideHidden(keyMomentP.value.hand)}
              enter={MOTION.slide.enter}
              exit={MOTION.slide.exit}
              leaving={keyMomentP.leaving}
              reveal={keyMomentP.value.hand}
            >
              <KeyMomentStrap
                hand={keyMomentP.value.hand}
                text={keyMomentP.value.text}
              />
            </MotionGroup>
          ) : null}
          {timeoutP.value ? (
            <MotionGroup
              key={`to-${timeoutP.value.hand}`}
              hidden={{ y: MOTION.tab.hidden }}
              enter={MOTION.tab.enter}
              exit={MOTION.tab.exit}
              leaving={timeoutP.leaving}
              tick={(timeoutP.value.hand === "left" ? leftSide : rightSide).timeoutsTaken}
            >
              <TimeoutTab
                hand={timeoutP.value.hand}
                taken={
                  (timeoutP.value.hand === "left" ? leftSide : rightSide).timeoutsTaken
                }
              />
            </MotionGroup>
          ) : null}
          {subP.value ? (
            <MotionGroup
              key={`sub-${subP.value.hand}`}
              hidden={slideHidden(subP.value.hand)}
              enter={MOTION.slide.enter}
              exit={MOTION.slide.exit}
              leaving={subP.leaving}
              reveal={subP.value.hand}
            >
              <SubstitutionBlock hand={subP.value.hand} sub={subP.value.sub} />
            </MotionGroup>
          ) : null}
          {alertP.value ? (
            <MotionGroup
              key={`alert-${alertP.value.hand}`}
              hidden={{ y: MOTION.tab.hidden }}
              enter={MOTION.tab.enter}
              exit={MOTION.tab.exit}
              leaving={alertP.leaving}
            >
              <ChallengeAlert hand={alertP.value.hand} />
            </MotionGroup>
          ) : null}
        </svg>

        <svg viewBox="0 0 1920 1080" width="100%" height="100%" style={S.layerOver} aria-hidden>
          {/* The bug's own moving parts. They follow the BUG's visibility, not
              the layer's, and with the bug's own 180 ms fade — they are pieces of
              it that happen to be drawn elsewhere, so a challenge card replacing
              the bug or an operator pressing H has to take the digits and the
              ball with it. Found in the browser: without this the score sat over
              the challenge card, which is exactly the sort of thing that only
              looks wrong once it is on air. */}
          {motion ? (
            <g
              style={{
                opacity: graphics.bug ? 1 : 0,
                transition: `opacity ${MOTION.bugFade}ms linear`,
              }}
            >
              <RollingCell side="left" value={leftSide.score} />
              <RollingCell side="right" value={rightSide.score} />
              <ServeBallFlight
                serving={stage.serving}
                set={stage.currentSet}
                hand={hand}
              />
            </g>
          ) : null}
          {cardP.value ? (
            <MotionGroup
              hidden={{ y: MOTION.card.hidden }}
              enter={MOTION.card.enter}
              exit={MOTION.card.exit}
              leaving={cardP.leaving}
              fade
            >
              <ChallengeCardStack card={cardP.value} />
            </MotionGroup>
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
        schema={schema}
      />
    </div>
  );
}

/** Cheap structural comparison, to keep a 4 Hz tick from re-rendering the SVG. */
function sameGraphics(a: Graphics, b: Graphics): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const S: Record<string, React.CSSProperties> = {
  /** The extensions layer: under the bar (the bug is z-index 2). */
  layerUnder: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 },
  /** The motion layer: over the bar. Under the operator panel, which is 10. */
  layerOver: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 },
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
