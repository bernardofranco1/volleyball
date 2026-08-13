// Shared Tailwind class strings for the admin surfaces, so every form/table
// looks the same and tweaks land in one place. (Uses the design tokens from
// globals.css — border-border, bg-surface(-raised), text-score-dim, primary.)
export const ui = {
  card: "rounded-xl border border-border bg-surface-raised p-5",
  label:
    "block text-xs font-medium uppercase tracking-wide text-score-dim mb-1.5",
  input:
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary",
  select:
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary",
  btnPrimary:
    "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-50",
  btnSecondary:
    "inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm text-score-dim transition-colors hover:text-foreground",
  btnDanger:
    "inline-flex items-center justify-center rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/10",
  th: "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-score-dim",
  td: "px-3 py-2 text-sm",
} as const;

// Status badges read from the semantic tokens (--success/--warning/--danger)
// rather than Tailwind's palette literals, so the same three meanings tint
// consistently and follow the light/dark theme. Tinted fill instead of a
// coloured hairline: at 10px a border alone was doing all the work of telling
// LIVE from SCHEDULED across a 50-row table.
const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-surface-3 text-score-dim",
  ACTIVE: "bg-success-soft text-success",
  FINISHED: "bg-primary/15 text-primary",
  SCHEDULED: "bg-surface-3 text-score-dim",
  WARMUP: "bg-warning-soft text-warning",
  COIN_TOSS: "bg-warning-soft text-warning",
  LIVE: "bg-success-soft text-success",
  PENDING_CONFIRMATION: "bg-warning-soft text-warning",
  ABANDONED: "bg-danger-soft text-danger",
};

export function statusBadgeClass(status: string): string {
  return `inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
    STATUS_STYLES[status] ?? "bg-surface-3 text-score-dim"
  }`;
}

/** Short human label for a match status badge (raw enum is fine except the
 *  verbose pending one). Pass a translator for a localized pending label. */
export function matchStatusLabel(
  status: string,
  pendingLabel = "PENDING",
): string {
  return status === "PENDING_CONFIRMATION" ? pendingLabel : status;
}
