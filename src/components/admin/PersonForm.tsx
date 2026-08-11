"use client";

// Create / edit a person (spec/24 §6.1). One field set for both, because the
// registry has one shape — the create form just hides the detail fields behind a
// disclosure so adding someone quickly stays a three-field job.
//
// The field list mirrors what FIVB VIS holds for a person (spec/24 §7), so a
// future push is a mapping rather than a redesign. Two of those choices are
// visible here and worth not "tidying" later:
//   - "Shirt / display name" is its own field, not a formatting of the surname.
//     VIS's equivalent is a scoreboard label; using it as a surname corrupted
//     names in production.
//   - Height/weight/reach are plain cm/kg. VIS stores thousandths; that scaling
//     belongs in the connector.
import { useActionState, useState } from "react";
import {
  createPerson,
  deletePerson,
  mergePeople,
  updatePerson,
} from "@/lib/people-actions";
import { OK } from "@/lib/action-state";
import {
  PERSON_POSITIONS,
  PERSON_ROLES,
  POSITION_LABEL,
  type PersonDetail,
  type PersonRole,
} from "@/lib/people-domain";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

const ROLE_LABEL: Record<PersonRole, string> = {
  PLAYER: "Player",
  REFEREE: "Referee",
  COACH: "Coach",
  SCORER: "Scorer",
};

