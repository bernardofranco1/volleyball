"use client";

// Light scoring context — thin wrapper over the generic match provider
// (spec/14 §F1).
import { createMatchProvider, type PlayerLite } from "@/lib/match-provider";
import { appendLightEvent } from "@/engine/light/reducer";
import type { LightEventPayload, LightMatchState } from "@/engine/light/types";

export type { PlayerLite };

const { Provider, useMatchCtx } = createMatchProvider<
  LightMatchState,
  LightEventPayload
>({
  append: (s, p, c, o) => appendLightEvent(s, p, c, o),
  isRallyWon: (p) => p.type === "RALLY_WON_A" || p.type === "RALLY_WON_B",
});

export const LightMatchProvider = Provider;
export const useLightMatch = useMatchCtx;
