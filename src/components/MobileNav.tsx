"use client";

import Link from "next/link";
import { useState } from "react";

// Mobile-only nav: collapses the menu behind a ☰ button at the top-left so
// phones don't spend a whole UI row on the nav. The expanded panel uses slim
// rows (about half the old row height). Hidden at md+ where the inline bar
// takes over. Labels are resolved server-side and passed in.
export function MobileNav({
  links,
  menuLabel,
}: {
  links: { href: string; label: string }[];
  menuLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={menuLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-lg text-score-dim transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        {/* three-line menu glyph */}
        <span className="relative block h-3 w-5" aria-hidden>
          <span className="absolute left-0 top-0 h-0.5 w-5 rounded-full bg-current" />
          <span className="absolute left-0 top-[5px] h-0.5 w-5 rounded-full bg-current" />
          <span className="absolute left-0 top-[10px] h-0.5 w-5 rounded-full bg-current" />
        </span>
      </button>

      {open && (
        <>
          {/* Tap-away scrim, below the panel. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <nav className="absolute left-0 right-0 top-full z-40 flex flex-col border-b border-border bg-surface shadow-lg">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="px-4 py-1.5 text-sm text-score-dim transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
