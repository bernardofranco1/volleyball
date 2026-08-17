"use client";

/**
 * Positional-fault entry point (spec/29 F13), shared by all four bars.
 *
 * Two things, in the order a referee actually does them:
 *
 * 1. RECORD the fault — a rotation fault (rotation disciplines) or a service
 *    order fault (beach) — and award the point, which is an ordinary rally
 *    event. Same shape as a sanction's consequence (F14).
 *
 * 2. LATE DISCOVERY: when the fault is spotted some rallies after it began,
 *    the points the faulting team scored while at fault are cancelled. The
 *    OPPONENT keeps everything they scored in that window, which is why this
 *    is a batch of targeted undos on the server and not a rewind — a rewind
 *    would erase both teams' points alike.
 *
 * Guard rails per spec/19's conventions: a two-tap arm, a mandatory reason,
 * and the number of points about to disappear stated before the second tap.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import type { TeamId } from "@/engine/types";
import { cancelFaultPointsAction } from "@/lib/match-admin-actions";
import { cancelledEventIds } from "@/lib/event-survival";
import { OK } from "@/lib/action-state";
import { useT } from "@/lib/i18n/client";
import { ScoringModal } from "@/components/scoring/ScoringModal";
import { SecondaryButton } from "./buttons";
import { useArmedConfirm } from "./useArmedConfirm";

export type FaultDispatch = (
  payload:
    | { type: "ROTATION_FAULT" | "SERVICE_ORDER_FAULT"; team: TeamId; note?: string }
    | { type: "RALLY_WON_A" | "RALLY_WON_B"; causedBy?: string },
) => void;

/** One entry of the log the scorer picks the fault moment from. */
interface FaultLogEntry {
  sequence: number;
  team: TeamId;
  label: string;
}

