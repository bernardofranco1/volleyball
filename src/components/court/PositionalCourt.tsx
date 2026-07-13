import { normalizeHex, readableTextOn } from "@/lib/colors";

/** Surname (last token) for the compact marker label; full string if single-word. */
export function surnameOf(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : full;
}

// Shared positional court (spec/08 "Court art"). Renders a real, to-proportion
// SVG court — two square halves, a centre net, Team A left / Team B right — and
// places each player as a circle marker (jersey number inside, surname under it)
// at their actual court zone. This is the Beach-court model extended to the
// rotation disciplines: the serving half darkens, the server gets a ring + ball
// badge, the libero is a hollow ring in the team colour. Discipline components
// (Indoor/Grass/Light) resolve sides + build the back/front formation, then hand
// it here; surface colours come from the per-discipline `--court-*` CSS vars so
// tenant overrides (Settings → Court colours) recolour every court.

export interface CourtSlot {
  jersey: string | number | null;
  name: string; // surname (shown under the marker)
  posLabel?: string | number; // zone / rotation number
  isServer: boolean;
  isLibero: boolean;
  present: boolean; // false → empty placeholder (incomplete lineup)
  /** Stable player identity — keys the marker so it *slides* on rotation. */
  key?: string;
}

export interface CourtTeam {
  name: string;
  color: string | null;
  serving: boolean;
  back: CourtSlot[]; // baseline row, ordered top → bottom
  front: CourtSlot[]; // net row, ordered top → bottom
}

export interface PositionalCourtProps {
  surfaceLightVar: string; // e.g. "--court-grass-light"
  surfaceDarkVar: string; // e.g. "--court-grass-dark"
  left: CourtTeam;
  right: CourtTeam;
  attackLine?: boolean; // dashed line 1/3 in from the net (3 m indoor, 2 m light)
  restraintLine?: boolean; // dashed line near the baseline (light 1 m jump-serve)
  ariaLabel: string;
  /** Hide the team-name labels under the court (they duplicate the score strip). */
  hideTeamNames?: boolean;
}

// Geometry (viewBox units). Each half is a true square (HALF_W × HALF_W) so the
// whole court is a real 2:1 rectangle — shorter, which fits phones better.
const NET_X = 160;
const COURT_X0 = 16;
const COURT_X1 = 304;
const HALF_W = NET_X - COURT_X0; // 144
const COURT_Y0 = 12;
const COURT_Y1 = COURT_Y0 + HALF_W; // 156 — each half is 144×144
const MK_Y0 = 26; // marker band top
const MK_Y1 = 148; // marker band bottom
const FRONT_DX = 26; // column offset from the net
const BACK_DX = 98; // column offset toward the baseline
const R = 12;
const NAME_Y = 172; // team-name labels (below the court)
const VB_H = 184; // viewBox height

function rowYs(n: number): number[] {
  if (n <= 0) return [];
  const range = MK_Y1 - MK_Y0;
  return Array.from({ length: n }, (_, i) => MK_Y0 + ((i + 0.5) * range) / n);
}

