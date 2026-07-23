"use client";

// Forfeit / retirement entry point (FIVB rule 6.4), shared by all four bars.
// Renders a deliberately low-key trigger; the modal makes the consequences
// explicit (team, reason, "opponent wins") and the confirm is two-tap armed.
// Available from COIN_TOSS (a no-show default is recorded before any toss)
// through LIVE; hidden once the match is finished. The FORFEIT event itself is
// undoable like any scorer action.
import { useState } from "react";
import type { TeamId } from "@/engine/types";
import type { ForfeitReason } from "@/engine/core/baseReducer";
import { useT } from "@/lib/i18n/client";
import { ScoringModal } from "@/components/scoring/ScoringModal";
import { SecondaryButton } from "./buttons";
import { useArmedConfirm } from "./useArmedConfirm";

export function ForfeitControl({
  status,
  teamAName,
  teamBName,
  dispatch,
  pending,
}: {
  status: string;
  teamAName: string;
  teamBName: string;
  dispatch: (payload: {
    type: "FORFEIT";
    team: TeamId;
    reason: ForfeitReason;
  }) => void;
  pending: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<TeamId | null>(null);
  const [reason, setReason] = useState<ForfeitReason | null>(null);
  const { armed, tapConfirm } = useArmedConfirm();

  if (status === "SETUP" || status === "FINISHED") return null;

  const name = (id: TeamId) => (id === "A" ? teamAName : teamBName);
  const close = () => {
    setOpen(false);
    setTeam(null);
    setReason(null);
  };
  const record = () => {
    if (!team || !reason) return;
    dispatch({ type: "FORFEIT", team, reason });
    close();
  };

  const choice = (active: boolean) =>
    `flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
      active
        ? "border-primary bg-primary/15 text-foreground"
        : "border-border text-score-dim hover:text-foreground"
    }`;

  return (
    <>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-2 py-1 text-xs text-score-dim underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
        >
          {t("scoring.forfeitOpen")}
        </button>
      </div>

      {open ? (
        <ScoringModal title={t("scoring.forfeitTitle")} onClose={close}>
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-score-dim">
                {t("scoring.forfeitTeamLabel")}
              </p>
              <div className="flex gap-2">
                {(["A", "B"] as const).map((id) => (
                  <button key={id} type="button" className={choice(team === id)} onClick={() => setTeam(id)}>
                    {name(id)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-score-dim">
                {t("scoring.forfeitReasonLabel")}
              </p>
              <div className="flex flex-col gap-2">
                <button type="button" className={choice(reason === "FORFEIT")} onClick={() => setReason("FORFEIT")}>
                  {t("scoring.forfeitReasonForfeit")}
                </button>
                <button type="button" className={choice(reason === "RETIREMENT")} onClick={() => setReason("RETIREMENT")}>
                  {t("scoring.forfeitReasonRetirement")}
                </button>
              </div>
            </div>
            <p className="text-xs text-score-dim">{t("scoring.forfeitExplain")}</p>
            <SecondaryButton
              armed={armed === "UNDO"}
              disabled={!team || !reason || pending}
              onClick={() => tapConfirm("UNDO", record)}
            >
              {armed === "UNDO" && team
                ? t("scoring.forfeitRecordArmed", {
                    opponent: name(team === "A" ? "B" : "A"),
                  })
                : t("scoring.forfeitRecord")}
            </SecondaryButton>
          </div>
        </ScoringModal>
      ) : null}
    </>
  );
}
