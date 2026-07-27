"use client";

/**
 * White signing area (spec/20). Captures a signature as VECTOR polylines in a
 * UNIT SQUARE — x and y both 0..1 as a fraction of the pad box — rather than a
 * raster image: it prints crisply into the scoresheet at any size, stays a couple
 * of KB in the database, and never goes near an image pipeline. `pad` carries the
 * box's aspect ratio so a renderer can letterbox the ink instead of stretching it.
 *
 * Both axes are normalised the SAME way on purpose: mixing "x in 0..1, y in
 * 0..ratio" is what previously pushed most of the ink outside the pad's viewBox
 * on screen and outside its box in the PDF.
 *
 * Pointer Events only, with one active pointer at a time — a second touch (a
 * resting palm) is ignored rather than drawn. `touch-action: none` stops the
 * console from scrolling under the signer's hand.
 */

import { useCallback, useRef, useState } from "react";
import type { SignatureStrokes } from "@/lib/match-signatures";

/** Points closer than this (in pad units) are dropped — keeps rows small. */
const MIN_STEP = 0.004;

export function SignaturePad({
  value,
  onChange,
  disabled = false,
  disabledHint,
  ariaLabel,
}: {
  value: SignatureStrokes | null;
  onChange: (v: SignatureStrokes | null) => void;
  disabled?: boolean;
  /** Shown across the pad while it is disabled (e.g. "enter a name first"). */
  disabledHint?: string;
  ariaLabel: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);
  // The in-progress stroke lives in state so it renders while being drawn.
  const [live, setLive] = useState<number[][] | null>(null);

  const strokes = value?.strokes ?? [];

  const toPad = useCallback((e: React.PointerEvent): [number, number] | null => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    return [clamp01(x), clamp01(y)];
  }, []);

  const start = (e: React.PointerEvent) => {
    if (disabled || activePointer.current != null) return;
    const p = toPad(e);
    if (!p) return;
    activePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setLive([p]);
  };

  const move = (e: React.PointerEvent) => {
    if (disabled || activePointer.current !== e.pointerId) return;
    const p = toPad(e);
    if (!p) return;
    setLive((prev) => {
      if (!prev) return prev;
      const last = prev[prev.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) return prev;
      return [...prev, p];
    });
  };

  const end = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    setLive((prev) => {
      // A tap with no movement is a dot, not a stroke — keep it (people do dot
      // an "i"), but drop empty artefacts.
      if (prev && prev.length > 0) {
        onChange({ pad: { w: 1, h: PAD_RATIO }, strokes: [...strokes, prev] });
      }
      return null;
    });
  };

  const clear = () => {
    setLive(null);
    activePointer.current = null;
    onChange(null);
  };

  const undoStroke = () => {
    if (strokes.length === 0) return;
    const next = strokes.slice(0, -1);
    onChange(next.length ? { pad: { w: 1, h: PAD_RATIO }, strokes: next } : null);
  };

  const empty = strokes.length === 0 && !live;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={boxRef}
        role="application"
        aria-label={ariaLabel}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className={`relative w-full touch-none select-none overflow-hidden rounded-lg border-2 bg-white ${
          disabled ? "cursor-not-allowed border-border/60" : "cursor-crosshair border-border"
        }`}
        style={{ aspectRatio: `1 / ${PAD_RATIO}` }}
      >
        {/* Signing baseline, like the box on the paper sheet. */}
        <div className="pointer-events-none absolute inset-x-6 bottom-[22%] border-b border-dashed border-neutral-300" />
        {/* Unit-square viewBox, stretched to the box: point (x,y) lands exactly
            where the pointer was. Ink width is given in screen pixels via
            non-scaling-stroke, so it stays a real pen line at any pad size. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden
        >
          {[...strokes, ...(live ? [live] : [])].map((stroke, i) => (
            <path
              key={i}
              d={pathOf(stroke)}
              fill="none"
              stroke="#111111"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {disabled && disabledHint ? (
          <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm font-medium text-neutral-500">
            {disabledHint}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={undoStroke}
          disabled={disabled || empty}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-score-dim disabled:opacity-40"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || empty}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-score-dim disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/** Pad height as a fraction of its width — matches the sheet's signature box. */
export const PAD_RATIO = 0.32;

/** SVG path for one stroke; a single point renders as a short dot segment. */
export function pathOf(stroke: number[][]): string {
  if (stroke.length === 0) return "";
  const [first, ...rest] = stroke;
  if (rest.length === 0) return `M ${first[0]} ${first[1]} l 0.001 0`;
  return (
    `M ${first[0]} ${first[1]} ` + rest.map((p) => `L ${p[0]} ${p[1]}`).join(" ")
  );
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
