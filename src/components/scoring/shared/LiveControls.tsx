"use client";

// Live-scoring building blocks shared by the four discipline action bars.
import { useState } from "react";
import { resolveTeamColor } from "@/lib/colors";
import { useT } from "@/lib/i18n/client";
import type { Side, TeamId } from "@/engine/types";
import { ScoringModal } from "@/components/scoring/ScoringModal";
import type { PlayerLite } from "@/lib/match-provider";
import { courtRoster } from "@/lib/roster";
import { PanelConfirm, ScoreButton, SecondaryButton, SelectRow } from "./buttons";
import type { Armed } from "./useArmedConfirm";

/**
 * The two point buttons (following court side) with the Undo + Note column
 * stacked between them.
 */
export function LiveScoreGrid({
  teamASide,
  armed,
  onPoint,
  onUndo,
  onReplay,
  onNote,
  onRallyStart,
  rallyLive,
  pending,
  teamAName,
  teamBName,
  teamAColor,
  teamBColor,
  armedPointLabel,
  confirmUndoLabel,
}: {
  teamASide: Side;
  armed: Armed;
  onPoint: (team: TeamId) => void;
  onUndo: () => void;
  /** Replay the rally (no score/serve change) — REPLAY_POINT, two-tap armed. */
  onReplay?: () => void;
  onNote: (text: string) => void;
  /** Rally gate (spec/22): between rallies the two point buttons are REPLACED
   * by one Start Rally button dispatching RALLY_START — every rally gets a
   * precise start timestamp by construction. Points appear only once the
   * rally is live. Omit to render the ungated two-button layout. */
  onRallyStart?: () => void;
  /** A RALLY_START was recorded and the rally is in progress. */
  rallyLive?: boolean;
  pending: boolean;
  teamAName: string;
  teamBName: string;
  teamAColor: string | null;
  teamBColor: string | null;
  armedPointLabel?: (teamName: string) => string;
  /** Armed label for Undo — the bars make it explicit at a fresh-set boundary
   * ("Undo last point of set N?"), where undo reopens the previous set. */
  confirmUndoLabel?: string;
}) {
  const t = useT();
  const armedLabel =
    armedPointLabel ?? ((teamName: string) => t("scoring.confirmTeam", { team: teamName }));
  const order = teamASide === "RIGHT" ? (["B", "A"] as const) : (["A", "B"] as const);
  const scoreBtn = (id: TeamId) => {
    const teamName = id === "A" ? teamAName : teamBName;
    return (
      <ScoreButton
        armed={armed === id}
        color={resolveTeamColor(id === "A" ? teamAColor : teamBColor, id)}
        onClick={() => onPoint(id)}
      >
        {armed === id ? armedLabel(teamName) : t("scoring.point", { team: teamName })}
      </ScoreButton>
    );
  };
  const controls = (
    <div className="flex flex-col justify-center gap-1.5">
      <SecondaryButton armed={armed === "UNDO"} onClick={onUndo} disabled={pending}>
        {armed === "UNDO"
          ? (confirmUndoLabel ?? t("scoring.confirmUndo"))
          : t("scoring.undo")}
      </SecondaryButton>
      {onReplay ? (
        <SecondaryButton
          armed={armed === "REPLAY"}
          onClick={onReplay}
          disabled={pending}
        >
          {armed === "REPLAY" ? t("scoring.confirmReplay") : t("scoring.replayPoint")}
        </SecondaryButton>
      ) : null}
      <SecondaryButton
        onClick={() => {
          const text = window.prompt(t("scoring.note"));
          if (text) onNote(text);
        }}
      >
        {t("scoring.note")}
      </SecondaryButton>
    </div>
  );

  // Rally gate (spec/22): between rallies ONE full-width Start Rally button
  // stands where the two point buttons will be — scoring is impossible until
  // the rally is opened, so every rally's start time is exact by construction.
  if (onRallyStart && !rallyLive) {
    return (
      <div className="grid grid-cols-[1fr_auto] items-stretch gap-2">
        <ScoreButton armed={false} color="#2b6cb0" onClick={() => onRallyStart()}>
          {t("scoring.startRally")}
        </ScoreButton>
        {controls}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
      {scoreBtn(order[0])}
      {controls}
      {scoreBtn(order[1])}
    </div>
  );
}

/** Two-column per-team row for T/O / Sub / discipline-specific controls. */
export function TeamActionsGrid({
  children,
}: {
  children: (team: TeamId) => React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["A", "B"] as const).map((t) => (
        <div key={t} className="flex flex-wrap items-center justify-center gap-1.5">
          {children(t)}
        </div>
      ))}
    </div>
  );
}

/**
 * Substitution modal shared by grass/light/indoor. `excludeIds` removes
 * liberos (indoor) from both the on-court and bench choices.
 */
export function SubPanel({
  team,
  roster,
  court,
  subsUsed,
  excludeIds = [],
  onSubstitute,
  onClose,
}: {
  team: TeamId;
  roster: PlayerLite[];
  court: string[];
  subsUsed: number;
  excludeIds?: string[];
  onSubstitute: (outPlayerId: string, inPlayerId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const onCourt = court.filter((id) => !excludeIds.includes(id));
  // courtEligible: rosters carry bench officials now (spec/29 F1), and a coach
  // is not a substitute.
  const bench = courtRoster(roster).filter(
    (p) => !court.includes(p.id) && !excludeIds.includes(p.id),
  );
  const [outId, setOutId] = useState(onCourt[0] ?? "");
  const [inId, setInId] = useState(bench[0]?.id ?? "");
  const label = (id: string) => {
    const p = roster.find((r) => r.id === id);
    return p ? `${p.jerseyNumber ?? "–"} ${p.jerseyName}` : id;
  };

  return (
    <ScoringModal title={t("scoring.subTitle", { team, used: subsUsed })} onClose={onClose}>
      <SelectRow label={t("scoring.out")} value={outId} onChange={setOutId} options={onCourt} optionLabel={label} />
      <SelectRow label={t("scoring.in")} value={inId} onChange={setInId} options={bench.map((b) => b.id)} optionLabel={label} />
      <PanelConfirm
        disabled={!outId || !inId}
        onClick={() => {
          onSubstitute(outId, inId);
          onClose();
        }}
      >
        {t("scoring.confirmSub")}
      </PanelConfirm>
    </ScoringModal>
  );
}
