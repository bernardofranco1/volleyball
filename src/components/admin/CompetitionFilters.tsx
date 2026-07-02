"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { DISCIPLINES, COMPETITION_STATUSES } from "@/lib/domain";
import { useT } from "@/lib/i18n/client";
import { ui } from "@/components/admin/styles";

/**
 * Filter bar for the competitions list: selects apply immediately, the search
 * box applies on Enter/blur (debounced typing would refetch too eagerly for a
 * server-rendered list). State lives in the URL so filters survive reloads.
 */
export function CompetitionFilters({
  discipline,
  status,
  q,
}: {
  discipline?: string;
  status?: string;
  q?: string;
}) {
  const t = useT();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const apply = () => {
    const fd = new FormData(formRef.current!);
    const params = new URLSearchParams();
    for (const key of ["discipline", "status", "q"] as const) {
      const v = String(fd.get(key) ?? "").trim();
      if (v) params.set(key, v);
    }
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?");
  };

  return (
    <form
      ref={formRef}
      className="mb-4 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="min-w-40 flex-1">
        <label className={ui.label} htmlFor="f-q">
          {t("common.search")}
        </label>
        <input
          id="f-q"
          name="q"
          type="search"
          defaultValue={q ?? ""}
          placeholder={t("comp.searchPlaceholder")}
          className={ui.input}
          onBlur={apply}
        />
      </div>
      <div>
        <label className={ui.label} htmlFor="f-discipline">
          {t("common.discipline")}
        </label>
        <select
          id="f-discipline"
          name="discipline"
          defaultValue={discipline ?? ""}
          className={ui.select}
          onChange={apply}
        >
          <option value="">{t("common.all")}</option>
          {DISCIPLINES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={ui.label} htmlFor="f-status">
          {t("common.status")}
        </label>
        <select
          id="f-status"
          name="status"
          defaultValue={status ?? ""}
          className={ui.select}
          onChange={apply}
        >
          <option value="">{t("common.all")}</option>
          {COMPETITION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {(discipline || status || q) && (
        <button
          type="button"
          className={ui.btnSecondary}
          onClick={() => router.push("?")}
        >
          {t("common.clear")}
        </button>
      )}
    </form>
  );
}
