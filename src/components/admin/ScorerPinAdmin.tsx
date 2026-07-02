"use client";

import { useActionState } from "react";
import { generateScorerPin } from "@/lib/scorer-pin-actions";
import { OK } from "@/lib/action-state";
import { useT } from "@/lib/i18n/client";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { ui } from "@/components/admin/styles";

// Admin control on the match detail page to set/rotate the scorer PIN (§5.2).
export function ScorerPinAdmin({
  tenantSlug,
  competitionId,
  matchId,
  pin,
}: {
  tenantSlug: string;
  competitionId: string;
  matchId: string;
  pin: string | null;
}) {
  const t = useT();
  const [state, action] = useActionState(generateScorerPin, OK);
  return (
    <form
      action={action}
      className={ui.card}
      onSubmit={(e) => {
        if (pin && !window.confirm(t("match.pinRotateConfirm")))
          e.preventDefault();
      }}
    >
      <h2 className="mb-1 font-medium">{t("scoring.pinTitle")}</h2>
      <p className="mb-3 text-[11px] text-score-dim">
        {t("match.pinHint")}
      </p>
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="competitionId" value={competitionId} />
      <div className="mb-3 font-mono text-3xl font-bold tracking-[0.3em]">
        {pin ?? "——————"}
      </div>
      {state.error && <p className="mb-2 text-sm text-red-400">{state.error}</p>}
      {state.ok && state.message && (
        <p role="status" className="mb-2 text-sm text-emerald-400">
          {state.message}
        </p>
      )}
      <SubmitButton variant="secondary" pendingLabel={t("common.generating")}>
        {pin ? t("match.rotatePin") : t("match.generatePin")}
      </SubmitButton>
      {pin && (
        <p className="mt-2 text-[11px] text-score-dim">
          {t("match.pinRotateNote")}
        </p>
      )}
    </form>
  );
}
