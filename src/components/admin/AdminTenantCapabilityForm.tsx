"use client";

// Global-admin mirror of the tenant's own capability settings (spec/24 §4, §5).
// One form here rather than the two on the tenant settings page: an operator
// setting a tenant up wants both lists in a single save, and this console has no
// tenant slug in scope — it posts a tenantId and goes through
// updateTenantConfigAsAdmin. English-only, like the rest of /admin.
import { useActionState, useState } from "react";
import { updateTenantConfigAsAdmin } from "@/lib/tenant-config-actions";
import { OK } from "@/lib/action-state";
import {
  CORE_REPORT_TYPES,
  DISCIPLINES,
  REPORT_TYPES,
  type ReportType,
} from "@/lib/domain";
import type { Discipline } from "@/engine/types";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

function useToggleSet(initial: readonly string[]) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const toggle = (value: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(value);
      else next.delete(value);
      return next;
    });
  return [picked, toggle] as const;
}

function Check({
  name,
  value,
  label,
  checked,
  onToggle,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors hover:border-primary">
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="size-4 accent-[var(--color-primary)]"
      />
      {label}
    </label>
  );
}

export function AdminTenantCapabilityForm({
  tenantId,
  config,
}: {
  tenantId: string;
  config: { enabledDisciplines: Discipline[]; enabledReportTypes: ReportType[] };
}) {
  const [state, action] = useActionState(updateTenantConfigAsAdmin, OK);
  const [disciplines, toggleDiscipline] = useToggleSet(
    config.enabledDisciplines,
  );
  const [reports, toggleReport] = useToggleSet(config.enabledReportTypes);

  return (
    <section aria-labelledby="admin-capabilities">
      <h2
        id="admin-capabilities"
        className="mb-3 text-xs font-medium uppercase tracking-wide text-score-dim"
      >
        Capabilities
      </h2>
      <form action={action} className={ui.card}>
        <input type="hidden" name="tenantId" value={tenantId} />

        <h3 className="mb-2 text-sm font-medium">Disciplines</h3>
        <p className="mb-3 text-xs text-score-dim">
          What this tenant may create competitions in. Existing competitions are
          unaffected.
        </p>
        <div className="mb-6 grid gap-2 sm:grid-cols-4">
          {DISCIPLINES.map((d) => (
            <Check
              key={d}
              name="disciplines"
              value={d}
              label={d}
              checked={disciplines.has(d)}
              onToggle={(on) => toggleDiscipline(d, on)}
            />
          ))}
        </div>

        <h3 className="mb-2 text-sm font-medium">Report types</h3>
        <p className="mb-3 text-xs text-score-dim">
          What the Reports tab offers on a finished match. At least one of the
          first three must stay enabled.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {REPORT_TYPES.map((rt) => (
            <Check
              key={rt}
              name="reportTypes"
              value={rt}
              label={
                CORE_REPORT_TYPES.includes(rt) ? rt : `${rt} (managers/scorers)`
              }
              checked={reports.has(rt)}
              onToggle={(on) => toggleReport(rt, on)}
            />
          ))}
        </div>

        {state.error && (
          <p className="mt-3 text-sm text-red-400">{state.error}</p>
        )}
        {state.ok && state.message && (
          <p role="status" className="mt-3 text-sm text-emerald-400">
            {state.message} ✓
          </p>
        )}
        <div className="mt-4">
          <SubmitButton>Save capabilities</SubmitButton>
        </div>
      </form>
    </section>
  );
}