function RoleChecks({ selected }: { selected: PersonRole[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  return (
    <fieldset>
      <legend className={ui.label}>Roles</legend>
      <div className="flex flex-wrap gap-2">
        {PERSON_ROLES.map((r) => (
          <label
            key={r}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm transition-colors hover:border-primary"
          >
            <input
              type="checkbox"
              name="roles"
              value={r}
              checked={picked.has(r)}
              onChange={(e) =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(r);
                  else next.delete(r);
                  return next;
                })
              }
              className="size-4 accent-[var(--color-primary)]"
            />
            {ROLE_LABEL[r]}
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-score-dim">
        A person can hold several — a coach who also referees, for instance. Roles
        decide which pickers suggest them.
      </p>
    </fieldset>
  );
}

function Detail({ person }: { person?: PersonDetail }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className={ui.label}>Gender</label>
        <select name="gender" defaultValue={person?.gender ?? ""} className={ui.select}>
          <option value="">—</option>
          <option value="M">Male</option>
          <option value="W">Female</option>
        </select>
      </div>
      <div>
        <label className={ui.label}>Date of birth</label>
        <input
          type="date"
          name="birthdate"
          defaultValue={person?.birthdate ?? ""}
          className={ui.input}
        />
        <p className="mt-1 text-xs text-score-dim">
          The field that tells two same-named players apart.
        </p>
      </div>
      <div className="sm:col-span-2">
        <label className={ui.label}>Email</label>
        <input
          name="email"
          type="email"
          defaultValue={person?.email ?? ""}
          placeholder="optional"
          className={ui.input}
        />
        <p className="mt-1 text-xs text-score-dim">
          Unique within this tenant when set, so it doubles as the strongest
          duplicate check. Leave empty for anyone without one — minors and
          players sharing a family address are normal.
          {person?.email?.endsWith("@example.invalid") && (
            <>
              {" "}
              <span className="text-amber-400">
                This is a placeholder address and can never receive mail.
              </span>
            </>
          )}
        </p>
      </div>
      <div>
        <label className={ui.label}>Federation code</label>
        <input
          name="federationCode"
          maxLength={3}
          placeholder="BRA"
          defaultValue={person?.federationCode ?? ""}
          className={`${ui.input} uppercase`}
        />
        <p className="mt-1 text-xs text-score-dim">
          Three letters, as VIS uses them.
        </p>
      </div>
      <div>
        <label className={ui.label}>Position</label>
        <select
          name="position"
          defaultValue={person?.position ?? ""}
          className={ui.select}
        >
          <option value="">—</option>
          {PERSON_POSITIONS.map((p) => (
            <option key={p} value={p}>
              {POSITION_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={ui.label}>Height (cm)</label>
        <input
          type="number"
          name="heightCm"
          min={0}
          max={280}
          defaultValue={person?.heightCm ?? ""}
          className={ui.input}
        />
      </div>
      <div>
        <label className={ui.label}>Weight (kg)</label>
        <input
          type="number"
          name="weightKg"
          min={0}
          max={250}
          defaultValue={person?.weightKg ?? ""}
          className={ui.input}
        />
      </div>
      <div>
        <label className={ui.label}>Spike reach (cm)</label>
        <input
          type="number"
          name="spikeReachCm"
          min={0}
          max={450}
          defaultValue={person?.spikeReachCm ?? ""}
          className={ui.input}
        />
      </div>
      <div>
        <label className={ui.label}>Block reach (cm)</label>
        <input
          type="number"
          name="blockReachCm"
          min={0}
          max={450}
          defaultValue={person?.blockReachCm ?? ""}
          className={ui.input}
        />
      </div>
      <div>
        <label className={ui.label}>Handedness</label>
        <select
          name="handedness"
          defaultValue={person?.handedness ?? ""}
          className={ui.select}
        >
          <option value="">Unknown</option>
          <option value="RIGHT">Right</option>
          <option value="LEFT">Left</option>
        </select>
      </div>
      <div>
        <label className={ui.label}>Referee level</label>
        <input
          name="refereeLevel"
          defaultValue={person?.refereeLevel ?? ""}
          placeholder="e.g. International"
          className={ui.input}
        />
        <p className="mt-1 text-xs text-score-dim">
          Free text until FIVB supply the referee field list.
        </p>
      </div>
      <div className="sm:col-span-2">
        <label className={ui.label}>Photo URL</label>
        <input
          name="photoUrl"
          type="url"
          defaultValue={person?.photoUrl ?? ""}
          placeholder="https://…"
          className={ui.input}
        />
      </div>
      <div>
        <label className={ui.label}>VIS person number</label>
        <input
          type="number"
          name="visPersonNo"
          min={0}
          defaultValue={person?.visPersonNo ?? ""}
          className={ui.input}
        />
        <p className="mt-1 text-xs text-score-dim">
          VIS&apos;s person <code>No</code> — the join key for a future sync. Not
          the registration number, which is a different id.
        </p>
      </div>
      <div className="sm:col-span-2">
        <label className={ui.label}>Notes</label>
        <textarea
          name="notes"
          rows={2}
          defaultValue={person?.notes ?? ""}
          className={ui.input}
        />
      </div>
    </div>
  );
}

function NameFields({ person }: { person?: PersonDetail }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className={ui.label}>First name</label>
        <input
          name="firstName"
          defaultValue={person?.firstName ?? ""}
          className={ui.input}
        />
      </div>
      <div>
        <label className={ui.label}>Last name</label>
        <input
          name="lastName"
          defaultValue={person?.lastName ?? ""}
          className={ui.input}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={ui.label}>Shirt / display name</label>
        <input
          name="displayName"
          defaultValue={person?.displayName ?? ""}
          placeholder="Defaults to the first + last name"
          className={ui.input}
        />
        <p className="mt-1 text-xs text-score-dim">
          What appears on boards and scoresheets (e.g. “Sørum, C.”). Some people
          have only this and no surname.
        </p>
      </div>
    </div>
  );
}

export function NewPersonForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, action] = useActionState(createPerson, OK);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <form action={action} className={ui.card}>
      <h2 className="mb-4 font-medium">Add a person</h2>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <NameFields />
      <div className="mt-4">
        <RoleChecks selected={["PLAYER"]} />
      </div>

      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className="mt-4 text-xs text-score-dim underline-offset-2 hover:text-foreground hover:underline"
      >
        {showDetail ? "Hide" : "Add"} details (federation, physical, VIS id)
      </button>
      {showDetail && <Detail />}

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
      {state.ok && state.message && (
        <p role="status" className="mt-3 text-sm text-emerald-400">
          {state.message} ✓
        </p>
      )}
      <div className="mt-4">
        <SubmitButton>Add person</SubmitButton>
      </div>
    </form>
  );
}

export function EditPersonForm({
  tenantSlug,
  person,
}: {
  tenantSlug: string;
  person: PersonDetail;
}) {
  const [state, action] = useActionState(updatePerson, OK);
  return (
    <form action={action} className={ui.card}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="personId" value={person.id} />
      <NameFields person={person} />
      <div className="mt-4">
        <RoleChecks selected={person.roles} />
      </div>
      <Detail person={person} />

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
      {state.ok && state.message && (
        <p role="status" className="mt-3 text-sm text-emerald-400">
          {state.message} ✓
        </p>
      )}
      <div className="mt-4">
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Fold a duplicate into this person (spec/25 §5). Deliberately explicit about
 * direction and consequence: a merge moves records and cannot be undone with a
 * click, so the button names the person being absorbed rather than saying
 * "merge".
 */
export function MergePeopleForm({
  tenantSlug,
  targetId,
  targetName,
  candidates,
}: {
  tenantSlug: string;
  targetId: string;
  targetName: string;
  candidates: {
    person: { id: string; firstName: string | null; lastName: string | null; displayName: string };
    reason: "EMAIL" | "VIS_NUMBER" | "NAME_AND_BIRTHDATE" | "NAME";
    usageCount: number;
  }[];
}) {
  const [state, action] = useActionState(mergePeople, OK);
  const REASON: Record<string, string> = {
    EMAIL: "same email — almost certainly the same person",
    VIS_NUMBER: "same VIS person number",
    NAME_AND_BIRTHDATE: "same name and date of birth",
    NAME: "same name only — check before merging",
  };

  if (candidates.length === 0) {
    return (
      <div className={ui.card}>
        <h3 className="mb-2 font-medium">Duplicates</h3>
        <p className="text-sm text-score-dim">
          No other record in this tenant looks like the same person. Matching uses
          email, VIS number, then name with date of birth.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className={ui.card}>
      <h3 className="mb-2 font-medium">Possible duplicates</h3>
      <p className="mb-3 text-sm text-score-dim">
        Merging moves the other record&apos;s roster spots, officials slots and
        staff assignments onto <strong>{targetName}</strong> and hides it. What
        was already printed on a signed scoresheet is left exactly as it was.
      </p>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="targetId" value={targetId} />
      <div className="space-y-2">
        {candidates.map((c) => (
          <label
            key={c.person.id}
            className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-surface p-2.5 text-sm transition-colors hover:border-primary"
          >
            <input
              type="radio"
              name="sourceId"
              value={c.person.id}
              className="mt-1 size-4 accent-[var(--color-primary)]"
            />
            <span>
              <span className="font-medium">
                {c.person.lastName && c.person.firstName
                  ? `${c.person.lastName}, ${c.person.firstName}`
                  : (c.person.lastName ?? c.person.firstName ?? c.person.displayName)}
              </span>
              <span className="mt-0.5 block text-xs text-score-dim">
                {REASON[c.reason]} · {c.usageCount} reference(s)
              </span>
            </span>
          </label>
        ))}
      </div>
      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
      {state.ok && state.message && (
        <p role="status" className="mt-3 text-sm text-emerald-400">
          {state.message}
        </p>
      )}
      <div className="mt-4">
        <SubmitButton variant="danger">Merge into {targetName}</SubmitButton>
      </div>
    </form>
  );
}

export function DeletePersonForm({
  tenantSlug,
  personId,
  inUse,
}: {
  tenantSlug: string;
  personId: string;
  inUse: boolean;
}) {
  const [state, action] = useActionState(deletePerson, OK);
  return (
    <form action={action} className={ui.card}>
      <h3 className="mb-2 font-medium">Delete</h3>
      <p className="mb-3 text-sm text-score-dim">
        {inUse
          ? "This person is referenced by a roster, an officials slot or a staff assignment. Remove those first — deleting would leave records pointing at nobody."
          : "Nothing references this person, so they can be removed. Records are kept; the person is hidden from pickers and the directory."}
      </p>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="personId" value={personId} />
      {state.error && <p className="mb-3 text-sm text-red-400">{state.error}</p>}
      <SubmitButton variant="danger">Delete person</SubmitButton>
    </form>
  );
}
