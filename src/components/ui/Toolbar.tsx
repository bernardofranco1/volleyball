import Link from "next/link";
import { IconSearch } from "@/components/ui/icons";

/**
 * The strip above a table: search, filter chips, then right-aligned actions.
 *
 * Filters are links, not a form with an Apply button. That was the single
 * biggest interaction cost in the old match centre — three selects and a submit
 * to answer "what's live right now" — and it also meant the filtered view had
 * no URL you could keep.
 */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  );
}

/** Pushes everything after it to the right edge of the toolbar. */
export function ToolbarSpacer() {
  return <div className="flex-1" />;
}

export function FilterChip({
  href,
  active,
  label,
  count,
  dot,
}: {
  href: string;
  active: boolean;
  label: string;
  /** Rendered as a trailing tabular figure; omit when the count is unknown. */
  count?: number;
  /** Pulsing dot for the "live" chip. */
  dot?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-transparent bg-surface-selected font-medium text-foreground"
          : "border-border text-score-dim hover:bg-surface-hover hover:text-foreground"
      }`}
    >
      {dot && (
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
      )}
      {label}
      {count !== undefined && (
        <span className="font-mono tabular-nums opacity-70">{count}</span>
      )}
    </Link>
  );
}

/**
 * Free-text filter. A GET form so it works without JavaScript and lands in the
 * URL like every other filter; `carry` re-submits the params that must survive
 * a search (the ones the page is currently filtered by).
 */
export function SearchBox({
  name = "q",
  defaultValue,
  placeholder,
  carry = {},
}: {
  name?: string;
  defaultValue?: string;
  placeholder: string;
  carry?: Record<string, string | undefined>;
}) {
  return (
    <form method="get" className="flex min-w-56 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5">
      {Object.entries(carry).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <IconSearch size={15} className="flex-none text-score-dim" />
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-score-dim"
      />
    </form>
  );
}
