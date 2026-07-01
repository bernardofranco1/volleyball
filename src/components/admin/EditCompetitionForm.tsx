"use client";

import { updateCompetition } from "@/lib/competition-actions";
import { GENDERS } from "@/lib/domain";
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
  };
}) {
  return (
    <ActionForm action={updateCompetition} className={ui.card}>
      <h2 className="mb-4 font-medium">Details</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competition.id} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={ui.label} htmlFor="e-name">
            Name
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
            Venue
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
            Start date
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
            End date
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
            Gender
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
            Discipline
          </label>
          <input
            id="e-discipline"
            value={competition.discipline}
            disabled
            aria-readonly
            className={`${ui.input} opacity-60`}
            title="Discipline is fixed once matches use its rule engine"
          />
        </div>
      </div>

      <div className="mt-4">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </ActionForm>
  );
}
