"use client";

/**
 * Medical recovery entry point (spec/29 F11, spec/30 Phase F).
 *
 * Rule 17.1.2 (Official Volleyball Rules 2025-2028): an injured or ill player
 * who cannot be substituted legally or exceptionally is given a 3-minute
 * recovery, "but not more than once for the same player in the match". If they
 * do not recover, the team is declared incomplete — which is the SET_DEFAULT
 * the sanctions flow already offers.
 *
 * The event existed with no way to write it: spec/29 F11 added the payload, the
 * per-player tally and the printing, and spec/30 Phase F added enforcement, but
 * nothing in any console ever dispatched a MEDICAL_TIMEOUT with a player. That
 * is the same shape as the bug spec/30 R2 documented — a rule implemented
 * everywhere except where a human could reach it — so the writer ships with the
 * enforcement rather than after it.
 *
 * Naming the player is REQUIRED wherever the limit is enforced: the cap is
 * per player, so an anonymous recovery cannot be counted against it. Where no
 * limit is configured (beach/grass/light, whose rulebooks have not been
 * verified) the pick stays optional and the recovery is simply recorded.
 */
import { useState } from "react";
import type { TeamId } from "@/engine/types";
import type { PlayerLite } from "@/lib/match-provider";
import { courtRoster } from "@/lib/roster";
import { useT } from "@/lib/i18n/client";
import { ScoringModal } from "@/components/scoring/ScoringModal";
import { SecondaryButton } from "./buttons";
import { useArmedConfirm } from "./useArmedConfirm";

export type RecoveryDispatch = (payload: {
  type: "MEDICAL_TIMEOUT";
  team: TeamId;
  playerId?: string;
}) => void;

export function RecoveryControl({
  status,
  rallyPhase,
  teamAName,
  teamBName,
  rosterA,
  rosterB,
  dispatch,
  pending,
  /** Rule 17.1.2 cap, or null where no verified source sets one. */
  recoveryLimit,
  /** Recoveries already taken, by roster-row id. */
  recoveriesByPlayer = {},
}: {
  status: string;
  rallyPhase: string;
  teamAName: string;
  teamBName: string;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  dispatch: RecoveryDispatch;
  pending: boolean;
  recoveryLimit: number | null;
  recoveriesByPlayer?: Record<string, number>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<TeamId | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const { armed, tapConfirm } = useArmedConfirm();

  // Only while play is live and not already inside a recovery.
  if (status !== "LIVE" || rallyPhase === "MEDICAL_TIMEOUT_ACTIVE") return null;

  const name = (id: TeamId) => (id === "A" ? teamAName : teamBName);
  const roster = courtRoster(team === "A" ? rosterA : team === "B" ? rosterB : []);
  const usedBy = (id: string) => recoveriesByPlayer[id] ?? 0;
  const exhausted = (id: string) =>
    recoveryLimit != null && usedBy(id) >= recoveryLimit;

  const close = () => {
    setOpen(false);
    setTeam(null);
    setPlayerId(null);
  };

  // Where a limit applies the player must be named — the cap is per player, so
  // an anonymous recovery could never be counted against it.
  const needsPlayer = recoveryLimit != null;
  const canRecord =
    !!team && (!needsPlayer || (!!playerId && !exhausted(playerId))) && !pending;

  const record = () => {
    if (!team || !canRecord) return;
    dispatch({
      type: "MEDICAL_TIMEOUT",
      team,
      ...(playerId ? { playerId } : {}),
    });
    close();
  };

  return (
    <>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-2 py-1 text-xs text-score-dim underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
        >
          {t("recovery.open")}
        </button>
      </div>

      {open ? (
        <ScoringModal title={t("recovery.title")} onClose={close}>
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-score-dim">
                {t("recovery.teamLabel")}
              </p>
              <div className="flex gap-2">
                {(["A", "B"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      team === id
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border text-score-dim hover:text-foreground"
                    }`}
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

            {team ? (
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-score-dim">
                  {needsPlayer ? t("recovery.playerLabel") : t("recovery.playerOptional")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {roster.map((p) => {
                    const spent = exhausted(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={spent}
                        title={spent ? t("recovery.alreadyUsed") : undefined}
                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                          playerId === p.id
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border text-score-dim hover:text-foreground"
                        } ${spent ? "opacity-40 line-through" : ""}`}
                        onClick={() => setPlayerId(p.id)}
                      >
                        {p.jerseyNumber != null ? `${p.jerseyNumber} ` : ""}
                        {p.jerseyName}
                        {/* The count is shown, not just enforced: a scorer who
                            can see it coming is not surprised by the refusal. */}
                        {usedBy(p.id) > 0 ? ` · ${usedBy(p.id)}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <p className="text-xs text-score-dim">
              {recoveryLimit != null
                ? t("recovery.explainLimited", { n: recoveryLimit })
                : t("recovery.explain")}
            </p>
            <SecondaryButton
              armed={armed === "UNDO"}
              disabled={!canRecord}
              onClick={() => tapConfirm("UNDO", record)}
            >
              {armed === "UNDO" ? t("recovery.recordArmed") : t("recovery.record")}
            </SecondaryButton>
          </div>
        </ScoringModal>
      ) : null}
    </>
  );
}
