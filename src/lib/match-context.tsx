"use client";

// Beach scoring context — a thin wrapper over the generic match provider
// (spec/14 §F1), exactly like indoor/grass/light. The previous bespoke copy of
// the optimistic/realtime/offline logic had already drifted (it kept stale
// error banners and could spin in the offline flush loop); binding the engine
// here keeps one implementation for all four disciplines.
import { createMatchProvider } from "@/lib/match-provider";
import { appendBeachEvent } from "@/engine/beach/reducer";
import type { BeachEventPayload, BeachMatchState } from "@/engine/beach/types";

const { Provider, useMatchCtx } = createMatchProvider<
  BeachMatchState,
  BeachEventPayload
>({
  append: (s, p, c, o) => appendBeachEvent(s, p, c, o),
  isRallyWon: (p) => p.type === "RALLY_WON_A" || p.type === "RALLY_WON_B",
});

export const MatchProvider = Provider;
export const useMatch = useMatchCtx;
