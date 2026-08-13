"use client";

import { usePathname } from "next/navigation";

/**
 * Routes that are NOT the management console even though they live under the
 * tenant layout: the scorer's live console, the team tablets, the public
 * scoreboard and the public results page.
 *
 * These are touch-first or TV-first surfaces and the redesign explicitly leaves
 * them alone, so they keep the original slim top bar and get no sidebar — the
 * console frame would cost the scorer 56–224px of width on a phone held in
 * portrait.
 */
export function isConsoleRoute(pathname: string): boolean {
  return (
    pathname.endsWith("/live") ||
    pathname.includes("/team/") ||
    pathname.includes("/scoreboard/") ||
    pathname.includes("/results/")
  );
}

/**
 * Picks the chrome for the current route: the management frame (persistent
 * sidebar + mobile top bar) or the original top header for the untouched
 * touch/TV surfaces.
 *
 * A client component because layouts get no pathname in the App Router, and
 * both chromes must be decided per route under one shared layout. `usePathname`
 * resolves during SSR too, so there is no chrome flash on first paint.
 */
export function AppShell({
  sidebar,
  mobileBar,
  consoleHeader,
  children,
}: {
  sidebar: React.ReactNode;
  mobileBar: React.ReactNode;
  consoleHeader: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (isConsoleRoute(pathname)) {
    return (
      <div className="flex min-h-dvh flex-col">
        {consoleHeader}
        {/* min-h-0 so the scoring shell can fill the viewport below the bar. */}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {mobileBar}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
