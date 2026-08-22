/**
 * The TV overlay's motion (spec/48).
 *
 * The animations themselves are three lines of WAAPI each and a browser is the
 * only thing that can judge them — which is exactly why the DECISIONS are pure
 * functions and are all tested here. Every bug this feature can have is in
 * deciding whether to run an animation and which way it points: a ball that
 * flies at a set start, an odometer that stacks three digits on a slow poll, a
 * decrement that still rolls downward, a graphic that unmounts before it can
 * leave. None of those are visible in a screenshot of the finished state.
 *
 * The constants are asserted too, and that is not a mirror test: they were
 * reviewed live and approved by the owner on 2026-08-21 (spec/48 §1), including
 * a rejected variant, so the numbers are a contract with a person rather than an
 * implementation detail.
 */

import { describe, expect, it } from "vitest";
import {
  MOTION,
  NO_ROLL,
  ballFlightFrames,
  contentInFrames,
  driftFor,
  mirrorDepartureX,
  noPresence,
  noSwap,
  presenceReduce,
  resumeFrom,
  resumeInFrames,
  revealFor,
  rollInFrames,
  rollOutFrames,
  rollReduce,
  serveFlip,
  slideInFrames,
  slideOutFrames,
  swapCommit,
  swapReduce,
  type PanelId,
  type RollState,
} from "@/lib/tv/motion";
import { ART, AXIS } from "@/lib/tv/bug-geometry";

// ── M1 · is this a side-out? ─────────────────────────────────────────────────

describe("serve flip detection", () => {
  const frame = (side: "A" | "B" | null, set: number | null = 1) => ({ side, set });

  it("fires on a genuine A↔B flip, both ways", () => {
    expect(serveFlip(frame("A"), frame("B"))).toEqual({ from: "A", to: "B" });
    expect(serveFlip(frame("B"), frame("A"))).toEqual({ from: "B", to: "A" });
  });

  it("does not fire on mount", () => {
    // There is no previous frame, so there is nothing to fly FROM.
    expect(serveFlip(null, frame("A"))).toBeNull();
  });

  it("does not fire when the serve has not changed", () => {
    // The common case: this runs four times a second.
    expect(serveFlip(frame("A"), frame("A"))).toBeNull();
  });

  it("does not fire into or out of a serve-less frame", () => {
    // Between sets and before the first whistle the bug draws NO ball, so a
    // flight would depart from an empty slot or land in one.
    expect(serveFlip(frame("A"), frame(null))).toBeNull();
    expect(serveFlip(frame(null), frame("B"))).toBeNull();
  });

  it("does not fire at a set start", () => {
    // The ball changes hands, but that is a new serve rather than a side-out —
    // and the previous set's ball left the screen at the interval. Guarded on
    // the set number as well as on the null gap, because a poll can straddle a
    // set boundary and never report the gap.
    expect(serveFlip(frame("A", 1), frame("B", 2))).toBeNull();
    // Same side, new set: also nothing.
    expect(serveFlip(frame("A", 1), frame("A", 2))).toBeNull();
  });
});

describe("the flight's departure point", () => {
  it("is the destination mirrored about the bug's axis", () => {
    // Which is the same thing as the OTHER slot, exactly — the two ball slots
    // mirror about x 960 by construction (bug-geometry ART.ball).
    expect(mirrorDepartureX(ART.ball.lx, ART.ball.w)).toBeCloseTo(ART.ball.rx, 10);
    expect(mirrorDepartureX(ART.ball.rx, ART.ball.w)).toBeCloseTo(ART.ball.lx, 10);
  });

  it("is derived, never measured", () => {
    // A rect read off the live element can be captured MID-FLIGHT, and a quick
    // second side-out then flies same-side → vertex → same-side instead of
    // crossing (beach commit 0f72e61). Nothing here reads the DOM at all.
    expect(mirrorDepartureX(100, 20, 1000)).toBe(1880);
  });
});

