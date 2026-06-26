"use client";

import { useActionState, useEffect, useRef } from "react";
import { createMatch } from "@/lib/schedule-actions";
import { OK } from "@/lib/action-state";
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
  const [state, action] = useActionState(createMatch, OK);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) formRef.current?.reset();
  }, [state]);

  if (teams.length < 2) {
    return (
      <div className={`${ui.card} text-sm text-score-dim`}>
        Add at least two teams before scheduling matches.
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">Create match</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />

      <div className="space-y-3">
        <div>
          <label className={ui.label} htmlFor="m-a">
            Team A
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
            Team B
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
              Court
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
              Round
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
            Scheduled at
          </label>
          <input
            id="m-time"
            name="scheduledAt"
            type="datetime-local"
            className={ui.input}
          />
        </div>
      </div>

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}

      <div className="mt-4">
        <SubmitButton pendingLabel="Creating…">Create match</SubmitButton>
      </div>
    </form>
  );
}
