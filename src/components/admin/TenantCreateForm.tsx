"use client";

// Tenant creation form (spec/23 §3.2) — global-admin console, English-only.
// Live preview renders the tenant header chrome in BOTH light and dark mode so
// colour choices are checked against each theme before the tenant exists.
import { useActionState, useState } from "react";
import { createTenant } from "@/lib/tenant-admin-actions";
import { OK } from "@/lib/action-state";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { BrandPreview, contrastWarnings } from "@/components/admin/BrandPreview";
import { ui } from "@/components/admin/styles";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function TenantCreateForm() {
  const [state, action] = useActionState(createTenant, OK);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [primary, setPrimary] = useState("#0066cc");
  const [secondary, setSecondary] = useState("#ffffff");

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className={ui.card}>
        <div className="space-y-4">
          <div>
            <label className={ui.label}>Name *</label>
            <input
              name="name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              placeholder="e.g. Lisbon Beach League"
              className={ui.input}
            />
          </div>
          <div>
            <label className={ui.label}>Slug * (immutable — part of every URL)</label>
            <input
              name="slug"
              required
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="lisbon-beach-league"
              className={`${ui.input} font-mono`}
            />
          </div>
          <div>
            <label className={ui.label}>Subdomain (optional)</label>
            <input
              name="subdomain"
              placeholder="lisbon"
              className={`${ui.input} font-mono`}
            />
            <p className="mt-1 text-xs text-score-dim">
              Becomes <span className="font-mono">subdomain.yourdomain.com</span>{" "}
              once a custom domain is configured. Until then the /t/slug URL is
              used.
            </p>
          </div>
          <div>
            <label className={ui.label}>Title (shown instead of “Volleyball Scoring”)</label>
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lisbon League Scoring"
              className={ui.input}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={ui.label}>Primary colour</label>
              <input
                name="primaryColor"
                type="color"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface"
              />
            </div>
            <div>
              <label className={ui.label}>Text on primary</label>
              <input
                name="secondaryColor"
                type="color"
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface"
              />
            </div>
          </div>
        </div>

        {state.error && <p className="mt-4 text-sm text-red-400">{state.error}</p>}

        <div className="mt-5">
          <SubmitButton pendingLabel="Creating…">Create tenant</SubmitButton>
        </div>
      </div>

      <div className="space-y-3">
        <p className={ui.label}>Live preview</p>
        <BrandPreview
          mode="dark"
          label={title || name}
          primary={primary}
          secondary={secondary}
        />
        <BrandPreview
          mode="light"
          label={title || name}
          primary={primary}
          secondary={secondary}
        />
        {contrastWarnings(primary, secondary).length > 0 && (
          <p className="text-xs text-amber-400">
            ⚠ Low contrast ({contrastWarnings(primary, secondary).join(", ")}) —
            consider a stronger colour pair.
          </p>
        )}
        <p className="text-xs text-score-dim">
          Logo upload, fonts and court colours are configured after creation
          (tenant Settings → Branding, or from the tenant&apos;s console page).
        </p>
      </div>
    </form>
  );
}