describe("the V-flight keyframes", () => {
  it("has a SINGLE vertex — three keyframes, no dwell", () => {
    // A contact-dwell variant (extra keyframes holding the ball at the vertex)
    // was demoed to the owner and REJECTED: it broke the flight. This is the
    // test that stops it coming back.
    expect(ballFlightFrames(ART.ball.lx)).toHaveLength(3);
  });

  it("dives from the far slot, dips below the resting line, and lands home", () => {
    const [dive, vertex, land] = ballFlightFrames(ART.ball.lx) as Array<
      Record<string, unknown>
    >;
    // Leg one starts a full crossing away, level with the resting line.
    expect(dive.transform).toBe(
      `translate(${ART.ball.rx - ART.ball.lx}px, 0) rotate(0deg)`,
    );
    // The vertex sits on the axis, 58 px DOWN, squashed, half a spin in.
    expect(vertex.offset).toBe(0.5);
    expect(vertex.transform).toBe(
      `translate(${AXIS - ART.ball.w / 2 - ART.ball.lx}px, 58px) rotate(180deg) scale(1.15,0.85)`,
    );
    // And it comes to rest exactly where the static ball is drawn, one whole
    // spin later — so the graphic after the flight is the graphic before it.
    expect(land.transform).toBe("translate(0,0) rotate(360deg)");
    expect(land.offset).toBeUndefined();
  });
});

// ── M2 · the odometer ────────────────────────────────────────────────────────

describe("the score odometer", () => {
  it("does not roll on mount", () => {
    const s = rollReduce(NO_ROLL, 17);
    expect(s.value).toBe(17);
    expect(s.outgoing).toBeNull();
  });

  it("rolls in from above on a point", () => {
    const s = rollReduce({ value: 17, outgoing: null, dir: 1 }, 18);
    expect(s).toEqual({ value: 18, outgoing: 17, dir: 1 });
  });

  it("rolls BACK from below on a decrement", () => {
    // Real, and twice over: an undo, and a challenge overturned the other way.
    const s = rollReduce({ value: 18, outgoing: null, dir: 1 }, 17);
    expect(s).toEqual({ value: 17, outgoing: 18, dir: -1 });
  });

  it("turns a multi-point jump into ONE roll to the final value", () => {
    // A slow poll really does deliver 12 → 15 in a single frame. Three digits
    // sliding past each other would read as a broken graphic.
    const s = rollReduce({ value: 12, outgoing: null, dir: 1 }, 15);
    expect(s).toEqual({ value: 15, outgoing: 12, dir: 1 });
  });

  it("re-arms rather than stacking: a leftover outgoing digit is discarded", () => {
    // Two points inside one roll's 650 ms. The digit still leaving is dropped
    // and the CURRENT value becomes the one that leaves, so there is never more
    // than one outgoing node in the cell.
    let s: RollState = { value: 12, outgoing: null, dir: 1 };
    s = rollReduce(s, 13);
    expect(s.outgoing).toBe(12);
    s = rollReduce(s, 14);
    expect(s).toEqual({ value: 14, outgoing: 13, dir: 1 });
  });

  it("clears the outgoing digit when the value settles", () => {
    const s = rollReduce({ value: 14, outgoing: 13, dir: 1 }, 14);
    expect(s).toEqual({ value: 14, outgoing: null, dir: 1 });
  });

  it("sends the two digits in opposite directions", () => {
    // The incoming digit comes from the side the outgoing one is heading for,
    // which is what makes it read as one wheel turning.
    expect(rollOutFrames(1)[1].transform).toBe("translateY(115%)");
    expect(rollInFrames(1)[0].transform).toBe("translateY(-115%)");
    expect(rollOutFrames(-1)[1].transform).toBe("translateY(-115%)");
    expect(rollInFrames(-1)[0].transform).toBe("translateY(115%)");
  });
});

// ── M3/M4/M5 · the panels ────────────────────────────────────────────────────

