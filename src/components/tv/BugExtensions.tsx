"use client";

/**
 * The score bug's extensions (spec/47): substitutions, the video-challenge
 * states, time-out, and the key-moment strap.
 *
 * Drawn in the same 1920x1080 SVG space as the bug, and drawn rather than lifted
 * — the package ships no artwork for any of these, so every shape here comes off
 * the measurements in src/lib/tv/extension-geometry.ts. That is the opposite of
 * the rule the bug follows, and it is forced: there is nothing to extract.
 *
 * All four share one chassis. `Band` builds the notched, slanted, gradient-filled
 * panel that every one of them is made of; each graphic is then that band plus
 * type. Pure components, no hooks — the director decides what is on screen.
 */

import type { ReactNode } from "react";
import { AVC, FRAME, TV_FONT } from "@/lib/tv/bug-geometry";
import {
  BAND,
  CHALLENGE_CARD,
  CHALLENGE_TAB,
  DOCK,
  GRADIENT,
  KEY_MOMENT,
  LEAD_SLIVER,
  PANEL_OPACITY,
  PINSTRIPE,
  RULE,
  SUB,
  TIMEOUT_TAB,
  type Hand,
} from "@/lib/tv/extension-geometry";
import { fitFontSize, textWidth } from "@/lib/tv/text-fit";
import type { VisSubstitution } from "@/lib/vis-live/board-data";
import type { ChallengeCategory } from "@/lib/tv/director";
import type { VisChallengeStatus } from "@/lib/vis-live/board-data";
import type { KeyMoment } from "@/lib/tv/derive";

/** Frame x for an offset measured from the docking edge, away from the bug. */
function outward(hand: Hand, offset: number): number {
  return hand === "left" ? DOCK.left - offset : DOCK.right + offset;
}

/** Frame x for an offset measured from the docking edge, over the bug. */
function inward(hand: Hand, offset: number): number {
  return hand === "left" ? DOCK.left + offset : DOCK.right - offset;
}

/** The docking edge itself. */
function dockX(hand: Hand): number {
  return hand === "left" ? DOCK.left : DOCK.right;
}

/**
 * Left edge of a fixed-width box whose NEAR side sits `near` from the dock.
 * Boxes are measured by the edge closest to the bug so one number mirrors.
 */
function boxLeft(hand: Hand, near: number, w: number): number {
  return hand === "left" ? DOCK.left - near - w : DOCK.right + near;
}

/**
 * One panel: a band of the chassis, slanted on its outer edge, notched if that
 * band notches, filled with its gradient and optionally pinstriped.
 *
 * The slant leans the same way in frame terms on both hands — these are not
 * mirrored shapes but translated ones, which is why `hand` only chooses which
 * edge is vertical and which end the gradient starts from.
 */
