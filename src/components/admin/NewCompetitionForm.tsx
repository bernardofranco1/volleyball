"use client";

import { useActionState } from "react";
import { createCompetition } from "@/lib/competition-actions";
import { OK } from "@/lib/action-state";
import { DISCIPLINES, GENDERS } from "@/lib/domain";
import type { Discipline } from "@/engine/types";
import { useT } from "@/lib/i18n/client";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function NewCompetitionForm({
  tenantSlug,
  // Disciplines this tenant may create in (spec/24 §5.2). Defaults to all so
  // existing callers/tests keep working; createCompetition re-checks server-side.
  enabledDisciplines = [...DISCIPLINES],
}: {
  tenantSlug: string;
  enabledDisciplines?: Discipline[];
}) {
  const t = useT();
  const [state, action] = useActionState(createCompetition, OK);
  // Preserve the canonical order regardless of how the config array is stored.
  const options = DISCIPLINES.filter((d) => enabledDisciplines.includes(d));
  const only = options.length === 1 ? options[0] : null;

  return (
    <form action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">{t("comp.new")}</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={ui.label} htmlFor="name">
            {t("common.name")}
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder={t("comp.namePlaceholder")}
            className={ui.input}
          />
        </div>

        <div>
          <label className={ui.label} htmlFor="discipline">
            {t("common.discipline")}
          </label>
          {only ? (
            // Single enabled discipline: show it, don't make them pick from a
            // list of one. Still submitted, so the action sees a value.
            <>
              <input type="hidden" name="discipline" value={only} />
              <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-score-dim">
                {only}
              </p>
            </>
          ) : (
            <select
              id="discipline"
              name="discipline"
              defaultValue={options.includes("BEACH") ? "BEACH" : options[0]}
              className={ui.select}
            >
              {options.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className={ui.label} htmlFor="gender">
            {t("common.gender")}
          </label>
          <select
            id="gender"
            name="gender"
            defaultValue="UNSPECIFIED"
            className={ui.select}
          >
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={ui.label} htmlFor="startDate">
            {t("common.startDate")}
          </label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            className={ui.input}
          />
        </div>

        <div>
          <label className={ui.label} htmlFor="endDate">
            {t("common.endDate")}
          </label>
          <input id="endDate" name="endDate" type="date" className={ui.input} />
        </div>

        <div className="sm:col-span-2">
          <label className={ui.label} htmlFor="venue">
            {t("common.venue")}
          </label>
          <input
            id="venue"
            name="venue"
            placeholder={t("common.optional")}
            className={ui.input}
          />
        </div>
      </div>

      {state.error && (
        <p className="mt-3 text-sm text-red-400">{state.error}</p>
      )}

      <div className="mt-4">
        <SubmitButton pendingLabel={t("common.creating")}>{t("comp.create")}</SubmitButton>
      </div>
    </form>
  );
}
