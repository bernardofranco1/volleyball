"use client";

import { useActionState } from "react";
import { createCompetition } from "@/lib/competition-actions";
import { OK } from "@/lib/action-state";
import { DISCIPLINES, GENDERS } from "@/lib/domain";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function NewCompetitionForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, action] = useActionState(createCompetition, OK);

  return (
    <form action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">New competition</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={ui.label} htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="e.g. Paris Beach Open 2026"
            className={ui.input}
          />
        </div>

        <div>
          <label className={ui.label} htmlFor="discipline">
            Discipline
          </label>
          <select
            id="discipline"
            name="discipline"
            defaultValue="BEACH"
            className={ui.select}
          >
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={ui.label} htmlFor="gender">
            Gender
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
            Start date
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
            End date
          </label>
          <input id="endDate" name="endDate" type="date" className={ui.input} />
        </div>

        <div className="sm:col-span-2">
          <label className={ui.label} htmlFor="venue">
            Venue
          </label>
          <input
            id="venue"
            name="venue"
            placeholder="Optional"
            className={ui.input}
          />
        </div>
      </div>

      {state.error && (
        <p className="mt-3 text-sm text-red-400">{state.error}</p>
      )}

      <div className="mt-4">
        <SubmitButton pendingLabel="Creating…">Create competition</SubmitButton>
      </div>
    </form>
  );
}
