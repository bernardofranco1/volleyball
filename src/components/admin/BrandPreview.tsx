"use client";

// Dual light/dark brand preview (spec/23 §5.3) — used by the tenant creation
// form and the branding form so colour choices are seen against BOTH themes
// before saving. Colours are explicit values (not CSS vars): each card must
// keep its own theme regardless of the page's current toggle.
import { contrastRatio } from "@/lib/colors";

/** The two shell surfaces from globals.css (dark :root / light override). */
export const THEME_SURFACES = { dark: "#0d0d0d", light: "#ffffff" } as const;

export function BrandPreview({
  mode,
  label,
  logoUrl,
  primary,
  secondary,
}: {
  mode: "dark" | "light";
  label: string;
  logoUrl?: string | null;
  primary: string;
  secondary: string;
}) {
  const bg = THEME_SURFACES[mode];
  const fg = mode === "dark" ? "#ededed" : "#18181b";
  const border =
    mode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)";
  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ background: bg, color: fg, borderColor: border }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: border }}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-5 w-auto" />
          ) : (
            <span
              className="grid h-5 w-5 place-items-center rounded text-[10px] font-bold"
              style={{ background: primary, color: secondary }}
              aria-hidden
            >
              {(label || "T").charAt(0).toUpperCase()}
            </span>
          )}
          {label || "Title"}
        </span>
        <span className="text-[10px] opacity-60">{mode}</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-3">
        <span
          className="rounded-md px-3 py-1 text-xs font-medium"
          style={{ background: primary, color: secondary }}
        >
          Primary action
        </span>
        <span className="text-xs opacity-70">12 – 9</span>
      </div>
    </div>
  );
}

/**
 * WCAG-style advisory for a primary colour against both themes. Warns (never
 * blocks) below 3:1 — the threshold for UI components / large text.
 */
export function contrastWarnings(primary: string, secondary: string): string[] {
  const warnings: string[] = [];
  for (const mode of ["dark", "light"] as const) {
    if (contrastRatio(primary, THEME_SURFACES[mode]) < 3) {
      warnings.push(mode);
    }
  }
  if (contrastRatio(primary, secondary) < 3) warnings.push("text-on-primary");
  return warnings;
}
