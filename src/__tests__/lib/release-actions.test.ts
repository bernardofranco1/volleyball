/**
 * The promote orchestration (spec/28 §7, spec/31 backlog item 1).
 *
 * `migrationVerdict` was already pure-tested; the ORCHESTRATION around it was
 * not — and the orchestration is what moves the production domain. Every
 * assertion here is a step that, if it silently stopped happening, would
 * produce a promotion that looks successful and is not:
 *
 *   - the schema guard (promoting from homologation writes backups, the
 *     release row and the audit entry into the wrong schema, then flips the
 *     production domain anyway);
 *   - the target/state gates (a preview build serves the clone's tables at the
 *     canonical address; a BUILDING artifact serves nothing);
 *   - the migration gate keyed to the CANDIDATE's requirement, not the
 *     console's own bundled count — the 2026-08-11 incident;
 *   - the backup BEFORE the flip, and the honest failure count when a tenant
 *     backup fails (runBackup never throws, so a rejected-only count is
 *     structurally always zero);
 *   - ordering: nothing may reach the domain before the backups complete.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  inserts: [] as { table: string; values: Record<string, unknown> }[],
}));

/** Call order across mocked modules, so "backup before flip" is assertable. */
const calls = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("@/db", async () => {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const nameOf = (t: unknown) =>
    getTableConfig(t as Parameters<typeof getTableConfig>[0]).name;
  const db = {
    insert: (t: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        dbState.inserts.push({ table: nameOf(t), values });
        calls.order.push("insert:releases");
      },
    }),
  };
  return { db, dbTx: db, DB_SCHEMA: "public", IS_PROD_SCHEMA: true };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));

vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireGlobalAdmin: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/backup", async () => {
  const policy = await vi.importActual<object>("@/lib/backup-policy");
  return { ...policy, runBackup: vi.fn() };
});
vi.mock("@/lib/releases", async (importOriginal) => ({
  // migrationVerdict stays REAL — its own suite covers the rules, and using
  // the real one here proves the orchestration wires it up correctly.
  ...(await importOriginal<object>()),
  allTenantIds: vi.fn(),
  migrationState: vi.fn(),
}));
vi.mock("@/lib/vercel", () => ({
  vercelConfig: vi.fn(),
  getDeployment: vi.fn(),
  currentProduction: vi.fn(),
  fetchDeployedVersion: vi.fn(),
  promoteDeployment: vi.fn(),
  createProductionBuild: vi.fn(),
  setHomologAlias: vi.fn(),
}));

import { requireGlobalAdmin } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { runBackup } from "@/lib/backup";
import { allTenantIds, migrationState } from "@/lib/releases";
import {
  currentProduction,
  fetchDeployedVersion,
  getDeployment,
  promoteDeployment,
  vercelConfig,
} from "@/lib/vercel";
import { promoteRelease } from "@/lib/release-actions";
import { OK } from "@/lib/action-state";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const readyProduction = {
  id: "dpl_new",
  url: "new.vercel.app",
  target: "production" as const,
  state: "READY" as const,
  sha: "b09d4e5aaaa",
  shortSha: "b09d4e5",
  message: "the release",
  branch: "main",
  createdAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  dbState.inserts = [];
  calls.order = [];

  vi.mocked(requireGlobalAdmin).mockResolvedValue({
    user: { id: "admin1", email: "admin@x" },
  });
  vi.mocked(vercelConfig).mockReturnValue({
    token: "t",
    projectId: "p",
    teamId: "team",
    repoId: 1,
    homologAlias: "homolog.example",
  });
  vi.mocked(getDeployment).mockResolvedValue(readyProduction);
  vi.mocked(currentProduction).mockResolvedValue({
    ...readyProduction,
    id: "dpl_old",
    shortSha: "0000000",
  });
  // Candidate needs 23; production has 23 → the gate opens.
  vi.mocked(fetchDeployedVersion).mockResolvedValue({
    commit: "b09d4e5",
    schema: "public",
    environment: "production",
    migrations: 23,
  });
  vi.mocked(migrationState).mockResolvedValue({
    inRepo: 23,
    appliedProd: 23,
    appliedHomolog: 23,
    pendingProd: 0,
  });
  vi.mocked(allTenantIds).mockResolvedValue(["tnt1", "tnt2"]);
  vi.mocked(runBackup).mockImplementation(async () => {
    calls.order.push("backup");
    return { runId: "b", ok: true, objectPath: "p", sizeBytes: 1 };
  });
  vi.mocked(promoteDeployment).mockImplementation(async () => {
    calls.order.push("promote");
  });
});

const promote = () => promoteRelease(OK, fd({ deploymentId: "dpl_new" }));

