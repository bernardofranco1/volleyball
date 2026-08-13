import Link from "next/link";

export interface SettingsSection {
  key: string;
  href: string;
  label: string;
  hint?: string;
}

/**
 * Section list for settings-shaped pages: one section on screen at a time
 * instead of five stacked in a 768px column.
 *
 * Server-rendered links rather than client tabs, so a section is a URL — which
 * is what makes "go to Settings → Branding" something you can send to someone.
 */
export function SettingsNav({
  sections,
  active,
}: {
  sections: SettingsSection[];
  active: string;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto md:w-48 md:flex-none md:flex-col md:overflow-visible">
      {sections.map((s) => (
        <Link
          key={s.key}
          href={s.href}
          aria-current={s.key === active ? "page" : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
            s.key === active
              ? "bg-surface-selected font-medium text-foreground"
              : "text-score-dim hover:bg-surface-hover hover:text-foreground"
          }`}
        >
          {s.label}
          {s.hint && (
            <span className="mt-0.5 hidden text-xs font-normal text-score-dim md:block">
              {s.hint}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
