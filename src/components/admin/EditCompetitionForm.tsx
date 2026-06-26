"use client";

import { useActionState } from "react";
import { updateCompetition } from "@/lib/competition-actions";
import { OK } from "@/lib/action-state";
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
  };
}) {
  const [state, action] = useActionState(updateCompetition, OK);

  return (
    <form action={action} className={ui.card}>
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
      </div>

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}

      <div className="mt-4">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </form>
  );
}
