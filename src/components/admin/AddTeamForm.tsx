"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTeam } from "@/lib/team-actions";
import { OK } from "@/lib/action-state";
import { useT } from "@/lib/i18n/client";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function AddTeamForm({
  tenantSlug,
  competitionId,
}: {
  tenantSlug: string;
  competitionId: string;
}) {
  const t = useT();
  const [state, action] = useActionState(createTeam, OK);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs only after an explicit success (state.ok), not on mount.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">{t("teams.addTeam")}</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={ui.label} htmlFor="t-name">
            {t("teams.displayName")}
          </label>
          <input id="t-name" name="displayName" required className={ui.input} />
        </div>
        <div>
          <label className={ui.label} htmlFor="t-country">
            {t("teams.country3")}
          </label>
          <input
            id="t-country"
            name="countryCode"
            maxLength={3}
            placeholder="BRA"
            className={ui.input}
          />
        </div>
        <div>
          <label className={ui.label} htmlFor="t-seed">
            {t("common.seed")}
          </label>
          <input
            id="t-seed"
            name="seed"
            type="number"
            min={1}
            className={ui.input}
          />
        </div>
        <div>
          <label className={ui.label} htmlFor="t-club">
            {t("teams.club")}
          </label>
          <input id="t-club" name="clubName" className={ui.input} />
        </div>
        <div>
          <label className={ui.label} htmlFor="t-color">
            {t("teams.teamColor")}
          </label>
          <input
            id="t-color"
            name="color"
            type="color"
            defaultValue="#3366cc"
            className="h-10 w-full rounded-lg border border-border bg-surface"
          />
        </div>
      </div>

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}

      <div className="mt-4">
        <SubmitButton pendingLabel={t("common.adding")}>{t("teams.addTeam")}</SubmitButton>
      </div>
    </form>
  );
}