function Marker({
  slot,
  cx,
  cy,
  color,
}: {
  slot: CourtSlot;
  cx: number;
  cy: number;
  color: string;
}) {
  const fill = !slot.present
    ? "rgba(255,255,255,0.06)"
    : slot.isLibero
      ? "none"
      : color;
  const stroke = !slot.present
    ? "rgba(255,255,255,0.3)"
    : slot.isLibero
      ? color
      : "rgba(255,255,255,0.75)";
  const numColor = !slot.present
    ? "rgba(255,255,255,0.45)"
    : slot.isLibero
      ? color
      : readableTextOn(color);
  const label = slot.present ? (slot.jersey ?? "–") : "·";

  return (
    <g>
      {slot.isServer ? (
        <circle cx={cx} cy={cy} r={R + 2.5} fill="none" stroke="var(--primary)" strokeWidth={2.5} />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill={fill}
        stroke={stroke}
        strokeWidth={slot.isLibero ? 2.5 : 1.5}
        strokeDasharray={!slot.present ? "3 3" : undefined}
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11.5}
        fontWeight={700}
        fill={numColor}
        style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
      >
        {label}
      </text>
      {slot.posLabel != null ? (
        <text x={cx - R - 1} y={cy - R + 1} textAnchor="middle" fontSize={6.5} fill="rgba(255,255,255,0.65)">
          {slot.posLabel}
        </text>
      ) : null}
      {slot.isServer ? (
        <circle cx={cx + R - 2} cy={cy - R + 2} r={4} fill="var(--primary)" stroke="#fff" strokeWidth={1} />
      ) : null}
      {slot.isLibero ? (
        <text x={cx + R - 1} y={cy + R + 1} textAnchor="middle" fontSize={7} fontWeight={700} fill={color}>
          L
        </text>
      ) : null}
      {slot.present && slot.name ? (
        <text x={cx} y={cy + R + 8} textAnchor="middle" fontSize={7.5} fill="var(--score-active)">
          {slot.name}
        </text>
      ) : null}
    </g>
  );
}

function HalfMarkers({ team, side }: { team: CourtTeam; side: "left" | "right" }) {
  const frontX = side === "left" ? NET_X - FRONT_DX : NET_X + FRONT_DX;
  const backX = side === "left" ? NET_X - BACK_DX : NET_X + BACK_DX;
  const color = normalizeHex(team.color) ?? "#3366cc";
  // Canonical (left) order places the server (position 1) at the bottom of the
  // back column. The right half is mirrored vertically so the two servers sit
  // diagonally opposite — real-match orientation (bottom-left vs top-right).
  const front = side === "right" ? [...team.front].reverse() : team.front;
  const back = side === "right" ? [...team.back].reverse() : team.back;
  const frontYs = rowYs(front.length);
  const backYs = rowYs(back.length);
  // One <g> per player, keyed by player identity and positioned via a CSS
  // transform. On a side-out the player's target (x,y) changes and the transform
  // transition slides them from the old zone to the new one — the rotation is
  // shown, not just applied. Empty slots fall back to a positional key.
  const items = [
    ...back.map((s, i) => ({ s, x: backX, y: backYs[i], fb: `${side}-b${i}` })),
    ...front.map((s, i) => ({ s, x: frontX, y: frontYs[i], fb: `${side}-f${i}` })),
  ];
  return (
    <g>
      {items.map(({ s, x, y, fb }) => (
        <g
          key={s.key ?? fb}
          style={{
            transform: `translate(${x}px, ${y}px)`,
            transition: "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "transform",
          }}
        >
          <Marker slot={s} cx={0} cy={0} color={color} />
        </g>
      ))}
    </g>
  );
}

export function PositionalCourt({
  surfaceLightVar,
  surfaceDarkVar,
  left,
  right,
  attackLine,
  restraintLine,
  ariaLabel,
  hideTeamNames,
}: PositionalCourtProps) {
  const leftFill = `var(${left.serving ? surfaceDarkVar : surfaceLightVar})`;
  const rightFill = `var(${right.serving ? surfaceDarkVar : surfaceLightVar})`;
  const atkL = NET_X - HALF_W / 3;
  const atkR = NET_X + HALF_W / 3;
  const resL = COURT_X0 + HALF_W / 6;
  const resR = COURT_X1 - HALF_W / 6;
  // Reclaim the label band when names are hidden so the court fills the space.
  const vbH = hideTeamNames ? COURT_Y1 + 8 : VB_H;

  return (
    <svg viewBox={`0 0 320 ${vbH}`} role="img" aria-label={ariaLabel} className="mx-auto block h-auto w-full max-w-xl max-h-[48dvh]">
      {/* Court halves */}
      <rect x={COURT_X0} y={COURT_Y0} width={HALF_W} height={COURT_Y1 - COURT_Y0} fill={leftFill} stroke="rgba(255,255,255,0.55)" strokeWidth={2} />
      <rect x={NET_X} y={COURT_Y0} width={HALF_W} height={COURT_Y1 - COURT_Y0} fill={rightFill} stroke="rgba(255,255,255,0.55)" strokeWidth={2} />

      {/* Attack lines (1/3 in from the net) */}
      {attackLine ? (
        <>
          <line x1={atkL} y1={COURT_Y0} x2={atkL} y2={COURT_Y1} stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} strokeDasharray="4 4" />
          <line x1={atkR} y1={COURT_Y0} x2={atkR} y2={COURT_Y1} stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} strokeDasharray="4 4" />
        </>
      ) : null}

      {/* Service-restraint lines (light) */}
      {restraintLine ? (
        <>
          <line x1={resL} y1={COURT_Y0} x2={resL} y2={COURT_Y1} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="2 4" />
          <line x1={resR} y1={COURT_Y0} x2={resR} y2={COURT_Y1} stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="2 4" />
        </>
      ) : null}

      {/* Net + posts */}
      <line x1={NET_X} y1={COURT_Y0 - 4} x2={NET_X} y2={COURT_Y1 + 4} stroke="rgba(255,255,255,0.9)" strokeWidth={3} />
      <circle cx={NET_X} cy={COURT_Y0 - 4} r={2.5} fill="rgba(255,255,255,0.9)" />
      <circle cx={NET_X} cy={COURT_Y1 + 4} r={2.5} fill="rgba(255,255,255,0.9)" />

      <HalfMarkers team={left} side="left" />
      <HalfMarkers team={right} side="right" />

      {/* Team names + serving (hidden when the score strip already shows them) */}
      {hideTeamNames ? null : (
        <>
          <text x={(COURT_X0 + NET_X) / 2} y={NAME_Y} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--score-active)">
            {left.name}
            {left.serving ? " ●" : ""}
          </text>
          <text x={(NET_X + COURT_X1) / 2} y={NAME_Y} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--score-active)">
            {right.name}
            {right.serving ? " ●" : ""}
          </text>
        </>
      )}
    </svg>
  );
}
