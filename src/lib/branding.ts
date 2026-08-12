import type { Discipline } from "@/engine/types";

// Court colour overrides a tenant can customise. Keys are the CSS variables
// defined in globals.css; the tenant layout injects any present overrides so the
// `*-court-*` utilities re-colour. (White-label, spec/08.)
export const COURT_VARS: {
  key: string;
  label: string;
  fallback: string;
  /** Which discipline's court this colours — drives the per-tenant filter. */
  discipline: Discipline;
}[] = [
  { key: "--court-sand-light", label: "Beach sand (light)", fallback: "#d4b483", discipline: "BEACH" },
  { key: "--court-sand-dark", label: "Beach sand (dark)", fallback: "#b8964d", discipline: "BEACH" },
  { key: "--court-grass-light", label: "Grass (light)", fallback: "#4a7a3a", discipline: "GRASS" },
  { key: "--court-grass-dark", label: "Grass (dark)", fallback: "#2d5a20", discipline: "GRASS" },
  // Labelled by DISCIPLINE, not floor material: the platform's vocabulary is
  // Beach / Indoor / Grass / Light everywhere else, so "Hardwood" was the odd
  // one out. The KEY keeps the material name — it is a CSS variable that
  // tenants already have saved in tenant_branding.court_color_overrides, and
  // renaming it would need a data migration for something no user ever sees.
  { key: "--court-hardwood-light", label: "Indoor (light)", fallback: "#c8844a", discipline: "INDOOR" },
  { key: "--court-hardwood-dark", label: "Indoor (dark)", fallback: "#a0622a", discipline: "INDOOR" },
  { key: "--court-light-light", label: "Light court (light)", fallback: "#5b93c4", discipline: "LIGHT" },
  { key: "--court-light-dark", label: "Light court (dark)", fallback: "#3f6e98", discipline: "LIGHT" },
];

/**
 * The swatches worth showing a tenant: only the disciplines they actually run
 * (spec/24 §2.1). An indoor-only club has no use for beach sand or grass, and
 * a picker full of irrelevant colours reads as clutter. Falls back to all of
 * them when the config is missing, matching resolveTenantConfig's "no row means
 * everything is enabled".
 */
export function courtVarsFor(enabled: readonly Discipline[] | undefined) {
  if (!enabled || enabled.length === 0) return COURT_VARS;
  return COURT_VARS.filter((v) => enabled.includes(v.discipline));
}
