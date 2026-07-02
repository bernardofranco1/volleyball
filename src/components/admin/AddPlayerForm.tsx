"use client";

import { useActionState, useEffect, useRef } from "react";
import { createPlayer } from "@/lib/team-actions";
import { OK } from "@/lib/action-state";
import { useT } from "@/lib/i18n/client";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function AddPlayerForm({
  tenantSlug,
  competitionId,
  teamId,
}: {
  tenantSlug: string;
  competitionId: string;
  teamId: string;
}) {
  const t = useT();
  const [state, action] = useActionState(createPlayer, OK);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs only after an explicit success (state.ok), not on mount.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />
      <input type="hidden" name="teamId" value={teamId} />

      <input
        name="firstName"
        placeholder={t("teams.firstShort")}
        className={`${ui.input} w-28`}
        aria-label={t("common.firstName")}
      />
      <input
        name="lastName"
        placeholder={t("teams.lastShort")}
        className={`${ui.input} w-28`}
        aria-label={t("common.lastName")}
      />
      <input
        name="jerseyNumber"
        type="number"
        min={0}
        placeholder="#"
        className={`${ui.input} w-16`}
        aria-label={t("common.jerseyNumber")}
      />
      <label className="flex items-center gap-1 text-xs text-score-dim">
        <input type="checkbox" name="isCaptain" /> C
      </label>
      <label className="flex items-center gap-1 text-xs text-score-dim">
        <input type="checkbox" name="isLibero" /> L
      </label>
      <SubmitButton variant="secondary" pendingLabel="…">
        {t("teams.addPlayer")}
      </SubmitButton>
      {state.error && (
        <span className="w-full text-xs text-red-400">{state.error}</span>
      )}
    </form>
  );
}