describe("a docked panel's slide", () => {
  it("starts fully under the bar, on the bug's side of the dock", () => {
    // 410 px is the panel's own width, so "hidden" really is hidden rather than
    // peeking out from behind the flag.
    expect(slideInFrames({ x: 410 })[0].transform).toBe("translate(410px, 0px)");
    expect(slideInFrames({ x: -410 })[0].transform).toBe("translate(-410px, 0px)");
    expect(slideInFrames({ x: 410 })[1].transform).toBe("translate(0px, 0px)");
  });

  it("leaves exactly the way it came", () => {
    // Not "toward the nearest edge", not a fade: back under the bar it came from.
    const [a, b] = slideOutFrames({ y: 36 });
    expect(a.transform).toBe("translate(0px, 0px)");
    expect(b.transform).toBe("translate(0px, 36px)");
  });

  it("fades only where there is no edge to hide behind", () => {
    // The challenge card is centred, not docked, so it has nothing to emerge
    // from — it is the one graphic that fades (spec/48 M5).
    expect(slideInFrames({ y: 40 }, true)[0].opacity).toBe(0);
    expect(slideInFrames({ x: 410 })[0].opacity).toBeUndefined();
  });

  it("drifts its content in from the bug's direction", () => {
    // The content follows the plate, so it comes from the same side.
    expect(driftFor({ x: 410 })).toEqual({ x: 26 });
    expect(driftFor({ x: -410 })).toEqual({ x: -26 });
    expect(driftFor({ y: 36 })).toEqual({ y: 26 });
    const [from, to] = contentInFrames({ x: 26 });
    expect(from).toEqual({ transform: "translate(26px, 0px)", opacity: 0 });
    expect(to).toEqual({ transform: "translate(0px, 0px)", opacity: 1 });
  });
});

// ── G2 · presence ────────────────────────────────────────────────────────────

describe("presence", () => {
  const EXIT = 480;

  it("shows an arriving graphic at once", () => {
    expect(presenceReduce(noPresence<string>(), "sub", EXIT)).toEqual({
      value: "sub",
      leaving: false,
    });
  });

  it("keeps a dropped graphic mounted, marked as leaving", () => {
    // Which is the whole point: the director drops a graphic the instant its
    // window closes, and an element that is already gone cannot animate out.
    const up = presenceReduce(noPresence<string>(), "sub", EXIT);
    const going = presenceReduce(up, null, EXIT);
    expect(going).toEqual({ value: "sub", leaving: true });
    // It stays put for as many frames as it takes — the hook's one timer, not
    // the reducer, decides when that is.
    expect(presenceReduce(going, null, EXIT)).toBe(going);
  });

  it("brings a graphic back that is replaced mid-exit", () => {
    // A substitution following a substitution: it has to come back rather than
    // finish leaving, and the wrapper reads leaving true → false as "enter".
    const going = presenceReduce(
      presenceReduce(noPresence<string>(), "sub 1", EXIT),
      null,
      EXIT,
    );
    expect(presenceReduce(going, "sub 2", EXIT)).toEqual({
      value: "sub 2",
      leaving: false,
    });
  });

  it("unmounts immediately when there is no exit to wait for", () => {
    // Which is what reduced motion passes: the state jumps, layout identical.
    const up = presenceReduce(noPresence<string>(), "sub", 0);
    expect(presenceReduce(up, null, 0)).toEqual(noPresence());
  });

  it("is identity-stable while nothing changes", () => {
    // It runs off a 4 Hz tick; a fresh object every tick would re-render the
    // whole overlay for nothing.
    const up = presenceReduce(noPresence<string>(), "sub", EXIT);
    expect(presenceReduce(up, "sub", EXIT)).toBe(up);
    const empty = noPresence<string>();
    expect(presenceReduce(empty, null, EXIT)).toBe(empty);
  });
});

// ── F1 · a second graphic on a plate that is already out ─────────────────────

/**
 * Paired substitutions (spec/48.1 F1).
 *
 * The director treats a pair as one supported case: it clears the expired
 * substitution and announces the next in the SAME tick, so the graphic never
 * goes null, presence never sees a leave, and the second pair's shirts and
 * names used to CUT onto the plate the first was still on. The decision of what
 * that should do instead — swap the content, run a whole reveal, or leave it to
 * the other hand's group — is all here, because it is the only part of it a
 * browser is not required to judge.
 */
