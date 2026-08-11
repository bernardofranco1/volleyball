"use client";

// Assign a team's bench staff (spec/24 §2.5/§6.4). The head coach is what the
// official scoresheets print in their coach box — blank until spec/24 gave
// coaches an entity to point at (spec/21 gap G4).
//
// One tiny form per function rather than one big form, so saving a coach can't
// clear a doctor, and an empty pick clears just that slot.
import { useActionState } from "react";
import { setTeamStaff } from "@/lib/people-actions";
import { OK } from "@/lib/action-state";
import { STAFF_FUNCTIONS, STAFF_FUNCTION_LABEL } from "@/lib/people-domain";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { PersonPicker, type PickerPerson } from "@/components/admin/PersonPicker";
import { ui } from "@/components/admin/styles";

function StaffRow({
  tenantSlug,
  teamId,
  fn,
  people,
  currentPersonId,
  currentName,
}: {
  tenantSlug: string;
  teamId: string;
  fn: (typeof STAFF_FUNCTIONS)[number];
  people: PickerPerson[];
  currentPersonId: string | null;
  currentName: string | null;
}) {
  const [state, action] = useActionState(setTeamStaff, OK);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="function" value={fn} />
      <span className="w-36 text-sm text-score-dim">
        {STAFF_FUNCTION_LABEL[fn]}
      </span>
      <PersonPicker
        people={people}
        listId={`staff-${teamId}-${fn}`}
        defaultPersonId={currentPersonId}
        defaultText={currentName}
        placeholder="Nobody assigned"
        className={`${ui.input} w-56`}
      />
      <SubmitButton variant="secondary" pendingLabel="…">
        Save
      </SubmitButton>
      {state.error && (
        <span className="text-xs text-red-400">{state.error}</span>
      )}
    </form>
  );
}

export function TeamStaffPanel({
  tenantSlug,
  teamId,
  people,
  staff,
}: {
  tenantSlug: string;
  teamId: string;
  /** Registry coaches to autocomplete against. */
  people: PickerPerson[];
  staff: { function: string; personId: string; name: string }[];
}) {
  const byFn = new Map(staff.map((s) => [s.function, s]));
  return (
    <div className="mt-4 border-t border-border pt-3">
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-score-dim">
        Bench staff
      </h4>
      <p className="mb-3 text-xs text-score-dim">
        The head coach prints in the coach box on the official scoresheet. Clear
        a field and save to unassign.
      </p>
      <div className="space-y-2">
        {STAFF_FUNCTIONS.map((fn) => {
          const cur = byFn.get(fn);
          return (
            <StaffRow
              key={fn}
              tenantSlug={tenantSlug}
              teamId={teamId}
              fn={fn}
              people={people}
              currentPersonId={cur?.personId ?? null}
              currentName={cur?.name ?? null}
            />
          );
        })}
      </div>
    </div>
  );
}
