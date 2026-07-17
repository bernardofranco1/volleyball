import { luminance, normalizeHex } from "@/lib/colors";

// Volleyball jersey silhouette filled with a team's kit colour — the team
// identity marker on the Beach/Grass/Light scoreboard rows. Purely
// presentational: fixed 1:1 shape (viewBox 0 0 100 100), the fill is data.
// The translucent stroke keeps the silhouette legible on dark and light
// backgrounds; near-white kits flip it to a dark stroke (luminance guard).

const BODY =
  "M50 8 C42 8 36 10 30 13 L10 24 C8 25 7 28 8 31 L14 47 C15 50 18 51 21 50 " +
  "L26 48 L26 88 C26 91 28 93 31 93 L69 93 C72 93 74 91 74 88 L74 48 L79 50 " +
  "C82 51 85 50 86 47 L92 31 C93 28 92 25 90 24 L70 13 C64 10 58 8 50 8 Z";
const COLLAR =
  "M38 10 C40 18 44 22 50 22 C56 22 60 18 62 10 C58 9 54 8 50 8 C46 8 42 9 38 10 Z";

export interface JerseyMarkerProps {
  /** Body/fill colour — the team's primary kit colour. Any valid CSS colour. */
  color: string;
  /**
   * Rendered height; width is derived (1:1). A number is px; a string is any
   * CSS length (the broadcast board sizes in cqmin). Default 40.
   */
  size?: number | string;
  /** Accessible label, e.g. the team name. Rendered as <title> + aria-label. */
  label?: string;
  /** Optional extra className on the root <svg>. */
  className?: string;
}

export function JerseyMarker({ color, size = 40, label, className }: JerseyMarkerProps) {
  // Never disappear: unset/empty colours fall back to a neutral grey.
  const fill = color?.trim() ? color : "#9aa4b2";
  // Near-white kits: the translucent white stroke would vanish — go dark.
  // (Luminance is computable for hex colours; other CSS colours keep white.)
  const hex = normalizeHex(fill);
  const lightKit = hex !== null && luminance(hex) > 0.8;
  const stroke = lightKit ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.55)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={label}
      style={{ filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.4))", flexShrink: 0 }}
    >
      {label ? <title>{label}</title> : null}
      <path d={BODY} fill={fill} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
      <path d={COLLAR} fill="rgba(0,0,0,0.18)" />
    </svg>
  );
}
