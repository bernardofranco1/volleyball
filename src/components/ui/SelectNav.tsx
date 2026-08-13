"use client";

import { useRouter } from "next/navigation";

/**
 * A filter <select> that navigates on change.
 *
 * Status filters are chips (few, stable, worth a click target each); a tenant's
 * competition list is neither, so it stays a select — but it must behave like
 * the chips do, filtering the moment you pick rather than waiting for an Apply
 * button. `hrefFor` is built by the page so the other active filters survive.
 */
export function SelectNav({
  value,
  options,
  hrefFor,
  label,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  /** URL for a chosen value; "" means "no filter". */
  hrefFor: Record<string, string>;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => router.push(hrefFor[e.target.value] ?? "")}
      className={className}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
