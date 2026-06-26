"use client";

import { useActionState, useEffect, useRef } from "react";
import { createTeam } from "@/lib/team-actions";
import { OK } from "@/lib/action-state";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function AddTeamForm({
  tenantSlug,
  competitionId,
}: {
  tenantSlug: string;
  competitionId: string;
}) {
  const [state, action] = useActionState(createTeam, OK);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs after a successful add (state resets to OK with no error
  // once the action's revalidation completes).
  useEffect(() => {
    if (!state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">Add team</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={ui.label} htmlFor="t-name">
            Display name
          </label>
          <input id="t-name" name="displayName" required className={ui.input} />
        </div>
        <div>
          <label className={ui.label} htmlFor="t-country">
            Country (3-letter)
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
            Seed
          </label>
          <input
            id="t-seed"
            name="seed"
            type="number"
            min={1}
            className={ui.input}
          />
        </div>
        <div className="col-span-2">
          <label className={ui.label} htmlFor="t-club">
            Club (optional)
          </label>
          <input id="t-club" name="clubName" className={ui.input} />
        </div>
      </div>

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}

      <div className="mt-4">
        <SubmitButton pendingLabel="Adding…">Add team</SubmitButton>
      </div>
    </form>
  );
}
