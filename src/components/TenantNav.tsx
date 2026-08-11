"use client";

// Desktop tenant nav (spec/24 §8). Client-side purely for the active-state
// highlight — the nav had none, so every destination looked identical and there
// was no indication of where you were. Which links exist is decided server-side
// by role, so this component never sees an entry the user may not open.
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavLink {
  href: string;
  label: string;
}

/**
 * Active when the current path is the link's path or below it, so
 * /competitions/<id>/teams still highlights "Competitions". Longest match wins,
 * otherwise the dashboard (a prefix of nothing here, but /t/<slug> shapes vary)
 * could light up alongside a deeper section.
 */
export function activeHref(pathname: string, links: NavLink[]): string | null {
  const matches = links
    .filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}

export function TenantNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const active = activeHref(pathname, links);

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.href === active ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            l.href === active
              ? "bg-surface-raised font-medium text-foreground"
              : "text-score-dim hover:bg-surface-raised hover:text-foreground"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
