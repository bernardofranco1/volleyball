// VSR live dispatch (spec/22): after every accepted scorer action the match
// snapshot is rebuilt as a .vsr document and POSTed to the configured intake.
// Fire-and-forget with per-match trailing-edge debouncing — a dispatch failure
// must never affect scoring, and rapid rallies collapse into one upload.
//
// Enabled only when VSR_DISPATCH_URL is set; matches without a visId are
// skipped (the VIS join key). The concrete VIS intake endpoint is an open
// question in spec/22 — the target is deliberately a generic HTTP POST.

import { resolveMatchConfig } from "@/lib/match-engine";
import { loadMatchReport } from "@/lib/match-report";
import { captureError } from "@/lib/observability";
import { buildVsr, vsrFilename } from "./build";

const DEBOUNCE_MS = 1200;

interface PendingDispatch {
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
}

// Per-instance debounce state. Serverless instances each keep their own map —
// worst case a burst split across instances uploads twice, which is harmless
// (the snapshot is idempotent by construction).
const pending = new Map<string, PendingDispatch>();

function cleanEnv(v: string | undefined): string | undefined {
  const s = v?.replace(/^﻿/, "").trim();
  return s ? s : undefined;
}

export function vsrDispatchEnabled(): boolean {
  return Boolean(cleanEnv(process.env.VSR_DISPATCH_URL));
}

/** Rebuild and upload the current snapshot for a match. Exported for the
 *  manual "send now" path and tests; scoring uses scheduleVsrDispatch. */
export async function dispatchVsrSnapshot(matchId: string): Promise<void> {
  const url = cleanEnv(process.env.VSR_DISPATCH_URL);
  if (!url) return;
  try {
    const [report, config] = await Promise.all([
      loadMatchReport(matchId),
      resolveMatchConfig(matchId),
    ]);
    if (!report.visId) return; // no VIS join key — nothing to send
    const vsr = buildVsr(report, config);
    const token = cleanEnv(process.env.VSR_DISPATCH_TOKEN);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-match-vis-id": report.visId,
        "x-vsr-filename": vsrFilename(report),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(vsr),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      captureError(
        new Error(`VSR dispatch failed: HTTP ${res.status} for ${matchId}`),
      );
  } catch (err) {
    captureError(err);
  }
}

/**
 * Debounced dispatch: called after every accepted event append. Returns a
 * promise that settles when the (possibly coalesced) upload completes, so the
 * caller can hold the serverless instance open via `after()`.
 */
export function scheduleVsrDispatch(matchId: string): Promise<void> {
  if (!vsrDispatchEnabled()) return Promise.resolve();
  const existing = pending.get(matchId);
  if (existing) {
    // Coalesce: reset the timer; the earlier caller's promise resolves when
    // the trailing dispatch finishes.
    clearTimeout(existing.timer);
  }
  return new Promise<void>((resolve) => {
    const prevResolve = existing?.resolve;
    const fire = () => {
      pending.delete(matchId);
      void dispatchVsrSnapshot(matchId).finally(() => {
        prevResolve?.();
        resolve();
      });
    };
    pending.set(matchId, {
      timer: setTimeout(fire, DEBOUNCE_MS),
      resolve: () => {
        prevResolve?.();
        resolve();
      },
    });
  });
}
