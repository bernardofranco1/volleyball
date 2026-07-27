"use client";

/**
 * Post-match scoresheet sign-off (spec/20), rendered in the middle of the
 * scorer console in place of the court: both team captains and the 1st referee
 * sign on this one device, in any order. The third signature confirms the
 * result and locks the match.
 *
 * Everything here is deliberately explicit about WHAT is being signed: the
 * result recap stays on screen, and every signature is posted with the digest
 * the panel was opened with — if the score moved in between, the server rejects
 * it and the panel reloads with the affected signatures marked "sign again".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { PlayerLite } from "@/lib/match-provider";
import type {
  SignatureIntent,
  SignatureRole,
  SignatureStrokes,
} from "@/lib/match-signatures";
import { SignaturePad } from "@/components/scoring/shared/SignaturePad";
import { PrimaryButton, SecondaryButton } from "@/components/scoring/shared/buttons";
import { useSignOffStatus } from "@/components/scoring/shared/useSignOff";
import type { ResultSignaturePolicy } from "@/engine/config";

interface SignatureView {
  role: SignatureRole;
  signerName: string;
  signerPlayerId: string | null;
  intent: SignatureIntent;
  remarks: string | null;
  signedAt: string;
  hasStrokes: boolean;
}

interface ProgressView {
  policy: "REQUIRED" | "OPTIONAL" | "OFF";
  digest: string | null;
  sequence: number;
  complete: boolean;
  missing: SignatureRole[];
  stale: SignatureRole[];
  officials: { role: string; name: string }[];
  signatures: SignatureView[];
}

const ROLES: SignatureRole[] = [
  "TEAM_A_CAPTAIN",
  "TEAM_B_CAPTAIN",
  "FIRST_REFEREE",
];

export function ResultSignOff({
  matchId,
  teamAName,
  teamBName,
  rosterA,
  rosterB,
  sets,
  setsWonA,
  setsWonB,
  winner,
  onClose,
  onConfirmed,
}: {
  matchId: string;
  teamAName: string;
  teamBName: string;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  sets: { setNumber: number; scoreA: number; scoreB: number }[];
  setsWonA: number;
  setsWonB: number;
  winner: "A" | "B" | null;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<ProgressView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openRole, setOpenRole] = useState<SignatureRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Draft state for the row being signed.
  const [strokes, setStrokes] = useState<SignatureStrokes | null>(null);
  const [signerId, setSignerId] = useState<string | null>(null);
  const [refName, setRefName] = useState("");
  const [intent, setIntent] = useState<SignatureIntent>("ACCEPT");
  const [remarks, setRemarks] = useState("");
  const confirmedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/signatures`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as ProgressView;
      setData(json);
      setLoadError(null);
      if (json.complete && !confirmedRef.current) {
        confirmedRef.current = true;
        onConfirmed();
      }
    } catch {
      setLoadError(t("signoff.loadFailed"));
    }
  }, [matchId, onConfirmed, t]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  const rosterFor = (role: SignatureRole) =>
    role === "TEAM_A_CAPTAIN" ? rosterA : rosterB;

  const openFor = (role: SignatureRole) => {
    const existing = data?.signatures.find((s) => s.role === role);
    const roster = rosterFor(role);
    setOpenRole(role);
    setError(null);
    setStrokes(null);
    setIntent("ACCEPT");
    setRemarks("");
    if (role === "FIRST_REFEREE") {
      // Pre-filled when the name already came with the match data (officials
      // import) or from an earlier signature; otherwise the pad stays disabled
      // until a name is typed.
      const official = data?.officials.find((o) => o.role === "FIRST_REFEREE");
      setRefName(existing?.signerName ?? official?.name ?? "");
      setSignerId(null);
    } else {
      const captain = roster.find((p) => p.isCaptain) ?? roster[0];
      setSignerId(existing?.signerPlayerId ?? captain?.id ?? null);
      setRefName("");
    }
  };

  const signerName = (): string => {
    if (openRole === "FIRST_REFEREE") return refName.trim();
    const roster = openRole ? rosterFor(openRole) : [];
    return roster.find((p) => p.id === signerId)?.fullName ?? "";
  };

  const canSubmit = (): boolean => {
    if (!openRole || busy) return false;
    if (signerName().length < 2) return false;
    if (intent === "REFUSED") return remarks.trim().length >= 3;
    if (!strokes || strokes.strokes.length === 0) return false;
    if (intent === "PROTEST") return remarks.trim().length >= 3;
    return true;
  };

  const submit = async () => {
    if (!openRole || !canSubmit()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/signatures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: openRole,
          signerName: signerName(),
          signerPlayerId: openRole === "FIRST_REFEREE" ? null : signerId,
          strokes: intent === "REFUSED" ? null : strokes,
          intent,
          remarks: remarks.trim() || null,
          expectedDigest: data?.digest ?? null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        confirmed?: boolean;
      };
      if (!res.ok) {
        setError(json.error ?? t("signoff.saveFailed"));
        // A digest conflict means the result moved — reload so the panel shows
        // which signatures went stale.
        if (res.status === 409) await load();
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

  const clearSignature = async (role: SignatureRole) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/matches/${matchId}/signatures?role=${role}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? t("signoff.saveFailed"));
        return;
      }
      await load();
    } catch {
      setError(t("signoff.offline"));
    } finally {
      setBusy(false);
    }
  };

  const roleLabel = (role: SignatureRole) =>
    role === "FIRST_REFEREE"
      ? t("signoff.firstReferee")
      : t("signoff.captainOf", {
          team: role === "TEAM_A_CAPTAIN" ? teamAName : teamBName,
        });

  const winnerName = winner === "A" ? teamAName : winner === "B" ? teamBName : "—";

  if (data?.complete) {
    const signed = data.signatures;
    return (
      <section className="flex h-full flex-col gap-3 overflow-y-auto p-3">
        <div className="rounded-xl border border-green-600/40 bg-green-500/10 p-4 text-center">
          <h2 className="text-lg font-semibold">{t("signoff.confirmedTitle")}</h2>
          <p className="mt-1 text-sm text-score-dim">{t("signoff.confirmedBody")}</p>
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {signed.map((s) => (
            <li
              key={s.role}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span>
                <span className="text-score-dim">{roleLabel(s.role)}:</span>{" "}
                <span className="font-medium">{s.signerName}</span>
                {s.intent !== "ACCEPT" ? (
                  <span className="ml-2 rounded border border-amber-500/50 px-1.5 py-0.5 text-[11px] text-amber-400">
                    {s.intent === "PROTEST"
                      ? t("signoff.protestNote")
                      : t("signoff.refusedNote")}
                  </span>
                ) : null}
              </span>
              <span aria-hidden>✓</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex justify-center pb-2">
          <PrimaryButton onClick={onClose}>{t("signoff.close")}</PrimaryButton>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <header className="text-center">
        <h2 className="text-lg font-semibold">{t("signoff.title")}</h2>
        <p className="text-xs text-score-dim">{t("signoff.subtitle")}</p>
      </header>

      {/* What is being signed — always on screen. */}
      <div className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-center text-sm">
        <div className="font-medium">
          {teamAName} {setsWonA} : {setsWonB} {teamBName}
        </div>
        <div className="text-xs text-score-dim">
          {sets.map((s) => `${s.scoreA}-${s.scoreB}`).join(" · ")}
          {winner ? ` · ${t("signoff.winner", { team: winnerName })}` : ""}
        </div>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {loadError}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            {t("signoff.retry")}
          </button>
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {ROLES.map((role) => {
          const sig = data?.signatures.find((s) => s.role === role);
          const isStale = data?.stale.includes(role) ?? false;
          const done = !!sig && !isStale;
          const isOpen = openRole === role;
          return (
            <li key={role} className="rounded-xl border border-border">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm">
                  <span className="font-medium">{roleLabel(role)}</span>
                  {done ? (
                    <span className="ml-2 text-xs text-score-dim">{sig!.signerName}</span>
                  ) : null}
                </span>
                <span className="flex flex-none items-center gap-2">
                  {done ? (
                    <>
                      <span className="rounded-full border border-green-600/50 px-2 py-0.5 text-[11px] text-green-400">
                        {sig!.intent === "REFUSED"
                          ? t("signoff.refusedNote")
                          : sig!.intent === "PROTEST"
                            ? t("signoff.protestNote")
                            : t("signoff.signed")}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void clearSignature(role)}
                        className="rounded-lg border border-border px-2 py-1 text-[11px] text-score-dim disabled:opacity-40"
                      >
                        {t("signoff.redo")}
                      </button>
                    </>
                  ) : (
                    <>
                      {isStale ? (
                        <span className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-400">
                          {t("signoff.stale")}
                        </span>
                      ) : null}
                      <SecondaryButton disabled={busy} onClick={() => openFor(role)}>
                        {isOpen ? t("signoff.signing") : t("signoff.sign")}
                      </SecondaryButton>
                    </>
                  )}
                </span>
              </div>

              {isOpen ? (
                <div className="flex flex-col gap-3 border-t border-border p-3">
                  {role === "FIRST_REFEREE" ? (
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-score-dim">{t("signoff.refName")}</span>
                      <input
                        value={refName}
                        onChange={(e) => setRefName(e.target.value)}
                        autoComplete="off"
                        maxLength={120}
                        className="rounded-lg border border-border bg-surface px-3 py-2"
                        placeholder={t("signoff.refNamePlaceholder")}
                      />
                    </label>
                  ) : (
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
                            {p.jerseyNumber != null ? `${p.jerseyNumber} ` : ""}
                            {p.fullName}
                            {p.isCaptain ? " (C)" : ""}
                          </button>
                        ))}
                        {rosterFor(role).length === 0 ? (
                          <span className="text-xs text-red-300">
                            {t("signoff.noRoster")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}

                  <SignaturePad
                    value={strokes}
                    onChange={setStrokes}
                    disabled={
                      intent === "REFUSED" ||
                      (role === "FIRST_REFEREE" && refName.trim().length < 2)
                    }
                    disabledHint={
                      intent === "REFUSED"
                        ? t("signoff.refusedPad")
                        : t("signoff.refNameHint")
                    }
                    ariaLabel={t("signoff.padLabel", { role: roleLabel(role) })}
                  />

                  {/* Protest / refusal are statements of record: they must say why. */}
                  <div className="flex flex-wrap gap-2">
                    {(["ACCEPT", "PROTEST", "REFUSED"] as SignatureIntent[]).map((it) => (
                      <button
                        key={it}
                        type="button"
                        onClick={() => setIntent(it)}
                        className={`rounded-lg border px-3 py-1.5 text-xs ${
                          intent === it
                            ? "border-primary bg-primary/15 font-medium"
                            : "border-border text-score-dim"
                        }`}
                      >
                        {it === "ACCEPT"
                          ? t("signoff.intentAccept")
                          : it === "PROTEST"
                            ? t("signoff.intentProtest")
                            : t("signoff.intentRefused")}
                      </button>
                    ))}
                  </div>
                  {intent !== "ACCEPT" ? (
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-score-dim">{t("signoff.remarks")}</span>
                      <textarea
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        rows={2}
                        maxLength={500}
                        className="rounded-lg border border-border bg-surface px-3 py-2"
                      />
                    </label>
                  ) : null}

                  {error ? (
                    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
                      {error}
                    </p>
                  ) : null}

                  <div className="flex items-center justify-between gap-2">
                    <SecondaryButton disabled={busy} onClick={() => setOpenRole(null)}>
                      {t("signoff.cancel")}
                    </SecondaryButton>
                    <PrimaryButton disabled={!canSubmit()} onClick={() => void submit()}>
                      {intent === "REFUSED"
                        ? t("signoff.recordRefusal")
                        : t("signoff.confirmSignature")}
                    </PrimaryButton>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="text-center text-xs text-score-dim">
        {data?.policy === "REQUIRED"
          ? t("signoff.requiredHint")
          : t("signoff.optionalHint")}
      </p>
      <div className="mt-auto flex justify-center pb-2">
        <SecondaryButton onClick={onClose}>{t("signoff.later")}</SecondaryButton>
      </div>
    </section>
  );
}

/**
 * Console wiring for the sign-off, shared by the beach and indoor consoles:
 * gives back the panel to render in the court zone, the entry button for the
 * match-won banner, and whether Undo must disappear (a signed sheet locks the
 * match). Kept as one hook so both consoles behave identically.
 */
export function useResultSignOff(opts: {
  matchId: string;
  /** Engine status is FINISHED — the result exists and can be signed. */
  finished: boolean;
  policy: ResultSignaturePolicy;
  teamAName: string;
  teamBName: string;
  rosterA: PlayerLite[];
  rosterB: PlayerLite[];
  sets: { setNumber: number; scoreA: number; scoreB: number }[];
  setsWonA: number;
  setsWonB: number;
  winner: "A" | "B" | null;
}): {
  panel: React.ReactNode | null;
  finishedExtra: React.ReactNode | null;
  finishedUndoHidden: boolean;
} {
  const t = useT();
  const [open, setOpen] = useState(false);
  const available = opts.finished && opts.policy !== "OFF";
  const { status, refresh } = useSignOffStatus(opts.matchId, available);
  const complete = status?.complete ?? false;

  const panel =
    available && open ? (
      <ResultSignOff
        matchId={opts.matchId}
        teamAName={opts.teamAName}
        teamBName={opts.teamBName}
        rosterA={opts.rosterA}
        rosterB={opts.rosterB}
        sets={opts.sets}
        setsWonA={opts.setsWonA}
        setsWonB={opts.setsWonB}
        winner={opts.winner}
        onClose={() => setOpen(false)}
        onConfirmed={() => void refresh()}
      />
    ) : null;

  const finishedExtra =
    available && !complete && !open ? (
      <PrimaryButton onClick={() => setOpen(true)}>
        {t("scoring.signResult")}
      </PrimaryButton>
    ) : null;

  return { panel, finishedExtra, finishedUndoHidden: complete };
}
