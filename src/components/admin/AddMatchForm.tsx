"use client";

import { useActionState, useEffect, useRef } from "react";
import { createMatch } from "@/lib/schedule-actions";
import { OK } from "@/lib/action-state";
import { useT } from "@/lib/i18n/client";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function AddMatchForm({
  tenantSlug,
  competitionId,
  teams,
}: {
  tenantSlug: string;
  competitionId: string;
  teams: { id: string; displayName: string }[];
}) {
  const t = useT();
  const [state, action] = useActionState(createMatch, OK);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs only after an explicit success (state.ok), not on mount.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  if (teams.length < 2) {
    return (
      <div className={`${ui.card} text-sm text-score-dim`}>
        {t("schedule.needTeams")}
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">{t("schedule.createMatch")}</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />

      <div className="space-y-3">
        <div>
          <label className={ui.label} htmlFor="m-a">
            {t("schedule.teamA")}
          </label>
          <select id="m-a" name="teamAId" required className={ui.select}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={ui.label} htmlFor="m-b">
            {t("schedule.teamB")}
          </label>
          <select id="m-b" name="teamBId" required className={ui.select}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={ui.label} htmlFor="m-court">
              {t("common.court")}
            </label>
            <input
              id="m-court"
              name="courtNumber"
              type="number"
              min={1}
              className={ui.input}
            />
          </div>
          <div>
            <label className={ui.label} htmlFor="m-round">
              {t("common.round")}
            </label>
            <input
              id="m-round"
              name="roundName"
              placeholder="Pool A"
              className={ui.input}
            />
          </div>
        </div>
        <div>
          <label className={ui.label} htmlFor="m-time">
            {t("schedule.scheduledAt")}
          </label>
          <input
            id="m-time"
            name="scheduledAt"
            type="datetime-local"
            className={ui.input}
          />
          <p className="mt-1 text-[11px] text-score-dim">
            {t("schedule.utcHint")}
          </p>
        </div>
      </div>

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}

      <div className="mt-4">
        <SubmitButton pendingLabel={t("common.creating")}>{t("schedule.createMatch")}</SubmitButton>
      </div>
    </form>
  );
}
