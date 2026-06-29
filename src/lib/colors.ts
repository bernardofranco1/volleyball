// Colour helpers for team colours (brief §1.4). Pure, dependency-free. Used to
// surface team colours and to handle clashes (e.g. a near-black colour on the
// dark UI) by always pairing the swatch with a readable, contrasting border.

/** Normalise a user colour to "#rrggbb", or null if not a valid hex. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const h = input.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return /^[0-9a-fA-F]{6}$/.test(full) ? `#${full.toLowerCase()}` : null;
}

/** sRGB relative luminance (0..1) of a hex colour. */
export function luminance(hex: string): number {
  const h = normalizeHex(hex);
  if (!h) return 0;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1..21) between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white — whichever is more readable on `bg`. */
export function readableTextOn(bg: string): string {
  return luminance(bg) > 0.45 ? "#000000" : "#ffffff";
}

/**
 * Resolve a team colour for display against a background. Returns the colour
 * (falling back to a neutral grey when unset/invalid) plus a border colour that
 * keeps it visible even when it nearly matches the background (the §1.4
 * "black-on-black" clash): a low-contrast swatch gets a readable outline.
 */
export function teamSwatch(
  color: string | null | undefined,
  against: string,
): { color: string; border: string } {
  const c = normalizeHex(color) ?? "#8a8f98";
  const border =
    contrastRatio(c, against) < 1.5 ? readableTextOn(against) : "rgba(127,127,127,0.5)";
  return { color: c, border };
}
