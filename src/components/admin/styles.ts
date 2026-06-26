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

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "border-border text-score-dim",
  ACTIVE: "border-green-500/40 text-green-400",
  FINISHED: "border-primary/40 text-primary",
  SCHEDULED: "border-border text-score-dim",
  WARMUP: "border-amber-500/40 text-amber-400",
  COIN_TOSS: "border-amber-500/40 text-amber-400",
  LIVE: "border-green-500/40 text-green-400",
  ABANDONED: "border-red-500/40 text-red-400",
};

export function statusBadgeClass(status: string): string {
  return `inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
    STATUS_STYLES[status] ?? "border-border text-score-dim"
  }`;
}