function Band({
  id,
  band,
  from,
  to,
  fill,
  pinstriped = false,
  lead = false,
  children,
}: {
  id: string;
  band: typeof BAND.upper | typeof BAND.tab | typeof BAND.lower;
  /** The VERTICAL edge, in frame x. */
  from: number;
  /** The SLANTED edge at the band's top, in frame x. */
  to: number;
  fill: readonly { at: number; colour: string }[];
  pinstriped?: boolean;
  lead?: boolean;
  children?: ReactNode;
}) {
  const dock = from;
  const far = to;
  const top = band.y;
  const bottom = band.y + band.h;

  // The slanted edge, walked top to bottom, stepping back at the notch.
  const lean = (dy: number) => band.slope * dy;
  const pts: [number, number][] = [];
  pts.push([dock, top]);
  pts.push([far, top]);
  // Every slanted edge in this package leans the same way ON SCREEN — bottom
  // further right than top — so the lean is added in frame terms and does not
  // flip with the hand. These are translated shapes, not mirrored ones.
  if (band.notchY != null) {
    pts.push([far + lean(band.notchY), top + band.notchY]);
    pts.push([far + lean(band.notchY) - band.notchBack, top + band.notchY]);
    pts.push([far + lean(band.h) - band.notchBack, bottom]);
  } else {
    pts.push([far + lean(band.h), bottom]);
  }
  pts.push([dock, bottom]);
  const poly = pts.map(([x, y]) => `${x},${y}`).join(" ");

  // Gradient in frame coordinates: always left to right, whichever way the
  // element grows.
  const x1 = Math.min(dock, far);
  const x2 = Math.max(dock, far);

  return (
    <g opacity={PANEL_OPACITY}>
      <defs>
        <linearGradient
          id={`${id}-g`}
          gradientUnits="userSpaceOnUse"
          x1={x1}
          y1={0}
          x2={x2}
          y2={0}
        >
          {fill.map((s) => (
            <stop key={s.at} offset={s.at} stopColor={s.colour} />
          ))}
        </linearGradient>
        <clipPath id={`${id}-c`} clipPathUnits="userSpaceOnUse">
          <polygon points={poly} />
        </clipPath>
      </defs>
      <polygon points={poly} fill={`url(#${id}-g)`} />
      {pinstriped ? (
        <g clipPath={`url(#${id}-c)`}>
          {stripes(x1, x2, top, band.h).map((d, i) => (
            <path
              key={i}
              d={d}
              stroke={PINSTRIPE.colour}
              strokeWidth={PINSTRIPE.width}
              opacity={PINSTRIPE.opacity}
              fill="none"
            />
          ))}
        </g>
      ) : null}
      {lead ? (
        <g clipPath={`url(#${id}-c)`}>
          <polygon
            points={leadSliver(far, top, band)}
            fill={LEAD_SLIVER.fill}
          />
        </g>
      ) : null}
      {children}
    </g>
  );
}

function stripes(x1: number, x2: number, top: number, h: number): string[] {
  const out: string[] = [];
  // Start well left of the panel so the slant still covers its left edge.
  for (let x = x1 - h; x < x2 + h; x += PINSTRIPE.pitch) {
    out.push(`M ${x} ${top} L ${x + PINSTRIPE.slope * h} ${top + h}`);
  }
  return out;
}

