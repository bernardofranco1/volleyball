"use client";

/**
 * Pre-match captain AND coach signatures (spec/21 Phase D, spec/29 F3). On the
 * paper sheet both captains sign the TEAMS block before play to attest to the
 * roster/lineup, and the beach sheet's p2 box adds the coaches; here they sign
 * on the scorer device, any time between the coin toss and the final rally. The
 * panel replaces the court zone, like the post-match sign-off. Signing is plain
 * ACCEPT — protest/refusal are post-match concepts.
 *
 * Coach rows appear only when the team actually rostered a bench official, so
 * a competition that never registers staff sees exactly the old two-row panel.
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { PlayerLite } from "@/lib/match-provider";
import { courtRoster, staffRoster } from "@/lib/roster";
import type {
  PrematchSignatureRole,
  SignatureStrokes,
} from "@/lib/match-signatures";
import { SignaturePad } from "@/components/scoring/shared/SignaturePad";
import { PrimaryButton, SecondaryButton } from "@/components/scoring/shared/buttons";
import type { ResultSignaturePolicy } from "@/engine/config";

const PREMATCH_ROLES: PrematchSignatureRole[] = [
  "TEAM_A_CAPTAIN_PREMATCH",
  "TEAM_B_CAPTAIN_PREMATCH",
  "TEAM_A_COACH_PREMATCH",
  "TEAM_B_COACH_PREMATCH",
];

/** Team A or team B, from the role name. */
const teamOf = (role: PrematchSignatureRole) =>
  role.startsWith("TEAM_A_") ? "A" : "B";
/** A coach row signs from the bench officials, a captain row from the players. */
const isCoachRole = (role: PrematchSignatureRole) => role.endsWith("_COACH_PREMATCH");

interface SignatureView {
  role: string;
  signerName: string;
  signerPlayerId: string | null;
}

