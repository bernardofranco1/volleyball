"use client";

// Light/dark toggle for the app UI (brief §1.3). Flips `data-theme` on <html>
// and persists a cookie the root layout reads for SSR. Icon visibility is
// CSS-driven (see globals.css) so there's no hydration mismatch or JS state.
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    document.cookie = `vbtheme=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle light/dark theme"
      title="Toggle theme"
      className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-score-dim transition-colors hover:text-foreground"
    >
      <span className="theme-icon-dark" aria-hidden>
        ☀️
      </span>
      <span className="theme-icon-light" aria-hidden>
        🌙
      </span>
    </button>
  );
}