function leadSliver(
  far: number,
  top: number,
  band: typeof BAND.lower | typeof BAND.upper | typeof BAND.tab,
): string {
  const w = LEAD_SLIVER.w;
  const b = band.h;
  const back = band.notchY != null ? band.notchBack : 0;
  return [
    [far, top],
    [far + w, top],
    [far + band.slope * b - back + w, top + b],
    [far + band.slope * b - back, top + b],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}

function Rule({ from, to }: { from: number; to: number }) {
  const dock = from;
  const far = to;
  return (
    <rect
      x={Math.min(dock, far)}
      y={RULE.y}
      width={Math.abs(far - dock)}
      height={RULE.h}
      fill={RULE.fill}
    />
  );
}

/** A jersey, with the player's number on it. */
function Shirt({
  x,
  top,
  w,
  h,
  number,
  size,
  baseline,
}: {
  x: number;
  top: number;
  w: number;
  h: number;
  number: string;
  size: number;
  baseline: number;
}) {
  // A t-shirt silhouette: shoulders, sleeves, a neck notch, straight body. The
  // reference clips it at the band's edge, which the band's own clip does here.
  const s = w / 56; // the measured upper-row shirt is the unit
  const cx = x + w / 2;
  const d = [
    `M ${x + 12 * s} ${top}`,
    `L ${x + 22 * s} ${top} Q ${cx} ${top + 7 * s} ${x + 34 * s} ${top}`,
    `L ${x + 44 * s} ${top}`,
    `L ${x + w} ${top + 14 * s}`,
    `L ${x + 46 * s} ${top + 20 * s}`,
    `L ${x + 46 * s} ${top + h}`,
    `L ${x + 10 * s} ${top + h}`,
    `L ${x + 10 * s} ${top + 20 * s}`,
    `L ${x} ${top + 14 * s}`,
    "Z",
  ].join(" ");
  return (
    <>
      <path d={d} fill={AVC.red} stroke={AVC.white} strokeWidth={1.2} />
      <text
        x={cx}
        y={baseline}
        textAnchor="middle"
        fontFamily={TV_FONT.encode}
        fontSize={size}
        fontWeight={700}
        fill={AVC.white}
      >
        {number}
      </text>
    </>
  );
}

/** The in/out triangle. Solid green arriving, hollow leaving; see SUB. */
function Arrow({
  cx,
  top,
  h,
  w,
  direction,
  role,
}: {
  cx: number;
  top: number;
  h: number;
  w: number;
  direction: "up" | "down";
  role: "in" | "out";
}) {
  const style = role === "in" ? SUB.arrowIn : SUB.arrowOut;
  const pts =
    direction === "down"
      ? `${cx - w / 2},${top} ${cx + w / 2},${top} ${cx},${top + h}`
      : `${cx},${top} ${cx + w / 2},${top + h} ${cx - w / 2},${top + h}`;
  return (
    <polygon
      points={pts}
      fill={role === "in" ? style.fill : "none"}
      stroke={style.stroke}
      strokeWidth={style.strokeW}
    />
  );
}

// ── the graphics ─────────────────────────────────────────────────────────────

/**
 * Substitution (item 18): two rows beside the bug, the incoming player above the
 * outgoing one.
 */
export function SubstitutionBlock({
  hand,
  sub,
}: {
  hand: Hand;
  sub: VisSubstitution;
}) {
  const rows = [
    { spec: SUB.upper, role: "in" as const, dir: "down" as const,
      jersey: sub.inJersey, name: sub.inName, band: BAND.upper, pin: false },
    { spec: SUB.lower, role: "out" as const, dir: "up" as const,
      jersey: sub.outJersey, name: sub.outName, band: BAND.lower, pin: true },
  ];
  return (
    <g>
      {rows.map((r, i) => (
        <Band
          key={i}
          id={`tv-sub-${i}-${hand}`}
          band={r.band}
          from={dockX(hand)}
          to={outward(hand, SUB.width)}
          fill={r.pin ? GRADIENT.lower : GRADIENT.upper}
          pinstriped={r.pin}
          lead={r.pin}
        >
          <Shirt
            x={boxLeft(hand, r.spec.shirt.near, r.spec.shirt.w)}
            top={r.spec.shirt.top}
            w={r.spec.shirt.w}
            h={r.spec.shirt.h}
            number={r.jersey != null ? String(r.jersey) : "—"}
            size={r.spec.number.size}
            baseline={r.spec.number.baseline}
          />
          {/* The reference shows a role code here — "OH", "OP" — and neither
              VIS nor VolleyStation publishes one on this pipeline. It is left
              out rather than filled with the court position number, which is a
              different thing wearing the same shape. See spec/47's open
              questions. */}
          <text
            x={outward(hand, r.spec.name.x)}
            y={r.spec.name.baseline}
            textAnchor={hand === "left" ? "start" : "end"}
            fontFamily={TV_FONT.encode}
            fontSize={fitFontSize(
              (r.name ?? "").toUpperCase(),
              r.spec.name.maxW,
              r.spec.name.size,
            )}
            fontWeight={r.spec.name.weight}
            fill={AVC.white}
          >
            {(r.name ?? (r.jersey != null ? `#${r.jersey}` : "")).toUpperCase()}
          </text>
          <Arrow
            cx={outward(hand, r.spec.arrow.cx)}
            top={r.spec.arrow.top}
            h={r.spec.arrow.h}
            w={r.spec.arrow.w}
            direction={r.dir}
            role={r.role}
          />
        </Band>
      ))}
      <Rule from={dockX(hand)} to={outward(hand, SUB.width)} />
    </g>
  );
}

/** The challenge alert (item 21, state 1): a tab on the bug, bug stays up. */
export function ChallengeAlert({ hand }: { hand: Hand }) {
  return (
    <g>
      <Band
        id={`tv-chal-tab-${hand}`}
        band={BAND.tab}
        from={dockX(hand)}
        to={inward(hand, CHALLENGE_TAB.width)}
        fill={GRADIENT.upper}
      >
        <text
          x={inward(hand, CHALLENGE_TAB.width / 2)}
          y={CHALLENGE_TAB.text.baseline}
          textAnchor="middle"
          fontFamily={TV_FONT.encode}
          fontSize={CHALLENGE_TAB.text.size}
          fontWeight={CHALLENGE_TAB.text.weight}
          fill={AVC.white}
        >
          CHALLENGE
        </text>
      </Band>
      <Rule from={dockX(hand)} to={inward(hand, CHALLENGE_TAB.width)} />
    </g>
  );
}

/**
 * The challenge card (item 21, states 2-4): header over category, replacing the
 * bug.
 *
 * CENTRED, not docked, which is the one place these graphics break the pattern —
 * the p.34 examples put it across the middle of the frame rather than against a
 * flag edge, and the guidelines describe it as offset toward the requesting
 * team's side. Docking it would also run "CHALLENGE UNSUCCESSFUL" clean off the
 * left of the frame at 33 px, which is exactly what the first version did.
 *
 * The result states put a coloured plate INSIDE the upper band — blue for
 * successful, red for unsuccessful — sized to its own text, with the band's navy
 * showing either side of it.
 */
export function ChallengeCard({
  hand,
  status,
  teamName,
  category,
}: {
  hand: Hand;
  status: VisChallengeStatus;
  teamName: string;
  category: ChallengeCategory | null;
}) {
  const header =
    status === "REQUESTED"
      ? `VIDEO CHALLENGE BY ${teamName.toUpperCase()}`
      : status === "REVIEW"
        ? "VIDEO CHALLENGE REVIEW"
        : status === "SUCCESSFUL"
          ? "CHALLENGE SUCCESSFUL"
          : "CHALLENGE UNSUCCESSFUL";
  const decided = status === "SUCCESSFUL" || status === "UNSUCCESSFUL";
  const spec = decided ? CHALLENGE_CARD.result : CHALLENGE_CARD.header;
  const body = category ?? "UNDER REVIEW";

  const headerW = textRun(header, spec.size);
  const bodyW = textRun(body, CHALLENGE_CARD.category.size);
  const width = Math.min(
    CHALLENGE_CARD.maxWidth,
    Math.max(CHALLENGE_CARD.minWidth, headerW + CHALLENGE_CARD.pad * 2,
             bodyW + CHALLENGE_CARD.pad * 2),
  );
  // Nudged toward the side that asked for the review, as the guidelines
  // describe; the p.34 examples sit about 15 px off centre.
  const cx = FRAME.w / 2 + (hand === "left" ? -CHALLENGE_CARD.offset : CHALLENGE_CARD.offset);
  const from = cx + width / 2;
  const to = cx - width / 2;
  const plateW = Math.min(width - 8, headerW + CHALLENGE_CARD.platePad * 2);

  return (
    <g>
      <Band
        id={`tv-chal-head-${hand}`}
        band={BAND.upper}
        from={from}
        to={to}
        fill={GRADIENT.upper}
      >
        {decided ? (
          <rect
            x={cx - plateW / 2}
            y={BAND.upper.y + 2}
            width={plateW}
            height={BAND.upper.h - 4}
            fill={
              status === "SUCCESSFUL"
                ? CHALLENGE_CARD.successFill
                : CHALLENGE_CARD.failFill
            }
          />
        ) : null}
        <text
          x={cx}
          y={spec.baseline}
          textAnchor="middle"
          fontFamily={TV_FONT.encode}
          fontSize={fitFontSize(header, width - CHALLENGE_CARD.pad * 2, spec.size)}
          fontWeight={spec.weight}
          fill={AVC.white}
        >
          {header}
        </text>
      </Band>
      <Band
        id={`tv-chal-body-${hand}`}
        band={BAND.lower}
        from={from}
        to={to}
        fill={GRADIENT.lower}
        pinstriped
        lead
      >
        <text
          x={cx}
          y={CHALLENGE_CARD.category.baseline}
          textAnchor="middle"
          fontFamily={TV_FONT.encode}
          fontSize={fitFontSize(
            body,
            width - CHALLENGE_CARD.pad * 2,
            CHALLENGE_CARD.category.size,
          )}
          fontWeight={CHALLENGE_CARD.category.weight}
          fill={AVC.white}
        >
          {body}
        </text>
      </Band>
      <Rule from={from} to={to} />
    </g>
  );
}

/** Time-out (item 22): a tab on the bug with the team's remaining pips. */
export function TimeoutTab({
  hand,
  taken,
  allowance = 2,
}: {
  hand: Hand;
  taken: number;
  allowance?: number;
}) {
  const word = "TIMEOUT";
  const wordW = textRun(word, TIMEOUT_TAB.text.size);
  const pipsW = allowance * TIMEOUT_TAB.pip.r * 2 + (allowance - 1) * (TIMEOUT_TAB.pip.gap - TIMEOUT_TAB.pip.r * 2);
  // The word and the pips are centred as ONE group, which is why the word does
  // not start where CHALLENGE's does (558 against 566, measured).
  const groupW = wordW + TIMEOUT_TAB.textGap + pipsW;
  const start = TIMEOUT_TAB.width / 2 - groupW / 2;
  return (
    <g>
      <Band
        id={`tv-to-tab-${hand}`}
        band={BAND.tab}
        from={dockX(hand)}
        to={inward(hand, TIMEOUT_TAB.width)}
        fill={GRADIENT.upper}
      >
        <text
          x={inward(hand, start)}
          y={TIMEOUT_TAB.text.baseline}
          textAnchor={hand === "left" ? "start" : "end"}
          fontFamily={TV_FONT.encode}
          fontSize={TIMEOUT_TAB.text.size}
          fontWeight={TIMEOUT_TAB.text.weight}
          fill={AVC.white}
        >
          {word}
        </text>
        {Array.from({ length: allowance }, (_, i) => {
          const used = i < taken;
          const cx = inward(
            hand,
            start + wordW + TIMEOUT_TAB.textGap + TIMEOUT_TAB.pip.r + i * TIMEOUT_TAB.pip.gap,
          );
          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={TIMEOUT_TAB.pip.cy}
                r={TIMEOUT_TAB.pip.r - TIMEOUT_TAB.pip.strokeW / 2}
                fill={used ? "none" : TIMEOUT_TAB.pip.fill}
                stroke={AVC.white}
                strokeWidth={TIMEOUT_TAB.pip.strokeW}
              />
              {/* A spent time-out is struck through, not merely hollow. */}
              {used ? (
                <line
                  x1={cx - TIMEOUT_TAB.pip.r * 0.72}
                  y1={TIMEOUT_TAB.pip.cy + TIMEOUT_TAB.pip.r * 0.72}
                  x2={cx + TIMEOUT_TAB.pip.r * 0.72}
                  y2={TIMEOUT_TAB.pip.cy - TIMEOUT_TAB.pip.r * 0.72}
                  stroke={AVC.white}
                  strokeWidth={TIMEOUT_TAB.pip.strokeW}
                />
              ) : null}
            </g>
          );
        })}
      </Band>
      <Rule from={dockX(hand)} to={inward(hand, TIMEOUT_TAB.width)} />
    </g>
  );
}

/** Key moment (item 40): "SET POINT" / "MATCH POINT" beside the bug. */
export function KeyMomentStrap({
  hand,
  text,
}: {
  hand: Hand;
  text: KeyMoment;
}) {
  return (
    <Band
      id={`tv-km-${hand}`}
      band={BAND.lower}
      from={dockX(hand)}
      to={outward(hand, KEY_MOMENT.width)}
      fill={GRADIENT.lower}
      pinstriped
      lead
    >
      <text
        x={outward(hand, KEY_MOMENT.width / 2)}
        y={KEY_MOMENT.text.baseline}
        textAnchor="middle"
        fontFamily={TV_FONT.ancorli}
        fontSize={KEY_MOMENT.text.size}
        fill={AVC.white}
      >
        {text}
      </text>
    </Band>
  );
}

/**
 * Rendered width of a string, for sizing a panel to its content.
 *
 * The same metric `fitFontSize` uses, so a panel sized here and text fitted
 * there always agree — sizing the panel from one table and the type from
 * another is how a card ends up one pixel too narrow for its own header.
 */
function textRun(s: string, size: number): number {
  return textWidth(s, size);
}