export function PrematchSignOff({
  matchId,
  teamAName,
  teamBName,
  rosterA,
  rosterB,
  onClose,
}: {
  matchId: string;
  teamAName: string;
  teamBName: string;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  onClose: () => void;
}) {
  const t = useT();
  const [signatures, setSignatures] = useState<SignatureView[] | null>(null);
  const [openRole, setOpenRole] = useState<PrematchSignatureRole | null>(null);
  const [signerId, setSignerId] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<SignatureStrokes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/signatures`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { signatures?: SignatureView[] };
      setSignatures(json.signatures ?? []);
    } catch {
      setError(t("signoff.loadFailed"));
    }
  }, [matchId, t]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  const fullRosterFor = (role: PrematchSignatureRole) =>
    teamOf(role) === "A" ? rosterA : rosterB;
  /** Who may sign THIS row: the bench for a coach row, the players otherwise. */
  const rosterFor = (role: PrematchSignatureRole) => {
    const roster = fullRosterFor(role);
    return isCoachRole(role) ? staffRoster(roster) : courtRoster(roster);
  };
  const teamNameFor = (role: PrematchSignatureRole) =>
    teamOf(role) === "A" ? teamAName : teamBName;
  /** A coach row is pointless — and unsignable — with no bench official. */
  const visibleRoles = PREMATCH_ROLES.filter(
    (role) => !isCoachRole(role) || rosterFor(role).length > 0,
  );

  const openFor = (role: PrematchSignatureRole) => {
    const roster = rosterFor(role);
    const existing = signatures?.find((s) => s.role === role);
    // Coach rows pre-select the head coach (C1); captain rows the captain.
    const preferred = isCoachRole(role)
      ? (roster.find((p) => p.staffFunction === "C1") ?? roster[0])
      : (roster.find((p) => p.isCaptain) ?? roster[0]);
    setOpenRole(role);
    setSignerId(existing?.signerPlayerId ?? preferred?.id ?? null);
    setStrokes(null);
    setError(null);
  };

  const submit = async () => {
    if (!openRole || !signerId || !strokes || busy) return;
    const name = rosterFor(openRole).find((p) => p.id === signerId)?.jerseyName ?? "";
    if (name.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/signatures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: openRole,
          signerName: name,
          signerPlayerId: signerId,
          strokes,
          intent: "ACCEPT",
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? t("signoff.saveFailed"));
        return;
      }
      setOpenRole(null);
      setStrokes(null);
      await load();
    } catch {
      setError(t("signoff.offline"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <header className="text-center">
        <h2 className="text-lg font-semibold">{t("prematch.title")}</h2>
        <p className="text-xs text-score-dim">{t("prematch.subtitle")}</p>
      </header>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {visibleRoles.map((role) => {
          const sig = signatures?.find((s) => s.role === role);
          const isOpen = openRole === role;
          return (
            <li key={role} className="rounded-xl border border-border">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm">
                  <span className="font-medium">
                    {isCoachRole(role)
                      ? t("prematch.coachOf", { team: teamNameFor(role) })
                      : t("signoff.captainOf", { team: teamNameFor(role) })}
                  </span>
                  {sig ? (
                    <span className="ml-2 text-xs text-score-dim">{sig.signerName}</span>
                  ) : null}
                </span>
                {sig ? (
                  <span className="rounded-full border border-green-600/50 px-2 py-0.5 text-[11px] text-green-400">
                    {t("signoff.signed")}
                  </span>
                ) : (
                  <SecondaryButton disabled={busy} onClick={() => openFor(role)}>
                    {isOpen ? t("signoff.signing") : t("signoff.sign")}
                  </SecondaryButton>
                )}
              </div>
              {isOpen && !sig ? (
                <div className="flex flex-col gap-3 border-t border-border p-3">
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="text-score-dim">{t("signoff.signingAs")}</span>
                    <div className="flex flex-wrap gap-2">
                      {rosterFor(role).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSignerId(p.id)}
                          className={`rounded-lg border px-3 py-1.5 text-sm ${
                            signerId === p.id
                              ? "border-primary bg-primary/15 font-medium"
                              : "border-border text-score-dim"
                          }`}
                        >
                          {isCoachRole(role)
                            ? p.staffFunction
                              ? `${p.staffFunction} `
                              : ""
                            : p.jerseyNumber != null
                              ? `${p.jerseyNumber} `
                              : ""}
                          {p.jerseyName}
                          {!isCoachRole(role) && p.isCaptain ? " (C)" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                  <SignaturePad
                    value={strokes}
                    onChange={setStrokes}
                    disabled={!signerId}
                    disabledHint={t("signoff.signingAs")}
                    ariaLabel={t("signoff.padLabel", {
                      role: t("signoff.captainOf", { team: teamNameFor(role) }),
                    })}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <SecondaryButton disabled={busy} onClick={() => setOpenRole(null)}>
                      {t("signoff.cancel")}
                    </SecondaryButton>
                    <PrimaryButton
                      disabled={busy || !signerId || !strokes || strokes.strokes.length === 0}
                      onClick={() => void submit()}
                    >
                      {t("signoff.confirmSignature")}
                    </PrimaryButton>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex justify-center pb-2">
        <SecondaryButton onClick={onClose}>{t("signoff.close")}</SecondaryButton>
      </div>
    </section>
  );
}

/**
 * Console wiring: a low-key trigger (shown from the coin toss until the match
 * is over) and the panel to render in the court zone. Shared by the beach and
 * indoor consoles.
 */
export function usePrematchSignOff(opts: {
  matchId: string;
  status: string;
  policy: ResultSignaturePolicy;
  teamAName: string;
  teamBName: string;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
}): { panel: React.ReactNode | null; trigger: React.ReactNode | null } {
  const t = useT();
  const [open, setOpen] = useState(false);
  const available =
    opts.policy !== "OFF" &&
    opts.status !== "SETUP" &&
    opts.status !== "FINISHED";

  const panel =
    available && open ? (
      <PrematchSignOff
        matchId={opts.matchId}
        teamAName={opts.teamAName}
        teamBName={opts.teamBName}
        rosterA={opts.rosterA}
        rosterB={opts.rosterB}
        onClose={() => setOpen(false)}
      />
    ) : null;

  const trigger = available ? (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 text-xs text-score-dim underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
      >
        {open ? t("signoff.close") : t("prematch.open")}
      </button>
    </div>
  ) : null;

  return { panel, trigger };
}
