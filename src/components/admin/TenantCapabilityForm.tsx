"use client";

// Per-tenant capability toggles (spec/24 §4, §5): which disciplines this tenant
// may run, and which match documents its Reports tab offers. Two small forms
// rather than one, so saving report types can't silently rewrite disciplines.
import { useActionState, useState } from "react";
import {
  updateEnabledDisciplines,
  updateEnabledReportTypes,
} from "@/lib/tenant-config-actions";
import { OK } from "@/lib/action-state";
import {
  CORE_REPORT_TYPES,
  DISCIPLINES,
  REPORT_TYPES,
  REPORT_ROUTES,
  type ReportType,
} from "@/lib/domain";
import type { Discipline } from "@/engine/types";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

const DISCIPLINE_LABEL: Record<Discipline, string> = {
  BEACH: "Beach",
  INDOOR: "Indoor",
  GRASS: "Grass",
  LIGHT: "Light / Air",
};

const REPORT_LABEL: Record<ReportType, { name: string; hint: string }> = {
  OFFICIAL_SCORESHEET: {
    name: "Official e-scoresheet",
    hint: "FIVB replica sheet. Beach and indoor only — grass and light fall back to the generic scoresheet.",
  },
  SCORESHEET: {
    name: "Scoresheet",
    hint: "Generic block-structure sheet, available for every discipline.",
  },
  MATCH_REPORT: {
    name: "Match report",
    hint: "Summary report: sets, scores, officials and approval.",
  },
  EVENT_LOG: {
    name: "Event log",
    hint: "Every recorded event, in order. Managers and scorers only.",
  },
  VSR_LOG: {
    name: "VSR log",
    hint: "VolleyStation-style match log (JSON). Managers and scorers only.",
  },
  TIMINGS: {
    name: "Timings",
    hint: "Per-rally, set and break durations (JSON). Managers and scorers only.",
  },
};

function Row({
  name,
  value,
  checked,
  onToggle,
  title,
  hint,
  badge,
}: {
  name: string;
  value: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  title: string;
  hint?: string;
  badge?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-primary">
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {badge && (
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-score-dim">
              {badge}
            </span>
          )}
        </span>
        {hint && <span className="mt-1 block text-xs text-score-dim">{hint}</span>}
      </span>
    </label>
  );
}

export function DisciplinesForm({
  tenantSlug,
  enabled,
}: {
  tenantSlug: string;
  enabled: Discipline[];
}) {
  const [state, action] = useActionState(updateEnabledDisciplines, OK);
  const [picked, setPicked] = useState<Set<string>>(new Set(enabled));
  const none = picked.size === 0;

  return (
    <form action={action} className={ui.card}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <p className="mb-4 text-sm text-score-dim">
        Which disciplines this tenant can create competitions in. Turning one off
        does not affect competitions that already exist — they keep working, and
        their matches stay scoreable and reportable.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {DISCIPLINES.map((d) => (
          <Row
            key={d}
            name="disciplines"
            value={d}
            checked={picked.has(d)}
            onToggle={(on) =>
              setPicked((prev) => {
                const next = new Set(prev);
                if (on) next.add(d);
                else next.delete(d);
                return next;
              })
            }
            title={DISCIPLINE_LABEL[d]}
          />
        ))}
      </div>

      {none && (
        <p className="mt-3 text-xs text-amber-400">
          At least one discipline must stay enabled.
        </p>
      )}
      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
      {state.ok && state.message && (
        <p role="status" className="mt-3 text-sm text-emerald-400">
          {state.message} ✓
        </p>
      )}
      <div className="mt-4">
        <SubmitButton>Save disciplines</SubmitButton>
      </div>
    </form>
  );
}

export function ReportTypesForm({
  tenantSlug,
  enabled,
}: {
  tenantSlug: string;
  enabled: ReportType[];
}) {
  const [state, action] = useActionState(updateEnabledReportTypes, OK);
  const [picked, setPicked] = useState<Set<string>>(new Set(enabled));
  // Mirrors the server rule: technical exports are all optional, a match
  // document is not, or the Reports tab has nothing to show.
  const noCore = !CORE_REPORT_TYPES.some((t) => picked.has(t));

  return (
    <form action={action} className={ui.card}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <p className="mb-4 text-sm text-score-dim">
        Which documents the Reports tab offers on a finished match. The three
        match documents are available to everyone with access to the tenant; the
        technical exports stay limited to managers and scorers.
      </p>

      <div className="space-y-2">
        {REPORT_TYPES.map((rt) => (
          <Row
            key={rt}
            name="reportTypes"
            value={rt}
            checked={picked.has(rt)}
            onToggle={(on) =>
              setPicked((prev) => {
                const next = new Set(prev);
                if (on) next.add(rt);
                else next.delete(rt);
                return next;
              })
            }
            title={REPORT_LABEL[rt].name}
            hint={REPORT_LABEL[rt].hint}
            badge={REPORT_ROUTES[rt].format}
          />
        ))}
      </div>

      {noCore && (
        <p className="mt-3 text-xs text-amber-400">
          Keep at least one match report enabled (official sheet, scoresheet or
          match report), or the Reports tab will be empty.
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <SubmitButton>Save report types</SubmitButton>
        {state.message && (
          <span
            className={`text-sm ${state.ok ? "text-score-dim" : "text-red-400"}`}
          >
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
