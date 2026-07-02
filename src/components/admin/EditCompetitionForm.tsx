"use client";

import { useState } from "react";
import { updateCompetition } from "@/lib/competition-actions";
import { GENDERS } from "@/lib/domain";
import { useT } from "@/lib/i18n/client";
import { ActionForm } from "@/components/admin/ActionForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function EditCompetitionForm({
  tenantSlug,
  competition,
}: {
  tenantSlug: string;
  competition: {
    id: string;
    name: string;
    venue: string | null;
    startDate: string | null;
    endDate: string | null;
    gender: string | null;
    discipline: string;
    color: string | null;
  };
}) {
  const t = useT();
  // A disabled colour input isn't submitted, so unchecking clears the colour.
  const [colorOn, setColorOn] = useState(Boolean(competition.color));
  return (
    <ActionForm action={updateCompetition} className={ui.card}>
      <h2 className="mb-4 font-medium">{t("comp.details")}</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competition.id} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={ui.label} htmlFor="e-name">
            {t("common.name")}
          </label>
          <input
            id="e-name"
            name="name"
            required
            defaultValue={competition.name}
            className={ui.input}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={ui.label} htmlFor="e-venue">
            {t("common.venue")}
          </label>
          <input
            id="e-venue"
            name="venue"
            defaultValue={competition.venue ?? ""}
            className={ui.input}
          />
        </div>
        <div>
          <label className={ui.label} htmlFor="e-start">
            {t("common.startDate")}
          </label>
          <input
            id="e-start"
            name="startDate"
            type="date"
            defaultValue={competition.startDate ?? ""}
            className={ui.input}
          />
        </div>
        <div>
          <label className={ui.label} htmlFor="e-end">
            {t("common.endDate")}
          </label>
          <input
            id="e-end"
            name="endDate"
            type="date"
            defaultValue={competition.endDate ?? ""}
            className={ui.input}
          />
        </div>
        <div>
          <label className={ui.label} htmlFor="e-gender">
            {t("common.gender")}
          </label>
          <select
            id="e-gender"
            name="gender"
            defaultValue={competition.gender ?? "UNSPECIFIED"}
            className={ui.select}
          >
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g.charAt(0) + g.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={ui.label} htmlFor="e-discipline">
            {t("common.discipline")}
          </label>
          <input
            id="e-discipline"
            value={competition.discipline}
            disabled
            aria-readonly
            className={`${ui.input} opacity-60`}
            title={t("comp.disciplineFixed")}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={ui.label} htmlFor="e-color">
            {t("comp.accentColor")}
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-score-dim">
              <input
                type="checkbox"
                checked={colorOn}
                onChange={(e) => setColorOn(e.target.checked)}
              />
              {t("comp.accentColorEnable")}
            </label>
            <input
              id="e-color"
              name="color"
              type="color"
              disabled={!colorOn}
              defaultValue={competition.color ?? "#3366cc"}
              className="h-9 w-16 rounded-lg border border-border bg-surface disabled:opacity-40"
            />
          </div>
          <p className="mt-1 text-[11px] text-score-dim">
            {t("comp.accentColorHint")}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <SubmitButton pendingLabel={t("common.saving")}>{t("common.saveChanges")}</SubmitButton>
      </div>
    </ActionForm>
  );
}