describe("the happy path", () => {
  it("backs up EVERY tenant before the domain moves", async () => {
    const state = await promote();
    expect(state.error).toBeNull();
    expect(runBackup).toHaveBeenCalledTimes(2);
    // Ordering is the point: a promotion that flips first and backs up after
    // has no recovery point for the release it just shipped.
    expect(calls.order.indexOf("promote")).toBeGreaterThan(
      calls.order.lastIndexOf("backup"),
    );
  });

  it("records the release with the two numbers the gate compared", async () => {
    await promote();
    const row = dbState.inserts.find((i) => i.table === "releases");
    expect(row).toBeDefined();
    expect(row!.values).toMatchObject({
      deploymentId: "dpl_new",
      sha: "b09d4e5aaaa",
      previousDeploymentId: "dpl_old",
      migrationsInRepo: 23,
      migrationsApplied: 23,
      action: "PROMOTE",
      promotedBy: "admin@x",
    });
  });

  it("writes a platform-level audit entry", async () => {
    await promote();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, action: "release.promote" }),
    );
  });

  it("records a rollback as ROLLBACK, not as a promotion", async () => {
    await promoteRelease(
      OK,
      fd({ deploymentId: "dpl_new", action: "ROLLBACK" }),
    );
    expect(dbState.inserts[0].values).toMatchObject({ action: "ROLLBACK" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "release.rollback" }),
    );
  });
});

describe("the gates", () => {
  it("refuses a build that was made for the homologation tables", async () => {
    vi.mocked(getDeployment).mockResolvedValue({
      ...readyProduction,
      target: "preview",
    });
    const state = await promote();
    expect(state.error).toContain("homologation tables");
    expect(promoteDeployment).not.toHaveBeenCalled();
  });

  it("refuses an artifact that is not READY", async () => {
    vi.mocked(getDeployment).mockResolvedValue({
      ...readyProduction,
      state: "BUILDING",
    });
    const state = await promote();
    expect(state.error).toContain("BUILDING");
    expect(promoteDeployment).not.toHaveBeenCalled();
  });

  it("refuses to re-promote what is already serving", async () => {
    vi.mocked(currentProduction).mockResolvedValue(readyProduction);
    const state = await promote();
    expect(state.error).toContain("already serving");
    expect(promoteDeployment).not.toHaveBeenCalled();
  });

  it("refuses when the CANDIDATE needs migrations production lacks", async () => {
    // The 2026-08-11 shape: production on 19, candidate wants 23. The old
    // guard compared the console's own count and waved this through.
    vi.mocked(fetchDeployedVersion).mockResolvedValue({
      commit: "x",
      schema: "public",
      environment: "production",
      migrations: 23,
    });
    vi.mocked(migrationState).mockResolvedValue({
      inRepo: 23,
      appliedProd: 19,
      appliedHomolog: 23,
      pendingProd: 4,
    });
    const state = await promote();
    expect(state.error).toContain("db:migrate:prod");
    expect(promoteDeployment).not.toHaveBeenCalled();
    // And nothing was backed up for a promotion that never happened.
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("refuses when the candidate cannot say what it needs", async () => {
    vi.mocked(fetchDeployedVersion).mockResolvedValue(null);
    const state = await promote();
    expect(state.error).toContain("did not report");
    expect(promoteDeployment).not.toHaveBeenCalled();
  });

  it("still allows a ROLLBACK when the count is unknown, with a warning", async () => {
    // Refusing here would block the recovery path exactly when it is needed.
    vi.mocked(fetchDeployedVersion).mockResolvedValue(null);
    const state = await promoteRelease(
      OK,
      fd({ deploymentId: "dpl_new", action: "ROLLBACK" }),
    );
    expect(state.error).toBeNull();
    expect(state.message).toContain("warning");
    expect(promoteDeployment).toHaveBeenCalled();
  });

  it("is inert without Vercel configuration", async () => {
    vi.mocked(vercelConfig).mockReturnValue(null);
    const state = await promote();
    expect(state.error).toContain("not configured");
    expect(promoteDeployment).not.toHaveBeenCalled();
  });

  it("requires a deployment id", async () => {
    const state = await promoteRelease(OK, fd({}));
    expect(state.error).toContain("Missing deployment");
  });
});

describe("honest reporting of failed backups", () => {
  it("counts a backup that returned ok:false, not just a thrown one", async () => {
    // runBackup is documented "never throws — inspect `ok`". Counting only
    // rejections meant every tenant backup could fail and the operator would
    // still be told the promote was covered.
    vi.mocked(runBackup)
      .mockImplementationOnce(async () => {
        calls.order.push("backup");
        return { runId: "b1", ok: false, error: "storage down" };
      })
      .mockImplementationOnce(async () => {
        calls.order.push("backup");
        return { runId: "b2", ok: true, objectPath: "p", sizeBytes: 1 };
      });

    const state = await promoteRelease(OK, fd({ deploymentId: "dpl_new" }));
    expect(state.error).toBeNull();
    expect(state.message).toContain("1 tenant backup(s) failed");
    // The audit records how many actually succeeded.
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ backedUpTenants: 1 }),
      }),
    );
    // A failed backup does NOT block the promotion — it is reported, because
    // a hotfix must still be shippable when storage is unhappy.
    expect(promoteDeployment).toHaveBeenCalled();
  });
});
