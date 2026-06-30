"use client";

import { useEffect } from "react";

/**
 * Port of the redesign mock's `fitNames()` (spec/change-requests/08). For every
 * `.fit` element inside `rootRef`, start at `data-max` (in cqmin → px via the
 * board's min dimension) and shrink the font 1px at a time until it fits its
 * parent slot on one line (floor ~8px). Re-runs after render (deps) and on
 * resize. Writes to `el.style` only — no React state, so no effect-setState.
 */
export function useFitText(
  rootRef: React.RefObject<HTMLElement | null>,
  deps: React.DependencyList,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const fit = () => {
      const minDim = Math.min(root.clientWidth, root.clientHeight);
      if (!minDim) return;
      root.querySelectorAll<HTMLElement>(".fit").forEach((el) => {
        const slot = el.parentElement;
        if (!slot || !slot.clientWidth) return;
        let px = (parseFloat(el.dataset.max || "4") * minDim) / 100;
        el.style.fontSize = `${px}px`;
        let guard = 0;
        while (
          el.getBoundingClientRect().width > slot.clientWidth &&
          px > 8 &&
          guard < 400
        ) {
          px -= 1;
          el.style.fontSize = `${px}px`;
          guard++;
        }
      });
    };
    const raf = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
    // deps are caller-controlled (board content); intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
