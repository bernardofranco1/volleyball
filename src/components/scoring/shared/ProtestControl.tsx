"use client";

/**
 * In-match protest capture (spec/29 F12).
 *
 * A captain contests a referee decision; the fact, the team, the score and a
 * short summary are recorded so the protest protocol can be resolved
 * afterwards from the sheet. Play is unaffected — the event is a marker.
 *
 * Deliberately NOT part of the sanctions modal: a protest is not a sanction,
 * and filing it under one would misrepresent the record. Equally deliberately
 * kept apart from the result-stage PROTEST signature intent (spec/20), which
 * is a captain refusing the FINAL result; both can happen in one match.
 */
import { useState } from "react";
import type { TeamId } from "@/engine/types";
import type { PlayerLite } from "@/lib/match-provider";
import { courtRoster } from "@/lib/roster";
import { useT } from "@/lib/i18n/client";
import { ScoringModal } from "@/components/scoring/ScoringModal";
import { SecondaryButton } from "./buttons";
import { useArmedConfirm } from "./useArmedConfirm";

export type ProtestDispatch = (payload: {
  type: "PROTEST_LODGED";
  team: TeamId;
  playerId?: string;
  text?: string;
}) => void;

export function ProtestControl({
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
  dispatch: ProtestDispatch;
  pending: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<TeamId | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const { armed, tapConfirm } = useArmedConfirm();

  if (status !== "LIVE") return null;

  const name = (id: TeamId) => (id === "A" ? teamAName : teamBName);
  const roster = courtRoster(team === "A" ? rosterA : team === "B" ? rosterB : []);
  const close = () => {
    setOpen(false);
    setTeam(null);
    setPlayerId(null);
    setText("");
  };

  const record = () => {
    if (!team) return;
    dispatch({
      type: "PROTEST_LODGED",
      team,
      ...(playerId ? { playerId } : {}),
      ...(text.trim() ? { text: text.trim().slice(0, 280) } : {}),
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
          {t("protest.open")}
        </button>
      </div>

      {open ? (
        <ScoringModal title={t("protest.title")} onClose={close}>
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-score-dim">
                {t("protest.teamLabel")}
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
                  {t("protest.byLabel")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {/* The captain lodges it, so they lead the list. */}
                  {[...roster].sort((a, b) => Number(!!b.isCaptain) - Number(!!a.isCaptain)).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                        playerId === p.id
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border text-score-dim hover:text-foreground"
                      }`}
                      onClick={() => setPlayerId(p.id)}
                    >
                      {p.jerseyNumber != null ? `${p.jerseyNumber} ` : ""}
                      {p.jerseyName}
                      {p.isCaptain ? " (C)" : ""}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("protest.textPlaceholder")}
              maxLength={280}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
            />
            <p className="text-xs text-score-dim">{t("protest.explain")}</p>
            <SecondaryButton
              armed={armed === "UNDO"}
              disabled={!team || pending}
              onClick={() => tapConfirm("UNDO", record)}
            >
              {armed === "UNDO" ? t("protest.recordArmed") : t("protest.record")}
            </SecondaryButton>
          </div>
        </ScoringModal>
      ) : null}
    </>
  );
}
