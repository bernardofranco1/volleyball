"use client";

// Pick an existing person, or type a new name (spec/24 §6.2/§6.3).
//
// A native <datalist> rather than a bespoke dropdown: it autocompletes, works on
// touch, needs no keyboard-navigation code, and still leaves the field free-text
// so adding someone who isn't in the registry yet stays one action instead of
// "go to People, create, come back".
//
// Submits two fields: `personId` when the text resolves to a known person, and
// the raw text as `personName`. The server action prefers the id and creates a
// person from the name otherwise — so a typo becomes a new person an admin can
// merge, never a silent attachment to the wrong human.
import { useMemo, useState } from "react";
import { ui } from "@/components/admin/styles";

export interface PickerPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  jerseyName: string;
  federationCode: string | null;
}

/** Label shown in the list. Kept unique so the reverse lookup is unambiguous. */
function labelFor(p: PickerPerson): string {
  const spoken =
    p.lastName && p.firstName
      ? `${p.lastName}, ${p.firstName}`
      : (p.lastName ?? p.firstName ?? p.jerseyName);
  return p.federationCode ? `${spoken} (${p.federationCode})` : spoken;
}

export function PersonPicker({
  people,
  idField = "personId",
  nameField = "personName",
  placeholder = "Search or type a new name…",
  listId,
  defaultPersonId,
  defaultText,
  className,
  required = false,
}: {
  people: PickerPerson[];
  idField?: string;
  nameField?: string;
  placeholder?: string;
  /** Must be unique on the page — several pickers can render at once. */
  listId: string;
  defaultPersonId?: string | null;
  /**
   * Text to show when `defaultPersonId` doesn't resolve — e.g. an official whose
   * person holds a different role than this slot suggests, so they aren't in
   * `people`. Without it the field would render empty and saving would wipe a
   * name that was already on the scoresheet.
   */
  defaultText?: string | null;
  className?: string;
  required?: boolean;
}) {
  const byLabel = useMemo(() => {
    const m = new Map<string, PickerPerson>();
    for (const p of people) {
      let label = labelFor(p);
      // Two people can share a label; disambiguate so a pick is never ambiguous.
      if (m.has(label)) label = `${label} · ${p.jerseyName}`;
      let n = 2;
      while (m.has(label)) label = `${labelFor(p)} · ${n++}`;
      m.set(label, p);
    }
    return m;
  }, [people]);

  const resolved = defaultPersonId
    ? [...byLabel.entries()].find(([, p]) => p.id === defaultPersonId)?.[0]
    : undefined;
  const [text, setText] = useState(resolved ?? defaultText ?? "");
  const matched = byLabel.get(text.trim());

  return (
    <span className="inline-flex min-w-0 flex-col gap-0.5">
      <input
        name={nameField}
        value={text}
        onChange={(e) => setText(e.target.value)}
        list={listId}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className={className ?? ui.input}
      />
      {/* Only the resolved id is submitted; absent means "create from the name". */}
      <input type="hidden" name={idField} value={matched?.id ?? ""} />
      <datalist id={listId}>
        {[...byLabel.keys()].map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      {text.trim() && !matched && (
        <span className="text-[10px] text-amber-400">New person</span>
      )}
    </span>
  );
}
