"use client";

// Grass scoring context — thin wrapper over the generic match provider
// (spec/14 §F1).
import { createMatchProvider, type PlayerLite } from "@/lib/match-provider";
import { appendGrassEvent } from "@/engine/grass/reducer";
import type { GrassEventPayload, GrassMatchState } from "@/engine/grass/types";

export type { PlayerLite };

const { Provider, useMatchCtx } = createMatchProvider<
  GrassMatchState,
  GrassEventPayload
>({
  append: (s, p, c, o) => appendGrassEvent(s, p, c, o),
  isRallyWon: (p) => p.type === "RALLY_WON_A" || p.type === "RALLY_WON_B",
});

export const GrassMatchProvider = Provider;
export const useGrassMatch = useMatchCtx;
