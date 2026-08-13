"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeHref, type NavLink } from "@/components/TenantNav";
import {
  IconChart,
  IconGear,
  IconGrid,
  IconHome,
  IconKey,
  IconList,
  IconTrophy,
  IconUsers,
} from "@/components/ui/icons";

/**
 * Icon lookup by key rather than by passing components across the server/client
 * boundary — a component *type* can't be serialised into a client component's
 * props, and passing pre-rendered elements would make the nav config awkward to
 * filter by role on the server.
 */
const ICONS = {
  home: IconHome,
  trophy: IconTrophy,
  grid: IconGrid,
  users: IconUsers,
  gear: IconGear,
  key: IconKey,
  list: IconList,
  chart: IconChart,
} as const;

export type IconKey = keyof typeof ICONS;

export interface SidebarLink extends NavLink {
  icon: IconKey;
}

export interface SidebarGroup {
  /** Section caption; omitted for the primary (unlabelled) group. */
  label?: string;
  links: SidebarLink[];
}

/**
 * The console's persistent left navigation.
 *
 * Three widths, because a management console is used on a monitor but must not
 * become unusable on a laptop: full labels at xl and up, a 64px icon rail from
 * md to xl, and nothing below md — where the mobile top bar's ☰ takes over
 * (AppShell renders it and passes the same links).
 */
export function AppSidebar({
  brand,
  groups,
  footer,
}: {
  brand: React.ReactNode;
  groups: SidebarGroup[];
  footer: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = activeHref(
    pathname,
    groups.flatMap((g) => g.links),
  );

  return (
    <aside className="sticky top-0 hidden h-dvh w-16 flex-none flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface-raised p-2 md:flex xl:w-56 xl:p-3">
      <div className="mb-2">{brand}</div>

      {groups.map((group, i) => (
        <div key={group.label ?? `g${i}`} className="contents">
          {group.label && (
            <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-score-dim max-xl:sr-only">
              {group.label}
            </p>
          )}
          {group.links.map((l) => {
            const Icon = ICONS[l.icon];
            const on = l.href === active;
            return (
              <Link
                key={l.href}
                href={l.href}
                title={l.label}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors max-xl:justify-center ${
                  on
                    ? "bg-surface-selected font-medium text-foreground"
                    : "text-score-dim hover:bg-surface-hover hover:text-foreground"
                }`}
              >
                <Icon size={17} />
                <span className="truncate max-xl:sr-only">{l.label}</span>
              </Link>
            );
          })}
        </div>
      ))}

      <div className="mt-auto border-t border-border pt-2">{footer}</div>
    </aside>
  );
}
