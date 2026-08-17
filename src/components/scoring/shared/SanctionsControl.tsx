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
import type { SanctionAutoPoint } from "@/engine/config";
import { useT } from "@/lib/i18n/client";
import type { PlayerLite } from "@/lib/match-provider";
import { courtRoster, staffRoster } from "@/lib/roster";
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
      }
    // The consequence half (spec/29 F14): the point a penalty awards is an
    // ORDINARY rally event, so set/match ends, side switches and undo all keep
    // working untouched. `causedBy` is informational only.
    | { type: "RALLY_WON_A" | "RALLY_WON_B"; causedBy?: string }
    // An expelled member leaving a team unable to field a complete six ends the
    // SET, not the match (FIVB 7.3.1).
    | { type: "SET_DEFAULT"; team: TeamId; reason: "INCOMPLETE_TEAM" | "OTHER" },
) => void;

/** Sanctions that award a point + service to the opponent (FIVB 21.3). */
const PENALTY_KINDS: SanctionType[] = [
  "DELAY_PENALTY",
  "MISCONDUCT_PENALTY",
  "MISCONDUCT_EXPULSION",
  "MISCONDUCT_DISQUALIFICATION",
];

/** Severity order, for the escalation guard (FIVB 21.3: cards never go down). */
const SEVERITY: Record<string, number> = {
  MISCONDUCT_WARNING: 1,
  MISCONDUCT_PENALTY: 2,
  MISCONDUCT_EXPULSION: 3,
  MISCONDUCT_DISQUALIFICATION: 4,
};

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
  autoPoint = "PROMPT",
  misconductA = [],
  misconductB = [],
}: {
  status: string;
  teamAName: string;
  teamBName: string;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  dispatch: SanctionDispatch;
  pending: boolean;
  /** What to do about the point a penalty awards (spec/29 F14). */
  autoPoint?: SanctionAutoPoint;
  /** Cards already held, per team — drives the escalation warning. */
  misconductA?: { type: string; playerId: string }[];
  misconductB?: { type: string; playerId: string }[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<TeamId | null>(null);
  const [kind, setKind] = useState<SanctionType | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  // After recording a penalty the modal stays open on a second step offering
  // the consequence, so the score cannot drift from the sanction. Nothing is
  // dispatched unasked (unless the competition is configured AUTO).
  const [awarded, setAwarded] = useState<{
    to: TeamId;
    expulsion: boolean;
  } | null>(null);
  const { armed, tapConfirm } = useArmedConfirm();

  if (status === "SETUP" || status === "FINISHED") return null;

  const name = (id: TeamId) => (id === "A" ? teamAName : teamBName);
  const roster = team === "A" ? rosterA : team === "B" ? rosterB : [];
  // Split, not filtered: misconduct reaches both, and `playerId` carries either
  // — a bench official's roster-row id IS a players.id, so the event payload
  // needed no widening (spec/29 §Revalidation §2).
  const players = courtRoster(roster);
  const staff = staffRoster(roster);
  const needsPlayer = kind != null && MISCONDUCT.includes(kind);

  const close = () => {
    setOpen(false);
    setTeam(null);
    setKind(null);
    setPlayerId(null);
    setAwarded(null);
  };

  const held = team === "A" ? misconductA : team === "B" ? misconductB : [];
  /**
   * FIVB 21.3: a member's sanctions escalate; the same or a lower card is
   * almost always a mis-tap. Warn, never block — the referee's decision is
   * the authority, and the scorer records what was signalled.
   */
  const escalationWarning =
    kind && playerId && SEVERITY[kind]
      ? (() => {
          const worst = Math.max(
            0,
            ...held
              .filter((m) => m.playerId === playerId)
              .map((m) => SEVERITY[m.type] ?? 0),
          );
          return worst >= SEVERITY[kind] ? worst : 0;
        })()
      : 0;

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

  const awardPoint = (to: TeamId) =>
    dispatch({ type: to === "A" ? "RALLY_WON_A" : "RALLY_WON_B" });

  const record = () => {
    if (!team || !kind) return;
    if (needsPlayer) {
      if (!playerId) return;
      dispatch({ type: kind as (typeof MISCONDUCT)[number] & SanctionType, team, playerId } as Parameters<SanctionDispatch>[0]);
    } else {
      dispatch({ type: kind as "DELAY_WARNING" | "DELAY_PENALTY" | "IMPROPER_REQUEST", team });
    }

    // The sanction itself never scores — the paper procedure records the fact
    // and the point is a separate act. What changes here is only whether the
    // console offers to make that second act one tap (spec/29 F14).
    const opponent: TeamId = team === "A" ? "B" : "A";
    const isPenalty = PENALTY_KINDS.includes(kind);
    if (!isPenalty || autoPoint === "OFF") {
      close();
      return;
    }
    if (autoPoint === "AUTO") {
      awardPoint(opponent);
      close();
      return;
    }
    setAwarded({
      to: opponent,
      // An expulsion can leave a team unable to field a complete six; the
      // console offers the set default rather than making the scorer hunt for
      // it while the hall waits.
      expulsion:
        kind === "MISCONDUCT_EXPULSION" ||
        kind === "MISCONDUCT_DISQUALIFICATION",
    });
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

      {open && awarded ? (
        // Step 2 (spec/29 F14): the sanction is already recorded. This is the
        // consequence, offered rather than assumed — the scorer can walk away
        // and tap the point as an ordinary rally, exactly as before.
        <ScoringModal title={t("sanctions.consequenceTitle")} onClose={close}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-score-dim">
              {t("sanctions.consequenceExplain", { team: name(awarded.to) })}
            </p>
            <SecondaryButton
              disabled={pending}
              onClick={() => {
                awardPoint(awarded.to);
                close();
              }}
            >
              {t("sanctions.awardPoint", { team: name(awarded.to) })}
            </SecondaryButton>
            {awarded.expulsion ? (
              <>
                <p className="text-xs text-score-dim">
                  {t("sanctions.incompleteExplain")}
                </p>
                <SecondaryButton
                  armed={armed === "SET_DEFAULT"}
                  disabled={pending}
                  onClick={() =>
                    tapConfirm("SET_DEFAULT", () => {
                      // The team that lost the member defaults the set.
                      const loser: TeamId = awarded.to === "A" ? "B" : "A";
                      dispatch({
                        type: "SET_DEFAULT",
                        team: loser,
                        reason: "INCOMPLETE_TEAM",
                      });
                      close();
                    })
                  }
                >
                  {armed === "SET_DEFAULT"
                    ? t("sanctions.setDefaultArmed")
                    : t("sanctions.setDefault", {
                        team: name(awarded.to === "A" ? "B" : "A"),
                      })}
                </SecondaryButton>
              </>
            ) : null}
            <button
              type="button"
              onClick={close}
              className="px-2 py-1 text-xs text-score-dim underline decoration-dotted underline-offset-2"
            >
              {t("sanctions.consequenceSkip")}
            </button>
          </div>
        </ScoringModal>
      ) : open ? (
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
                {/* Players and bench officials are both sanctionable (FIVB 21.3
                    — a coach takes cards like anyone else), and the sheet's
                    sanctions grid has a column for each. Two groups rather than
                    one list: a coach has no jersey number, so mixed into the
                    numbered chips they read as an unnumbered player. */}
                <div className="flex flex-wrap gap-2">
                  {players.map((p) => (
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
                {staff.length > 0 ? (
                  <>
                    <p className="mb-1.5 mt-3 text-xs uppercase tracking-wide text-score-dim">
                      {t("sanctions.benchLabel")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {staff.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={choice(playerId === p.id)}
                          onClick={() => setPlayerId(p.id)}
                        >
                          {p.staffFunction ? `${p.staffFunction} ` : ""}
                          {p.jerseyName}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {escalationWarning > 0 ? (
              // Not a block: the referee's signal is the authority, and a
              // repeat card is legal in edge cases. But an accidental
              // down-grade is far more likely than a deliberate one.
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {t("sanctions.escalationWarning")}
              </p>
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
