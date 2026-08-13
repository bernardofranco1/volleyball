import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Page frame for the management console.
 *
 * The old pages each pinned themselves to `max-w-5xl` (1024px) — a phone layout
 * with wider margins, leaving roughly 45% of a 1920px monitor as empty gutter.
 * Content now runs to 1600px, which is where a dense table stops gaining from
 * extra width and line lengths start to hurt.
 */
export function Page({
  children,
  width = "wide",
}: {
  children: ReactNode;
  /** `narrow` (768px) is for genuinely single-column reading, e.g. a form. */
  width?: "wide" | "narrow";
}) {
  return (
    <main
      className={`mx-auto w-full px-4 py-6 md:px-6 md:py-7 ${
        width === "wide" ? "max-w-[1600px]" : "max-w-3xl"
      }`}
    >
      {children}
    </main>
  );
}

export interface Crumb {
  href: string;
  label: string;
}

/**
 * Page header: breadcrumb, title, optional status/meta, and right-aligned
 * actions. Replaces the ad-hoc "h1 + back-to-dashboard link" every page grew
 * its own version of — a back link is redundant once the sidebar is persistent,
 * but knowing where you are in a nested competition was not.
 */
export function PageHeader({
  title,
  crumbs,
  meta,
  badge,
  actions,
}: {
  title: ReactNode;
  crumbs?: Crumb[];
  /** Sub-line under the title — counts, dates, "updated 20s ago". */
  meta?: ReactNode;
  /** Inline next to the title, e.g. a status pill. */
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-score-dim">
            {crumbs.map((c) => (
              <span key={c.href} className="flex items-center gap-1.5">
                <Link href={c.href} className="hover:text-foreground">
                  {c.label}
                </Link>
                <span aria-hidden>/</span>
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">
            {title}
          </h1>
          {badge}
        </div>
        {meta && <p className="mt-1 text-sm text-score-dim">{meta}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/**
 * Headline number with a caption — the dashboard's and competition overview's
 * "answer the obvious question first" row.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
  href?: string;
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "";
  const body = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-score-dim">
        {label}
      </div>
      <div
        className={`mt-0.5 text-2xl font-semibold tracking-tight tabular-nums ${toneCls}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-xs text-score-dim">{hint}</div>}
    </>
  );
  const cls =
    "rounded-xl border border-border bg-surface-raised px-4 py-3 min-w-0";
  return href ? (
    <Link href={href} className={`${cls} block transition-colors hover:border-primary`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Equal-width tile row that wraps rather than squashing on a laptop. */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
  );
}

/** Panel with a small caption — the card format the console still uses. */
export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-surface-raised p-4 ${className}`}
    >
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
