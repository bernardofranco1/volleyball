"use client";

import { useActionState } from "react";
import { IMPORT_INIT, type ImportState } from "@/lib/action-state";
import { useT } from "@/lib/i18n/client";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export function CsvImport({
  tenantSlug,
  competitionId,
  title,
  hint,
  action,
  templateHref,
  templateName,
}: {
  tenantSlug: string;
  competitionId: string;
  title: string;
  hint: string;
  action: (prev: ImportState, fd: FormData) => Promise<ImportState>;
  /** Optional data: URI (or path) for a downloadable CSV template. */
  templateHref?: string;
  templateName?: string;
}) {
  const t = useT();
  const [state, formAction] = useActionState(action, IMPORT_INIT);

  return (
    <form action={formAction} className={ui.card}>
      <h2 className="mb-1 font-medium">{title}</h2>
      <p className="mb-2 font-mono text-[11px] text-score-dim">{hint}</p>
      {templateHref && (
        <p className="mb-3 text-xs">
          <a
            href={templateHref}
            download={templateName ?? "template.csv"}
            className="text-score-dim underline hover:text-foreground"
          >
            {t("csv.downloadTemplate")}
          </a>
        </p>
      )}
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />

      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        className="block w-full text-sm text-score-dim file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground"
      />

      <div className="mt-3">
        <SubmitButton variant="secondary" pendingLabel={t("common.importing")}>
          {t("csv.import")}
        </SubmitButton>
      </div>

      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}

      {state.summary && (
        <div className="mt-3 text-sm">
          <p className="text-green-400">{t("csv.rowsImported", { count: state.summary.ok })}</p>
          {state.summary.errors > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-red-400">
                {t("csv.rowsSkipped", { count: state.summary.errors })}
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs text-score-dim">
                {state.summary.messages.slice(0, 25).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </form>
  );
}