describe("a plate that changes what it carries", () => {
  const OUT = MOTION.content.exit.duration;
  /** A substitution as the swap sees it: which side, and who it names. */
  const sub = (key: string, hand: PanelId["hand"] = "left"): PanelId => ({ hand, key });
  const id = (v: PanelId) => v;

  describe("the decision", () => {
    it("is a full reveal when there is nothing on air", () => {
      expect(revealFor(null, sub("A:12:6→9"))).toBe("reveal");
    });

    it("is a full reveal when nothing has changed", () => {
      // It runs off a 4 Hz tick: the overwhelmingly common answer is "the
      // reveal already on screen".
      expect(revealFor(sub("A:12:6→9"), sub("A:12:6→9"))).toBe("reveal");
    });

    it("is a content swap for a second substitution on the SAME hand", () => {
      expect(revealFor(sub("A:12:6→9"), sub("A:12:4→11"))).toBe("swap");
    });

    it("is a hand switch when the next one docks to the other side", () => {
      // Two MotionGroups, so one unmounts and the other does its own reveal —
      // the path that was already right, and this names it rather than
      // disturbing it.
      expect(revealFor(sub("A:12:6→9", "left"), sub("B:12:2→7", "right"))).toBe(
        "switch",
      );
    });
  });

  it("shows the first substitution at once, with nothing to hand over", () => {
    expect(swapReduce(noSwap<PanelId>(), sub("one"), id, OUT)).toEqual({
      value: sub("one"),
      queued: null,
      phase: null,
    });
  });

  it("is identity-stable while the same substitution is up", () => {
    const up = swapReduce(noSwap<PanelId>(), sub("one"), id, OUT);
    expect(swapReduce(up, sub("one"), id, OUT)).toBe(up);
  });

  it("keeps the OLD content on the plate while it fades, then hands over", () => {
    // The plate is untouched throughout: `value` — which is what presence and
    // the MotionGroup render — stays the first substitution for the whole fade,
    // and only then becomes the second.
    const up = swapReduce(noSwap<PanelId>(), sub("one"), id, OUT);
    const fading = swapReduce(up, sub("two"), id, OUT);
    expect(fading).toEqual({ value: sub("one"), queued: sub("two"), phase: "out" });
    // And it stays there for as many frames as the fade takes; the hook's one
    // timer decides when that is.
    expect(swapReduce(fading, sub("two"), id, OUT)).toBe(fading);
    expect(swapCommit(fading)).toEqual({
      value: sub("two"),
      queued: null,
      phase: "in",
    });
  });

  it("takes the newest of two arrivals during one fade", () => {
    // The plate shows what is current, not a backlog: a third substitution
    // replaces the queue rather than joining it.
    const up = swapReduce(noSwap<PanelId>(), sub("one"), id, OUT);
    const fading = swapReduce(up, sub("two"), id, OUT);
    const jumped = swapReduce(fading, sub("three"), id, OUT);
    expect(jumped).toEqual({ value: sub("one"), queued: sub("three"), phase: "out" });
    expect(swapCommit(jumped).value).toEqual(sub("three"));
  });

  it("does not fade anything when the next one docks to the other hand", () => {
    const up = swapReduce(noSwap<PanelId>(), sub("one", "left"), id, OUT);
    expect(swapReduce(up, sub("two", "right"), id, OUT)).toEqual({
      value: sub("two", "right"),
      queued: null,
      phase: null,
    });
  });

  it("jumps straight to the new content under reduced motion", () => {
    // The house fallback everywhere in this package: the state jumps and the
    // layout is identical, which a zero-length fade expresses exactly.
    const up = swapReduce(noSwap<PanelId>(), sub("one"), id, 0);
    expect(swapReduce(up, sub("two"), id, 0)).toEqual({
      value: sub("two"),
      queued: null,
      phase: null,
    });
  });

  it("drops the queue when the director drops the graphic mid-fade", () => {
    // Presence owns the exit from there — the plate slides back under the bar
    // carrying whatever was on it, and the substitution that was about to
    // arrive never does.
    const fading = swapReduce(
      swapReduce(noSwap<PanelId>(), sub("one"), id, OUT),
      sub("two"),
      id,
      OUT,
    );
    expect(swapReduce(fading, null, id, OUT)).toEqual(noSwap());
    // Identity-stable once there is nothing left to hold.
    const empty = noSwap<PanelId>();
    expect(swapReduce(empty, null, id, OUT)).toBe(empty);
  });
});

// ── F2 · coming back mid-exit ────────────────────────────────────────────────