export function FaultCorrection({
  matchId,
  status,
  rotationEnabled,
  teamAName,
  teamBName,
  setNumber,
  dispatch,
  pending,
}: {
  matchId: string;
  status: string;
  /** Decides which fault this discipline can have — same test the engine uses. */
  rotationEnabled: boolean;
  teamAName: string;
  teamBName: string;
  /** Current set — the correction window never crosses a set boundary. */
  setNumber: number;
  dispatch: FaultDispatch;
  pending: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<TeamId | null>(null);
  const [since, setSince] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const { armed, tapConfirm } = useArmedConfirm();
  const [state, action] = useActionState(cancelFaultPointsAction, OK);
  const formRef = useRef<HTMLFormElement>(null);
  const [recentPoints, setRecentPoints] = useState<FaultLogEntry[]>([]);

  // The candidate moments are rally events, which live in the log rather than
  // in match state — fetched when the modal opens (like the scoring-log
  // overlay does) so the four consoles need no new props, and never while the
  // panel is closed.
  useEffect(() => {
    if (!open) return;
    let aborted = false;
    void (async () => {
      try {
        const res = await fetch(`/api/matches/${matchId}/events`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          events?: {
            id: string;
            sequence: number;
            eventType: string;
            setNumber: number | null;
            scoreAfterA: number | null;
            scoreAfterB: number | null;
            payload?: unknown;
          }[];
        };
        if (aborted) return;
        const all = json.events ?? [];
        // Rallies already cancelled by an earlier correction are not offered:
        // the server excludes them from what it cancels, so listing them here
        // would show the scorer a count larger than what actually happens
        // (spec/30 Phase D).
        const gone = cancelledEventIds(all);
        const points = all
          .filter(
            (e) =>
              (e.eventType === "RALLY_WON_A" || e.eventType === "RALLY_WON_B") &&
              e.setNumber === setNumber &&
              !gone.has(e.id),
          )
          .map((e) => ({
            sequence: e.sequence,
            team: (e.eventType === "RALLY_WON_A" ? "A" : "B") as TeamId,
            label: `${e.scoreAfterA ?? "?"}:${e.scoreAfterB ?? "?"}`,
          }));
        // Newest first: a late-discovered fault is nearly always recent.
        setRecentPoints(points.reverse().slice(0, 40));
      } catch {
        // Offline or mid-deploy: the late-discovery half simply stays hidden.
      }
    })();
    return () => {
      aborted = true;
    };
  }, [open, matchId, setNumber]);

  // A completed cancellation is REPORTED rather than silently closing the
  // panel: the scorer has just removed points from the official record and the
  // count is worth seeing. Derived from the action result — no effect, and so
  // no cascading render.
  const done = state.ok ? state.message : null;

  if (status !== "LIVE") return null;

  const faultType = rotationEnabled ? "ROTATION_FAULT" : "SERVICE_ORDER_FAULT";
  const name = (id: TeamId) => (id === "A" ? teamAName : teamBName);
  const close = () => {
    setOpen(false);
    setTeam(null);
    setSince("");
    setReason("");
  };

  /** How many of the faulting team's points sit at or after the chosen moment. */
  const doomed =
    team && since !== ""
      ? recentPoints.filter((e) => e.sequence >= since && e.team === team).length
      : 0;

  const recordNow = () => {
    if (!team) return;
    dispatch({ type: faultType, team });
    // The point the fault awards: an ordinary rally to the opponent.
    dispatch({ type: team === "A" ? "RALLY_WON_B" : "RALLY_WON_A" });
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
          {t(rotationEnabled ? "fault.openRotation" : "fault.openServiceOrder")}
        </button>
      </div>

      {open ? (
        <ScoringModal
          title={t(rotationEnabled ? "fault.titleRotation" : "fault.titleServiceOrder")}
          onClose={close}
        >
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wide text-score-dim">
                {t("fault.teamLabel")}
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
                    onClick={() => setTeam(id)}
                  >
                    {name(id)}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-score-dim">{t("fault.explain")}</p>
            <SecondaryButton disabled={!team || pending} onClick={recordNow}>
              {t("fault.recordAndAward", {
                team: team ? name(team === "A" ? "B" : "A") : "",
              })}
            </SecondaryButton>

            {done ? (
              <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-300">
                {done}
              </p>
            ) : recentPoints.length > 0 ? (
              <form
                ref={formRef}
                action={action}
                className="flex flex-col gap-2 border-t border-border pt-3"
              >
                <p className="text-xs uppercase tracking-wide text-score-dim">
                  {t("fault.lateTitle")}
                </p>
                <p className="text-xs text-score-dim">{t("fault.lateExplain")}</p>
                <input type="hidden" name="matchId" value={matchId} />
                <input type="hidden" name="team" value={team ?? ""} />
                <input type="hidden" name="fromSequence" value={since} />
                <input type="hidden" name="reason" value={reason} />
                <select
                  value={since}
                  onChange={(e) =>
                    setSince(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                >
                  <option value="">{t("fault.pickMoment")}</option>
                  {recentPoints.map((e) => (
                    <option key={e.sequence} value={e.sequence}>
                      {t("fault.momentOption", {
                        team: name(e.team),
                        score: e.label,
                      })}
                    </option>
                  ))}
                </select>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("fault.reasonPlaceholder")}
                  maxLength={200}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                />
                {state.error ? (
                  <p role="alert" className="text-xs text-red-400">
                    {state.error}
                  </p>
                ) : null}
                {/* The count is the whole point of the two-tap: the scorer sees
                    exactly how much of the record is about to change. */}
                <SecondaryButton
                  armed={armed === "UNDO"}
                  disabled={!team || since === "" || reason.trim().length < 3 || pending}
                  onClick={() =>
                    tapConfirm("UNDO", () => formRef.current?.requestSubmit())
                  }
                >
                  {armed === "UNDO"
                    ? t("fault.cancelArmed", { n: doomed })
                    : t("fault.cancelPoints", { n: doomed })}
                </SecondaryButton>
              </form>
            ) : null}
          </div>
        </ScoringModal>
      ) : null}
    </>
  );
}
