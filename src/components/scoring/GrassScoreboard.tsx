"use client";

import { useGrassMatch } from "@/lib/grass-match-context";
import { GrassCourt } from "@/components/court/GrassCourt";
import { GrassActionBar } from "@/components/scoring/GrassActionBar";
import { GrassLineupEntry } from "@/components/scoring/GrassLineupEntry";
import { RotationScoreboard } from "@/components/scoring/shared/RotationScoreboard";

export function GrassScoreboard({ competitionName }: { competitionName: string }) {
  const ctx = useGrassMatch();
  return (
    <RotationScoreboard
      disciplineLabel="Grass"
      competitionName={competitionName}
      ctx={ctx}
      Court={GrassCourt}
      lineupEntry={<GrassLineupEntry />}
      actionBar={<GrassActionBar />}
    />
  );
}
