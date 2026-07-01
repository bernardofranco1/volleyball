"use client";

import { useActionState } from "react";
import { setTeamColors } from "@/lib/team-actions";
import { OK } from "@/lib/action-state";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

// Pre-match team-colour picker (brief §1.4) — scorer-accessible.
export function TeamColorPicker({
  tenantSlug,
  competitionId,
  matchId,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
}: {
  tenantSlug: string;
  competitionId: string;
  matchId: string;
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
}) {
  const [state, action] = useActionState(setTeamColors, OK);
  return (
    <form action={action} className={ui.card}>
      <h2 className="mb-1 font-medium">Team colours</h2>
      <p className="mb-3 text-[11px] text-score-dim">
        Shown on the scoreboard. Pick before the match.
      </p>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />
      <input type="hidden" name="matchId" value={matchId} />
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">{teamAName}</span>
          <input
            type="color"
            name="colorA"
            defaultValue={teamAColor ?? "#3366cc"}
            className="h-9 w-16 flex-none rounded border border-border bg-surface"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">{teamBName}</span>
          <input
            type="color"
            name="colorB"
            defaultValue={teamBColor ?? "#cc3333"}
            className="h-9 w-16 flex-none rounded border border-border bg-surface"
          />
        </label>
      </div>
      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
      {state.ok && state.message && (
        <p role="status" className="mt-3 text-sm text-emerald-400">
          {state.message} ✓
        </p>
      )}
      <div className="mt-3">
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Save colours
        </SubmitButton>
      </div>
    </form>
  );
}
