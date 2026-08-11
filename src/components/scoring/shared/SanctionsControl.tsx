"use client";

/**
 * Sanctions entry point (spec/21): delay warnings/penalties, misconduct cards
 * and the improper request — the events the official scoresheet's sanction
 * boxes print. Until now they existed only at the API level; this gives the
 * scorer a low-key trigger (like ForfeitControl) opening a modal that walks
 * team → sanction → player (for misconduct) with a two-tap armed confirm.
 *
 * The sanction event only records the fact at the current score; any point it
 * carries (a delay/misconduct PENALTY awards the rally to the opponent) is
 * still tapped as a normal point, exactly like the paper procedure.
 */

import { useState } from "react";
import type { TeamId } from "@/engine/types";
import { useT } from "@/lib/i18n/client";
import type { PlayerLite } from "@/lib/match-provider";
import { ScoringModal } from "@/components/scoring/ScoringModal";
import { SecondaryButton } from "./buttons";
import { useArmedConfirm } from "./useArmedConfirm";

type SanctionType =
  | "DELAY_WARNING"
  | "DELAY_PENALTY"
  | "IMPROPER_REQUEST"
  | "MISCONDUCT_WARNING"
  | "MISCONDUCT_PENALTY"
  | "MISCONDUCT_EXPULSION"
  | "MISCONDUCT_DISQUALIFICATION";

export type SanctionDispatch = (
  payload:
    | { type: "DELAY_WARNING" | "DELAY_PENALTY" | "IMPROPER_REQUEST"; team: TeamId }
    | {
        type:
          | "MISCONDUCT_WARNING"
          | "MISCONDUCT_PENALTY"
          | "MISCONDUCT_EXPULSION"
          | "MISCONDUCT_DISQUALIFICATION";
        team: TeamId;
        playerId: string;
      },
) => void;

const TEAM_SANCTIONS: SanctionType[] = [
  "DELAY_WARNING",
  "DELAY_PENALTY",
  "IMPROPER_REQUEST",
];
const MISCONDUCT: SanctionType[] = [
  "MISCONDUCT_WARNING",
  "MISCONDUCT_PENALTY",
  "MISCONDUCT_EXPULSION",
  "MISCONDUCT_DISQUALIFICATION",
];

export function SanctionsControl({
  status,
  teamAName,
  teamBName,
  rosterA,
  rosterB,
  dispatch,
  pending,
}: {
  status: string;
  teamAName: string;
  teamBName: string;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  dispatch: SanctionDispatch;
  pending: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<TeamId | null>(null);
  const [kind, setKind] = useState<SanctionType | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const { armed, tapConfirm } = useArmedConfirm();

  if (status === "SETUP" || status === "FINISHED") return null;

  const name = (id: TeamId) => (id === "A" ? teamAName : teamBName);
  const roster = team === "A" ? rosterA : team === "B" ? rosterB : [];
  const needsPlayer = kind != null && MISCONDUCT.includes(kind);

  const close = () => {
    setOpen(false);
    setTeam(null);
    setKind(null);
    setPlayerId(null);
  };

  const kindLabel = (k: SanctionType) =>
    ({
      DELAY_WARNING: t("sanctions.delayWarning"),
      DELAY_PENALTY: t("sanctions.delayPenalty"),
      IMPROPER_REQUEST: t("sanctions.improperRequest"),
      MISCONDUCT_WARNING: t("sanctions.misconductWarning"),
      MISCONDUCT_PENALTY: t("sanctions.misconductPenalty"),
      MISCONDUCT_EXPULSION: t("sanctions.misconductExpulsion"),
      MISCONDUCT_DISQUALIFICATION: t("sanctions.misconductDisqualification"),
    })[k];

  const canRecord = !!team && !!kind && (!needsPlayer || !!playerId) && !pending;

  const record = () => {
    if (!team || !kind) return;
    if (needsPlayer) {
      if (!playerId) return;
      dispatch({ type: kind as (typeof MISCONDUCT)[number] & SanctionType, team, playerId } as Parameters<SanctionDispatch>[0]);
    } else {
      dispatch({ type: kind as "DELAY_WARNING" | "DELAY_PENALTY" | "IMPROPER_REQUEST", team });
    }
    close();
  };

  const choice = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-sm transition-colors ${
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
          {t("scoring.sanctionsOpen")}
        </button>
      </div>

      {open ? (
        <ScoringModal title={t("sanctions.title")} onClose={close}>
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-score-dim">
                {t("scoring.forfeitTeamLabel")}
              </p>
              <div className="flex gap-2">
                {(["A", "B"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`flex-1 ${choice(team === id)}`}
                    onClick={() => {
                      setTeam(id);
                      setPlayerId(null);
                    }}
                  >
                    {name(id)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-score-dim">
                {t("sanctions.typeLabel")}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[...TEAM_SANCTIONS, ...MISCONDUCT].map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={choice(kind === k)}
                    onClick={() => setKind(k)}
                  >
                    {kindLabel(k)}
                  </button>
                ))}
              </div>
            </div>

            {needsPlayer ? (
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-score-dim">
                  {t("sanctions.playerLabel")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {roster.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={choice(playerId === p.id)}
                      onClick={() => setPlayerId(p.id)}
                    >
                      {p.jerseyNumber != null ? `${p.jerseyNumber} ` : ""}
                      {p.jerseyName}
                    </button>
                  ))}
                  {team && roster.length === 0 ? (
                    <span className="text-xs text-red-300">{t("signoff.noRoster")}</span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <p className="text-xs text-score-dim">{t("sanctions.explain")}</p>
            <SecondaryButton
              armed={armed === "UNDO"}
              disabled={!canRecord}
              onClick={() => tapConfirm("UNDO", record)}
            >
              {armed === "UNDO" ? t("sanctions.recordArmed") : t("sanctions.record")}
            </SecondaryButton>
          </div>
        </ScoringModal>
      ) : null}
    </>
  );
}
