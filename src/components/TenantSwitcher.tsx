"use client";

// Header tenant switcher (spec/23 §4). Rendered instead of the plain wordmark
// link when the signed-in user can reach more than one tenant (members of
// several tenants, or global admins — who see every tenant). Tenant context
// stays 100% URL-derived: "switching" is just navigation.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";

export interface SwitcherTenant {
  slug: string;
  label: string; // title ?? name
  logoUrl: string | null;
  roleLabel: string | null;
  url: string; // resolved server-side (subdomain or /t/slug form)
  current: boolean;
}

export function TenantSwitcher({
  current,
  tenants,
  showManage,
}: {
  current: { label: string; logoUrl: string | null; dashboardHref: string };
  tenants: SwitcherTenant[];
  showManage: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      <Link href={current.dashboardHref} className="flex items-center gap-3">
        {current.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.logoUrl} alt="" className="h-7 w-auto" />
        ) : (
          <span
            className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-fg"
            aria-hidden
          >
            {current.label.charAt(0)}
          </span>
        )}
        <span className="font-semibold">{current.label}</span>
      </Link>

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("tenantSwitcher.switch")}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md px-1 py-1 text-score-dim transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M3 4.5 6 7.5 9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-surface-raised p-1.5 shadow-xl"
        >
          {tenants.map((tn) => (
            <a
              key={tn.slug}
              role="menuitem"
              href={tn.url}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-surface ${
                tn.current ? "font-medium" : ""
              }`}
            >
              {tn.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tn.logoUrl} alt="" className="h-5 w-5 rounded object-contain" />
              ) : (
                <span
                  className="grid h-5 w-5 shrink-0 place-items-center rounded bg-primary text-[10px] font-bold text-primary-fg"
                  aria-hidden
                >
                  {tn.label.charAt(0)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{tn.label}</span>
                {tn.roleLabel && (
                  <span className="block text-xs text-score-dim">{tn.roleLabel}</span>
                )}
              </span>
              {tn.current && <span aria-hidden>✓</span>}
            </a>
          ))}
          {showManage && (
            <>
              <div className="my-1.5 border-t border-border" aria-hidden />
              <Link
                role="menuitem"
                href="/admin"
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-score-dim transition-colors hover:bg-surface hover:text-foreground"
              >
                {t("tenantSwitcher.manage")} →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
