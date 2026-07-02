"use client";

import { useActionState } from "react";
import { verifyScorerPin } from "@/lib/scorer-pin-actions";
import { useT } from "@/lib/i18n/client";
import { OK } from "@/lib/action-state";
import { SubmitButton } from "@/components/admin/SubmitButton";

// PIN gate shown on the scorer page when a match has a PIN set (brief §5.2).
export function ScorerPinGate({
  tenantSlug,
  competitionId,
  matchId,
}: {
  tenantSlug: string;
  competitionId: string;
  matchId: string;
}) {
  const t = useT();
  const [state, action] = useActionState(verifyScorerPin, OK);
  return (
    <main className="grid min-h-[60vh] place-items-center px-6">
      <form
        action={action}
        className="w-full max-w-xs rounded-2xl border border-border bg-surface-raised p-6"
      >
        <h1 className="text-lg font-semibold">{t("scoring.pinTitle")}</h1>
        <p className="mb-4 mt-1 text-sm text-score-dim">
          {t("scoring.pinPrompt")}
        </p>
        <input type="hidden" name="matchId" value={matchId} />
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="competitionId" value={competitionId} />
        <input
          name="pin"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-primary"
        />
        {state.error && (
          <p className="mt-3 text-sm text-red-400">{state.error}</p>
        )}
        <div className="mt-4">
          <SubmitButton pendingLabel={t("scoring.checking")}>{t("scoring.unlock")}</SubmitButton>
        </div>
      </form>
    </main>
  );
}
