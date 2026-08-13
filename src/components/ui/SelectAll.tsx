"use client";

/**
 * Header checkbox that ticks every row checkbox in the same form.
 *
 * The selection itself is plain HTML — each row is an `<input name="id">`
 * inside a GET form pointed at the CSV route — so selecting rows and exporting
 * them needs no client state at all. This one control is the only piece that
 * genuinely can't be expressed in markup.
 */
export function SelectAll({ label }: { label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="accent-primary"
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        for (const el of Array.from(
          form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="id"]'),
        )) {
          el.checked = e.currentTarget.checked;
        }
      }}
    />
  );
}
