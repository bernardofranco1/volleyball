"use client";

// Assign the officials printed in the scoresheet APPROVAL block (spec/21).
// One row per FIVB role; clearing a name removes the assignment. `level` is
// what the indoor sheet prints, `country` what the beach sheet prints — both
// are captured so either sheet renders complete.

import { saveMatchOfficials, setMatchVisId } from "@/lib/match-admin-actions";
import { useT } from "@/lib/i18n/client";
import { ActionForm } from "@/components/admin/ActionForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

export const OFFICIAL_ROLE_LABELS: Record<string, string> = {
  FIRST_REFEREE: "First referee",
  SECOND_REFEREE: "Second referee",
  SCORER: "Scorer",
  ASSISTANT_SCORER: "Assistant scorer",
  THIRD_REFEREE: "Third referee",
  CHALLENGE_REFEREE: "Challenge referee",
  LINE_JUDGE_1: "Line judge 1",
  LINE_JUDGE_2: "Line judge 2",
  LINE_JUDGE_3: "Line judge 3",
  LINE_JUDGE_4: "Line judge 4",
};

/** VIS match number — the join key of the VSR live feed (spec/22). */
export function MatchVisIdForm({
  tenantSlug,
  competitionId,
  matchId,
  visId,
}: {
  tenantSlug: string;
  competitionId: string;
  matchId: string;
  visId: string | null;
}) {
  const t = useT();
  return (
    <ActionForm action={setMatchVisId} className={ui.card}>
      <h2 className="font-medium">{t("match.visIdTitle")}</h2>
      <p className="mb-3 mt-1 text-xs text-score-dim">{t("match.visIdHint")}</p>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />
      <input type="hidden" name="matchId" value={matchId} />
      <div className="flex items-end gap-2">
        <input
          name="visId"
          defaultValue={visId ?? ""}
          inputMode="numeric"
          placeholder="26665"
          className={`${ui.input} max-w-40`}
        />
        <SubmitButton pendingLabel={t("common.saving")}>
          {t("common.saveChanges")}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function MatchOfficialsForm({
  tenantSlug,
  competitionId,
  matchId,
  officials,
}: {
  tenantSlug: string;
  competitionId: string;
  matchId: string;
  officials: {
    role: string;
    name: string;
    country: string | null;
    level: string | null;
  }[];
}) {
  const t = useT();
  const byRole = new Map(officials.map((o) => [o.role, o]));
  return (
    <ActionForm action={saveMatchOfficials} className={ui.card}>
      <h2 className="font-medium">{t("match.officialsTitle")}</h2>
      <p className="mb-3 mt-1 text-xs text-score-dim">
        {t("match.officialsHint")}
      </p>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />
      <input type="hidden" name="matchId" value={matchId} />
      <div className="grid grid-cols-1 gap-2">
        <div className="hidden grid-cols-[10rem_1fr_6rem_6rem] gap-2 text-[11px] uppercase tracking-wide text-score-dim sm:grid">
          <span />
          <span>{t("common.name")}</span>
          <span>{t("common.country")}</span>
          <span>{t("match.officialLevel")}</span>
        </div>
        {Object.entries(OFFICIAL_ROLE_LABELS).map(([role, label]) => {
          const o = byRole.get(role);
          return (
            <div
              key={role}
              className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[10rem_1fr_6rem_6rem]"
            >
              <span className="text-sm text-score-dim">{label}</span>
              <input
                name={`name_${role}`}
                defaultValue={o?.name ?? ""}
                placeholder={t("common.name")}
                className={ui.input}
              />
              <input
                name={`country_${role}`}
                defaultValue={o?.country ?? ""}
                placeholder="ISO"
                className={ui.input}
              />
              <input
                name={`level_${role}`}
                defaultValue={o?.level ?? ""}
                placeholder="—"
                className={ui.input}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <SubmitButton pendingLabel={t("common.saving")}>
          {t("common.saveChanges")}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
