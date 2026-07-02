"use client";

// Light confirms both teams in one event (no team tablets). Scorer sets each
// team's rotation order (position 1 serves first) — shared implementation.
import { useLightMatch } from "@/lib/light-match-context";
import { RotationLineupEntry } from "@/components/scoring/shared/RotationLineupEntry";

export function LightLineupEntry() {
  const { state, config, rosterA, rosterB, teamAName, teamBName, dispatch, pending } =
    useLightMatch();
  return (
    <RotationLineupEntry
      currentSetNumber={state.currentSetNumber}
      playersPerSide={config.playersPerSide}
      rosterA={rosterA}
      rosterB={rosterB}
      teamAName={teamAName}
      teamBName={teamBName}
      dispatch={dispatch}
      pending={pending}
    />
  );
}
