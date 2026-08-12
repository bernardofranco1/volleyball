// Court colour overrides a tenant can customise. Keys are the CSS variables
// defined in globals.css; the tenant layout injects any present overrides so the
// `*-court-*` utilities re-colour. (White-label, spec/08.)
export const COURT_VARS: { key: string; label: string; fallback: string }[] = [
  { key: "--court-sand-light", label: "Beach sand (light)", fallback: "#d4b483" },
  { key: "--court-sand-dark", label: "Beach sand (dark)", fallback: "#b8964d" },
  { key: "--court-grass-light", label: "Grass (light)", fallback: "#4a7a3a" },
  { key: "--court-grass-dark", label: "Grass (dark)", fallback: "#2d5a20" },
  // Labelled by DISCIPLINE, not floor material: the platform's vocabulary is
  // Beach / Indoor / Grass / Light everywhere else, so "Hardwood" was the odd
  // one out. The KEY keeps the material name — it is a CSS variable that
  // tenants already have saved in tenant_branding.court_color_overrides, and
  // renaming it would need a data migration for something no user ever sees.
  { key: "--court-hardwood-light", label: "Indoor (light)", fallback: "#c8844a" },
  { key: "--court-hardwood-dark", label: "Indoor (dark)", fallback: "#a0622a" },
  { key: "--court-light-light", label: "Light court (light)", fallback: "#5b93c4" },
  { key: "--court-light-dark", label: "Light court (dark)", fallback: "#3f6e98" },
];
