"use client";

import { useLightMatch } from "@/lib/light-match-context";
import { LightCourt } from "@/components/court/LightCourt";
import { LightActionBar } from "@/components/scoring/LightActionBar";
import { LightLineupEntry } from "@/components/scoring/LightLineupEntry";
import { RotationScoreboard } from "@/components/scoring/shared/RotationScoreboard";

export function LightScoreboard({ competitionName }: { competitionName: string }) {
  const ctx = useLightMatch();
  return (
    <RotationScoreboard
      disciplineLabel="Light"
      competitionName={competitionName}
      ctx={ctx}
      Court={LightCourt}
      lineupEntry={<LightLineupEntry />}
      actionBar={<LightActionBar />}
    />
  );
}
