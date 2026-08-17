/**
 * Rewind and fault-correction gates (spec/17, spec/29 F13 — spec/31 item 1).
 *
 * Both actions remove points from the official record, and both are guarded by
 * a chain that has to hold in ORDER: authorization, then the signed-scoresheet
 * lock, then input validation, then the engine call. A gate that stops firing
 * is invisible until someone corrects a signed match.
 *
 * `selectPointsToCancel` (the pure half of F13) has its own suite; this covers
 * the action wrapper around it, which is where the authorization and lock live.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => {
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({ insert: () => ({ values: async () => {} }) }),
  };
  return { db, dbTx: db };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  authorizeMatch: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/backup", () => ({ scheduleIncrementalBackup: vi.fn() }));
vi.mock("@/lib/match-signatures", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resultLocked: vi.fn(),
}));
vi.mock("@/lib/match-engine", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cancelPointsForFault: vi.fn(),
  rewindMatch: vi.fn(),
}));

import { authorizeMatch } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { resultLocked } from "@/lib/match-signatures";
import { cancelPointsForFault, rewindMatch } from "@/lib/match-engine";
import {
  cancelFaultPointsAction,
  rewindMatchAction,
} from "@/lib/match-admin-actions";
import { OK } from "@/lib/action-state";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const authed = {
  ok: true as const,
  auth: {
    tenantId: "tnt1",
    user: { id: "u1", email: "scorer@x" },
    roles: ["SCORER"],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorizeMatch).mockResolvedValue(authed as never);
  vi.mocked(resultLocked).mockResolvedValue(false);
  vi.mocked(cancelPointsForFault).mockResolvedValue({
    cancelled: 3,
    newEvents: [],
    state: { lastSequence: 40 },
  } as never);
  vi.mocked(rewindMatch).mockResolvedValue({
    newEvents: [],
    state: { lastSequence: 12 },
  } as never);
});

const cancelArgs = (over: Record<string, string> = {}) =>
  fd({
    matchId: "m1",
    team: "A",
    fromSequence: "12",
    reason: "wrong server since 9:8",
    ...over,
  });

describe("cancelFaultPointsAction", () => {
  it("cancels and reports how many points went", async () => {
    const state = await cancelFaultPointsAction(OK, cancelArgs());
    expect(state.error).toBeNull();
    expect(state.message).toContain("3 point(s)");
    expect(cancelPointsForFault).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({ team: "A", fromSequence: 12 }),
    );
  });

  it("records the correction in the audit log with its reason", async () => {
    await cancelFaultPointsAction(OK, cancelArgs());
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "match.fault_correction",
        metadata: expect.objectContaining({ cancelled: 3, team: "A" }),
      }),
    );
  });

  it("refuses an unauthorized caller before touching the log", async () => {
    vi.mocked(authorizeMatch).mockResolvedValue({
      ok: false,
      status: 403,
    } as never);
    const state = await cancelFaultPointsAction(OK, cancelArgs());
    expect(state.error).toBeTruthy();
    expect(cancelPointsForFault).not.toHaveBeenCalled();
  });

  it("refuses once the scoresheet is signed", async () => {
    // Signatures attest to a score; removing points underneath them would
    // leave three people attesting to a result nobody signed.
    vi.mocked(resultLocked).mockResolvedValue(true);
    const state = await cancelFaultPointsAction(OK, cancelArgs());
    expect(state.error).toContain("signed");
    expect(cancelPointsForFault).not.toHaveBeenCalled();
  });

  it("requires a team and a moment", async () => {
    expect(
      (await cancelFaultPointsAction(OK, cancelArgs({ team: "" }))).error,
    ).toContain("team at fault");
    expect(
      (await cancelFaultPointsAction(OK, cancelArgs({ fromSequence: "" })))
        .error,
    ).toContain("moment the fault began");
    expect(cancelPointsForFault).not.toHaveBeenCalled();
  });

  it("requires a real reason — it is recorded on the scoresheet", async () => {
    // A correction that removes points from the official record has to say
    // why; whitespace and one-character placeholders are not a reason.
    for (const reason of ["", "  ", "x"]) {
      const state = await cancelFaultPointsAction(OK, cancelArgs({ reason }));
      expect(state.error).toContain("reason");
    }
    expect(cancelPointsForFault).not.toHaveBeenCalled();
  });

  it("rejects a team value that is not A or B", async () => {
    const state = await cancelFaultPointsAction(OK, cancelArgs({ team: "C" }));
    expect(state.error).toContain("team at fault");
    expect(cancelPointsForFault).not.toHaveBeenCalled();
  });
});

describe("rewindMatchAction", () => {
  const rewindArgs = (over: Record<string, string> = {}) =>
    fd({ matchId: "m1", fromSequence: "12", reason: "mis-scored set", ...over });

  it("rewinds and audits", async () => {
    const state = await rewindMatchAction(OK, rewindArgs());
    expect(state.error).toBeNull();
    expect(rewindMatch).toHaveBeenCalledWith("m1", 12, expect.any(Object));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "match.rewind" }),
    );
  });

  it("is ADMIN-only, unlike the fault correction", async () => {
    // The two actions deliberately differ: correcting a fault is officiating,
    // rewinding is an administrative erasure.
    vi.mocked(authorizeMatch).mockResolvedValue({
      ok: false,
      status: 403,
    } as never);
    const state = await rewindMatchAction(OK, rewindArgs());
    expect(state.error).toContain("competition admin");
    expect(rewindMatch).not.toHaveBeenCalled();
  });

  it("refuses once the scoresheet is signed", async () => {
    vi.mocked(resultLocked).mockResolvedValue(true);
    const state = await rewindMatchAction(OK, rewindArgs());
    expect(state.error).toContain("signed");
    expect(rewindMatch).not.toHaveBeenCalled();
  });

  it("requires a point to rewind to", async () => {
    const state = await rewindMatchAction(OK, rewindArgs({ fromSequence: "" }));
    expect(state.error).toContain("Pick a point");
    expect(rewindMatch).not.toHaveBeenCalled();
  });

  it("accepts an empty reason — the rewind itself is the record", async () => {
    // Deliberate asymmetry with the fault correction, whose reason is
    // mandatory: a rewind is admin-only and already fully audited.
    const state = await rewindMatchAction(OK, rewindArgs({ reason: "" }));
    expect(state.error).toBeNull();
    expect(rewindMatch).toHaveBeenCalled();
  });
});