describe("a panel that is brought back while it is leaving", () => {
  it("resumes from where the plate actually is", () => {
    // 40% of the way back under the bar: the exit is 410 px and the group is
    // sitting at 164. Entering from `hidden` here is a snap BACKWARDS through
    // the remaining 246 px — the eye follows a plate, so it is the one thing
    // this must not do (spec/48.1 F2).
    const at40 = { transform: "matrix(1, 0, 0, 1, 164, 0)", opacity: "1" };
    const resume = resumeFrom(at40);
    expect(resume).toEqual({ transform: "matrix(1, 0, 0, 1, 164, 0)" });
    const [from, to] = resumeInFrames(resume!);
    expect(from.transform).toBe("matrix(1, 0, 0, 1, 164, 0)");
    expect(from.transform).not.toBe(slideInFrames({ x: 410 })[0].transform);
    expect(to.transform).toBe("translate(0px, 0px)");
  });

  it("brings the card's opacity back from where it is too", () => {
    // The challenge card is the one graphic that fades as it moves, so resuming
    // its transform alone would still flash it back to invisible.
    const at40 = { transform: "matrix(1, 0, 0, 1, 0, 16)", opacity: "0.6" };
    expect(resumeFrom(at40, true)).toEqual({
      transform: "matrix(1, 0, 0, 1, 0, 16)",
      opacity: 0.6,
    });
    expect(resumeInFrames(resumeFrom(at40, true)!, true)[1]).toEqual({
      transform: "translate(0px, 0px)",
      opacity: 1,
    });
  });

  it("has nothing to resume from at rest, which is a first mount", () => {
    // A panel mounting for the first time is at rest, and that one takes the
    // normal entrance from hidden.
    expect(resumeFrom({ transform: "none", opacity: "1" })).toBeNull();
    expect(resumeFrom(null)).toBeNull();
  });

  it("ignores the opacity of a panel that does not fade", () => {
    // A docked panel emerges from an edge; its opacity is not ours to restore.
    expect(resumeFrom({ transform: "none", opacity: "0.4" })).toBeNull();
    expect(resumeFrom({ transform: "matrix(1, 0, 0, 1, 164, 0)", opacity: "0.4" })).toEqual(
      { transform: "matrix(1, 0, 0, 1, 164, 0)" },
    );
  });
});

// ── the approved constants ───────────────────────────────────────────────────

describe("the motion contract", () => {
  it("holds the durations the owner approved", () => {
    // spec/48 §1, reviewed live 2026-08-21. Anything that changes these needs a
    // new review, not a passing tidy-up.
    expect(MOTION.ball.duration).toBe(850);
    expect(MOTION.ball.dip).toBe(58);
    expect(MOTION.roll.duration).toBe(650);
    expect(MOTION.roll.travel).toBe(115);
    expect(MOTION.slide.hidden).toBe(410);
    expect(MOTION.slide.enter.duration).toBe(650);
    expect(MOTION.slide.exit.duration).toBe(480);
    expect(MOTION.content.delay).toBe(160);
    expect(MOTION.content.drift).toBe(26);
    expect(MOTION.content.enter.duration).toBe(420);
    expect(MOTION.content.exit.duration).toBe(260);
    expect(MOTION.tab.hidden).toBe(36);
    expect(MOTION.tab.enter.duration).toBe(450);
    expect(MOTION.tab.exit.duration).toBe(360);
    expect(MOTION.tab.strike).toBe(260);
    expect(MOTION.card.hidden).toBe(40);
    expect(MOTION.card.enter.duration).toBe(320);
    expect(MOTION.card.exit.duration).toBe(320);
    expect(MOTION.card.verdict).toBe(350);
    expect(MOTION.bugFade).toBe(180);
  });

  it("leaves faster than it arrives, everywhere", () => {
    // The house philosophy for this package: deliberate, not rushed, and an exit
    // never dawdles in front of live footage.
    for (const [name, pair] of [
      ["slide", MOTION.slide],
      ["tab", MOTION.tab],
    ] as const) {
      expect(pair.exit.duration, name).toBeLessThan(pair.enter.duration);
    }
    // The card is the one exception, and deliberately: it hands off with the
    // bug's own 180 ms fade rather than racing it.
    expect(MOTION.card.exit.duration).toBe(MOTION.card.enter.duration);
  });
});
