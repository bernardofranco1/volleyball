"use client";

import { useActionState } from "react";
import { rewindMatchAction } from "@/lib/match-admin-actions";
import { OK } from "@/lib/action-state";
import { useT } from "@/lib/i18n/client";

// Per-event "rewind to here" control on the match detail event log. Erases
// this event and everything after it (server-side, via an appended REWIND),
// so an admin can re-score manually from this point. Admin-only page, so no
// extra role gate here; the server action re-checks.
export function RewindToHere({
  tenantSlug,
  competitionId,
  matchId,
  fromSequence,
}: {
  tenantSlug: string;
  competitionId: string;
  matchId: string;
  fromSequence: number;
}) {
  const t = useT();
  const [state, action] = useActionState(rewindMatchAction, OK);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(t("match.rewindConfirm"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="fromSequence" value={fromSequence} />
      <button
        type="submit"
        className="text-xs text-score-dim underline hover:text-red-400"
      >
        {t("match.rewindHere")}
      </button>
      {state.error && (
        <span className="ml-2 text-xs text-red-400">{state.error}</span>
      )}
    </form>
  );
}
