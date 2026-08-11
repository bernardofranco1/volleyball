"use client";

/**
 * Post-match scoresheet sign-off (spec/20 + spec/21 Phase D), rendered in the
 * middle of the scorer console in place of the court: both team captains and
 * the 1st referee sign on this one device, in any order — the third signature
 * confirms the result and locks the match. The scorer bench (scorer +
 * assistant scorer) signs the APPROVAL block too, optionally, and may still do
 * so after the result is confirmed.
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
  BenchSignatureRole,
  SignatureIntent,
  SignatureRole,
  SignatureStrokes,
} from "@/lib/match-signatures";
import { SignaturePad } from "@/components/scoring/shared/SignaturePad";
import { PrimaryButton, SecondaryButton } from "@/components/scoring/shared/buttons";
import { useSignOffStatus } from "@/components/scoring/shared/useSignOff";
import type { ResultSignaturePolicy } from "@/engine/config";

type PanelRole = SignatureRole | BenchSignatureRole;

interface SignatureView {
  role: string;
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
const BENCH: BenchSignatureRole[] = ["SCORER", "ASSISTANT_SCORER"];

const isBench = (role: PanelRole): role is BenchSignatureRole =>
  role === "SCORER" || role === "ASSISTANT_SCORER";
const typesName = (role: PanelRole) => role === "FIRST_REFEREE" || isBench(role);

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
  const [openRole, setOpenRole] = useState<PanelRole | null>(null);
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

  const rosterFor = (role: PanelRole) =>
    role === "TEAM_A_CAPTAIN" ? rosterA : role === "TEAM_B_CAPTAIN" ? rosterB : [];

  const openFor = (role: PanelRole) => {
    const existing = data?.signatures.find((s) => s.role === role);
    setOpenRole(role);
    setError(null);
    setStrokes(null);
    setIntent("ACCEPT");
    setRemarks("");
    if (typesName(role)) {
      // Pre-filled when the name already came with the match data (officials
      // assignment/import) or from an earlier signature; otherwise the pad
      // stays disabled until a name is typed.
      const official = data?.officials.find((o) => o.role === role);
      setRefName(existing?.signerName ?? official?.name ?? "");
      setSignerId(null);
    } else {
      const roster = rosterFor(role);
      const captain = roster.find((p) => p.isCaptain) ?? roster[0];
      setSignerId(existing?.signerPlayerId ?? captain?.id ?? null);
      setRefName("");
    }
  };

  const signerName = (): string => {
    if (!openRole) return "";
    if (typesName(openRole)) return refName.trim();
    return rosterFor(openRole).find((p) => p.id === signerId)?.jerseyName ?? "";
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
          signerPlayerId: typesName(openRole) ? null : signerId,
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

  const clearSignature = async (role: PanelRole) => {
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

  const roleLabel = (role: PanelRole | string) =>
    role === "FIRST_REFEREE"
      ? t("signoff.firstReferee")
      : role === "SCORER"
        ? t("signoff.scorer")
        : role === "ASSISTANT_SCORER"
          ? t("signoff.assistantScorer")
          : t("signoff.captainOf", {
              team: role === "TEAM_A_CAPTAIN" ? teamAName : teamBName,
            });

  const winnerName = winner === "A" ? teamAName : winner === "B" ? teamBName : "—";
  const complete = data?.complete ?? false;

  /** One signature row: status + inline signing form. `locked` = signed and no
   *  redo offered (the trio once the result is confirmed). */
  const renderRow = (role: PanelRole, locked: boolean) => {
    const sig = data?.signatures.find((s) => s.role === role);
    const isStale = data?.stale.includes(role as SignatureRole) ?? false;
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
                {!locked ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      // A bench redo on a confirmed match re-signs via POST
                      // (supersede); DELETE is blocked once FINISHED.
                      complete && isBench(role)
                        ? openFor(role)
                        : void clearSignature(role)
                    }
                    className="rounded-lg border border-border px-2 py-1 text-[11px] text-score-dim disabled:opacity-40"
                  >
                    {t("signoff.redo")}
                  </button>
                ) : null}
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
            {typesName(role) ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-score-dim">
                  {role === "FIRST_REFEREE"
                    ? t("signoff.refName")
                    : t("signoff.officialName")}
                </span>
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
                      {p.jerseyName}
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
                (typesName(role) && refName.trim().length < 2)
              }
              disabledHint={
                intent === "REFUSED"
                  ? t("signoff.refusedPad")
                  : t("signoff.refNameHint")
              }
              ariaLabel={t("signoff.padLabel", { role: roleLabel(role) })}
            />

            {/* Protest / refusal are statements of record: they must say why.
                The scorer bench signs plainly — no protest path. */}
            {!isBench(role) ? (
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
            ) : null}
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
  };

  return (
    <section className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <header className="text-center">
        <h2 className="text-lg font-semibold">
          {complete ? t("signoff.confirmedTitle") : t("signoff.title")}
        </h2>
        <p className="text-xs text-score-dim">
          {complete ? t("signoff.confirmedBody") : t("signoff.subtitle")}
        </p>
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

      <ul className="flex flex-col gap-2">{ROLES.map((r) => renderRow(r, complete))}</ul>

      {/* Scorer bench — optional, never gates confirmation (spec/21 Phase D). */}
      <p className="mt-1 text-xs uppercase tracking-wide text-score-dim">
        {t("signoff.benchTitle")}
      </p>
      <ul className="flex flex-col gap-2">{BENCH.map((r) => renderRow(r, false))}</ul>

      {!complete ? (
        <p className="text-center text-xs text-score-dim">
          {data?.policy === "REQUIRED"
            ? t("signoff.requiredHint")
            : t("signoff.optionalHint")}
        </p>
      ) : null}
      <div className="mt-auto flex justify-center pb-2">
        {complete ? (
          <PrimaryButton onClick={onClose}>{t("signoff.close")}</PrimaryButton>
        ) : (
          <SecondaryButton onClick={onClose}>{t("signoff.later")}</SecondaryButton>
        )}
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
  // The bench may still be missing after confirmation — keep an entry point.
  const benchMissing = BENCH.some((r) => !(status?.signedRoles ?? []).includes(r));

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
    available && !open && (!complete || benchMissing) ? (
      complete ? (
        <SecondaryButton onClick={() => setOpen(true)}>
          {t("signoff.benchButton")}
        </SecondaryButton>
      ) : (
        <PrimaryButton onClick={() => setOpen(true)}>
          {t("scoring.signResult")}
        </PrimaryButton>
      )
    ) : null;

  return { panel, finishedExtra, finishedUndoHidden: complete };
}
