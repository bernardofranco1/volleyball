"use client";

// Indoor scoring context — a thin wrapper over the generic match provider
// (spec/14 §F1). All the optimistic/realtime/offline logic lives in
// match-provider.tsx; here we only bind the indoor engine + types.
import { createMatchProvider, type PlayerLite } from "@/lib/match-provider";
import { appendIndoorEvent } from "@/engine/indoor/reducer";
import type {
  IndoorEventPayload,
  IndoorMatchState,
} from "@/engine/indoor/types";

export type { PlayerLite };

const { Provider, useMatchCtx } = createMatchProvider<
  IndoorMatchState,
  IndoorEventPayload
>({
  append: (s, p, c, o) => appendIndoorEvent(s, p, c, o),
  isRallyWon: (p) => p.type === "RALLY_WON_A" || p.type === "RALLY_WON_B",
});

export const IndoorMatchProvider = Provider;
export const useIndoorMatch = useMatchCtx;
