"use client";

// Grass confirms both teams in one event. The scorer sets each team's rotation
// order (position 1 serves first), then confirms — shared implementation.
import { useGrassMatch } from "@/lib/grass-match-context";
import { RotationLineupEntry } from "@/components/scoring/shared/RotationLineupEntry";

export function GrassLineupEntry() {
  const { state, config, rosterA, rosterB, teamAName, teamBName, dispatch, pending } =
    useGrassMatch();
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
