"use server";

/**
 * The release console's mutations (spec/28 §7). Global admins only.
 *
 * Promotion is split into two explicit steps rather than one button that does
 * everything: building the production flavour of a commit takes a couple of
 * minutes, and a Server Action that sat waiting for it would hit the function
 * timeout. So:
 *
 *   1. "Prepare production build" — starts the build, returns immediately.
 *   2. "Promote" — backs up, flips the domain, records the release. Seconds.
 *
 * That split is also honest about what is happening: you can see the artifact
 * exist and go green before anything points users at it.
 */
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { DB_SCHEMA, IS_PROD_SCHEMA } from "@/db/env";
import { releases } from "@/db/schema";
import { requireGlobalAdmin } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { runBackup } from "@/lib/backup";
import { newId } from "@/lib/id";
import { fail, ok, type FormState } from "@/lib/action-state";
import { str } from "@/lib/form-data";
import {
  allTenantIds,
  migrationState,
  migrationVerdict,
} from "@/lib/releases";
import {
  createProductionBuild,
  currentProduction,
  fetchDeployedVersion,
  getDeployment,
  promoteDeployment,
  setHomologAlias,
  vercelConfig,
  boardVercelConfig,
} from "@/lib/vercel";

const PATH = "/admin/releases";

/** Global-admin gate + configured Vercel client. Discriminated so `g.error`
 *  narrows to a string rather than `string | undefined`. */
type Gate =
  | { ok: true; ctx: { user: { id: string; email: string | null } }; cfg: NonNullable<ReturnType<typeof vercelConfig>> }
  | { ok: false; error: string };

async function gate(): Promise<Gate> {
  const ctx = await requireGlobalAdmin(PATH);
  const cfg = vercelConfig();
  if (!cfg)
    return {
      ok: false,
      error: "The release console is not configured (VERCEL_* env).",
    };
  return { ok: true, ctx, cfg };
}

/** Point the stable homologation hostname at a candidate build. */
export async function setHomolog(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gate();
  if (!g.ok) return fail(g.error);
  const deploymentId = str(fd, "deploymentId");
  if (!deploymentId) return fail("Missing deployment.");

  const dep = await getDeployment(g.cfg, deploymentId);
  if (dep.target === "production")
    return fail(
      "That is a production build — it runs against production tables and must not be used for homologation.",
    );
  if (dep.state !== "READY") return fail(`That build is ${dep.state}, not READY.`);

  const alias = await setHomologAlias(g.cfg, deploymentId);
  await recordAudit({
    tenantId: null,
    actor: { userId: g.ctx.user.id, email: g.ctx.user.email },
    action: "release.set_homolog",
    entityType: "deployment",
    entityId: deploymentId,
    summary: `Homologation now serves ${dep.shortSha} (${alias})`,
    metadata: { sha: dep.sha, branch: dep.branch },
  });
  revalidatePath(PATH);
  return ok(`Homologation now serves ${dep.shortSha}.`);
}

/**
 * Start the production build of a validated commit.
 *
 * Same code as the candidate, rebuilt with production configuration — the
 * schema is chosen by environment, so the artifact genuinely has to differ.
 * It stages: the project has automatic production-domain assignment off, so
 * nothing reaches users until `promote`.
 */
export async function prepareRelease(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gate();
  if (!g.ok) return fail(g.error);
  const sha = str(fd, "sha");
  const ref = str(fd, "ref") || "main";
  if (!sha) return fail("Missing commit.");

  const dep = await createProductionBuild(g.cfg, sha, ref);
  await recordAudit({
    tenantId: null,
    actor: { userId: g.ctx.user.id, email: g.ctx.user.email },
    action: "release.prepare",
    entityType: "deployment",
    entityId: dep.id,
    summary: `Started the production build of ${sha.slice(0, 7)}`,
    metadata: { sha, ref },
  });
  revalidatePath(PATH);
  return ok(`Building ${sha.slice(0, 7)} for production — promote it when green.`);
}

/**
 * Point the production domain at a build that is ready.
 *
 * Used for both directions: promoting a new release and rolling back to an
 * earlier one are the same API call, and both are recorded so the history reads
 * truthfully either way.
 *
 * Backs up every tenant first. That is cheap insurance against the one thing
 * this cannot undo — a release whose migrations already changed production data.
 */
export async function promoteRelease(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await gate();
  if (!g.ok) return fail(g.error);

  // liveMatches() is qualified `public.` on purpose, but nothing else here is:
  // allTenantIds(), runBackup(), the `releases` insert and recordAudit() all
  // resolve through this process's search_path. On the homologation host that
  // is `homolog`, so promoting from there would back up CLONE tenants, flip the
  // PRODUCTION domain anyway, and file the release row and audit entry into
  // homolog.* where the production console cannot see them — leaving production
  // promoted with no backup at all. The page header links to homologation, so
  // this is one wrong tab away rather than hypothetical.
  if (!IS_PROD_SCHEMA)
    return fail(
      `This console is serving the \`${DB_SCHEMA}\` tables. Promote from the production console — from here the backups and the release history would be written to the wrong schema.`,
    );

  const deploymentId = str(fd, "deploymentId");
  const action = str(fd, "action") === "ROLLBACK" ? "ROLLBACK" : "PROMOTE";
  const note = str(fd, "note") || null;
  if (!deploymentId) return fail("Missing deployment.");

  const dep = await getDeployment(g.cfg, deploymentId);
  if (dep.target !== "production")
    return fail(
      "That build was configured for homologation tables. Prepare a production build of the same commit instead.",
    );
  if (dep.state !== "READY") return fail(`That build is ${dep.state}, not READY.`);

  const [previous, migrations, candidate] = await Promise.all([
    currentProduction(g.cfg),
    migrationState(),
    // Ask the build being promoted what IT needs. See below.
    fetchDeployedVersion(dep),
  ]);
  if (previous?.id === deploymentId)
    return fail("That build is already serving production.");

  // Refuse to ship code that expects a schema production does not have yet:
  // the app would be querying columns that are not there.
  //
  // The question is what the CANDIDATE requires, not what this console carries.
  // Comparing the console's own bundled journal against production returned
  // "0 pending" in exactly the situation the guard exists for — production on
  // commit A, promoting commit B which adds a migration, console still built
  // from A. It only ever fired when the console already had the newer journal.
  //
  // Asking the candidate also makes rollback fall out correctly rather than
  // needing a special case: an older build requires fewer migrations than
  // production has applied, so it passes the same test.
  const required = candidate?.migrations ?? null;
  const applied = migrations.appliedProd;
  const verdict = migrationVerdict({ required, applied, action });
  if (!verdict.ok) return fail(verdict.error);
  const migrationWarning = verdict.warning ? ` (warning: ${verdict.warning})` : "";

  // Belt and braces before the domain moves.
  const tenantIds = await allTenantIds();
  const backups = await Promise.allSettled(
    tenantIds.map((tenantId) =>
      runBackup({ tenantId, kind: "FULL", trigger: "MANUAL" }),
    ),
  );
  // runBackup is documented "Never throws — the caller inspects `ok`", so a
  // rejected-only count is structurally always 0: every tenant backup could
  // fail and the operator would still be told the promote was covered, with
  // `backedUpTenants` recording the full count in the audit row. Inspect `ok`,
  // the way the nightly cron already does.
  const failedBackups = backups.filter(
    (b) => b.status === "rejected" || !b.value.ok,
  ).length;

  await promoteDeployment(g.cfg, deploymentId);

  await db.insert(releases).values({
    id: newId("rel"),
    deploymentId,
    sha: dep.sha,
    message: dep.message,
    branch: dep.branch,
    previousDeploymentId: previous?.id ?? null,
    // What the RELEASED build carries and what production had run — the two
    // numbers the guard actually compared. Null when either was unknown, which
    // only a rollback can reach; recording a guess would make the history lie.
    migrationsInRepo: required,
    migrationsApplied: applied,
    action,
    promotedBy: g.ctx.user.email,
    note,
  });
  await recordAudit({
    tenantId: null,
    actor: { userId: g.ctx.user.id, email: g.ctx.user.email },
    action: action === "ROLLBACK" ? "release.rollback" : "release.promote",
    entityType: "deployment",
    entityId: deploymentId,
    summary:
      action === "ROLLBACK"
        ? `Rolled production back to ${dep.shortSha}`
        : `Promoted ${dep.shortSha} to production`,
    metadata: {
      sha: dep.sha,
      previous: previous?.shortSha ?? null,
      backedUpTenants: tenantIds.length - failedBackups,
      note,
    },
  });

  revalidatePath(PATH);
  const suffix =
    (failedBackups > 0
      ? ` (warning: ${failedBackups} tenant backup(s) failed — check Backups)`
      : "") + migrationWarning;
  return ok(
    action === "ROLLBACK"
      ? `Rolled back to ${dep.shortSha}.${suffix}`
      : `Promoted ${dep.shortSha}. The domain is serving it now.${suffix}`,
  );
}

// ── The SCOREBOARD host (spec/45 W7) ────────────────────────────────────────
//
// The board host is a second deployment of this same codebase (spec/38) serving
// the venue screens. Until now a push to `main` went straight to its production
// domain unattended — acceptable while the boards were the only thing changing,
// and not acceptable while their DATA SOURCE is being swapped under live
// events. So it gets the same two-step discipline as the scoring app.
//
// Two deliberate differences from the scoring promote, both because the board
// host owns no tenant data:
//
//   * NO tenant backups. There is nothing of the tenants' on that deployment to
//     back up, and a backup run here would be theatre — it would report success
//     for work that protects nothing, which is worse than not running it.
//   * The migration guard is kept, in its rollback-safe form: refuse a build
//     that expects MORE migrations than the shared database has applied. The
//     board host reads the same schema as production, so shipping it ahead of
//     the schema breaks it exactly as it would break the scoring app.
//
// It has no console of its own and must never grow one: it has no sessions, and
// the whole point of BOARD_ONLY is that nothing but boards is reachable there.

type BoardGate =
  | { ok: true; ctx: { user: { id: string; email: string | null } }; cfg: NonNullable<ReturnType<typeof boardVercelConfig>> }
  | { ok: false; error: string };

async function boardGate(): Promise<BoardGate> {
  const ctx = await requireGlobalAdmin(PATH);
  const cfg = boardVercelConfig();
  if (!cfg)
    return {
      ok: false,
      error:
        "The scoreboard release console is not configured (BOARD_RELEASE_PROJECT_ID).",
    };
  // Same reasoning as the scoring promote: from a homologation build the
  // release row and the audit entry would be written into `homolog.*`, where
  // the production console cannot see them — while the domain moved anyway.
  if (!IS_PROD_SCHEMA)
    return {
      ok: false,
      error: `This console is serving the \`${DB_SCHEMA}\` tables. Promote the scoreboard host from the production console.`,
    };
  return { ok: true, ctx, cfg };
}

/** Start a production-configured build of a commit for the board host. */
export async function prepareBoardRelease(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await boardGate();
  if (!g.ok) return fail(g.error);
  const sha = str(fd, "sha");
  const ref = str(fd, "ref") || "main";
  if (!sha) return fail("Missing commit.");

  const dep = await createProductionBuild(g.cfg, sha, ref);
  await recordAudit({
    tenantId: null,
    actor: { userId: g.ctx.user.id, email: g.ctx.user.email },
    action: "release.prepare",
    entityType: "deployment",
    entityId: dep.id,
    summary: `Started the scoreboard production build of ${sha.slice(0, 7)}`,
    metadata: { sha, ref, project: "board" },
  });
  revalidatePath(PATH);
  return ok(`Building ${sha.slice(0, 7)} for the scoreboard host — promote it when green.`);
}

/** Point the scoreboard homologation hostname at a candidate. */
export async function setBoardHomolog(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await boardGate();
  if (!g.ok) return fail(g.error);
  const deploymentId = str(fd, "deploymentId");
  if (!deploymentId) return fail("Missing deployment.");

  const dep = await getDeployment(g.cfg, deploymentId);
  const alias = await setHomologAlias(g.cfg, deploymentId);
  await recordAudit({
    tenantId: null,
    actor: { userId: g.ctx.user.id, email: g.ctx.user.email },
    action: "release.homolog",
    entityType: "deployment",
    entityId: deploymentId,
    summary: `Scoreboard homologation now serves ${dep.shortSha}`,
    metadata: { sha: dep.sha, alias, project: "board" },
  });
  revalidatePath(PATH);
  return ok(`Scoreboard homologation now serves ${dep.shortSha} (${alias})`);
}

/**
 * Move the scoreboard production domain onto a build that is ready.
 *
 * Rollback is the same call with an older build — instant, no rebuild, and the
 * reason this exists: if a board release misbehaves mid-event in a way the
 * per-competition source lever cannot fix, the previous build comes back
 * without touching the scoring app.
 */
export async function promoteBoardRelease(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const g = await boardGate();
  if (!g.ok) return fail(g.error);

  const deploymentId = str(fd, "deploymentId");
  const action = str(fd, "action") === "ROLLBACK" ? "ROLLBACK" : "PROMOTE";
  const note = str(fd, "note") || null;
  if (!deploymentId) return fail("Missing deployment.");

  const dep = await getDeployment(g.cfg, deploymentId);
  if (dep.target !== "production")
    return fail(
      "That build was configured for homologation. Prepare a production build of the same commit instead.",
    );
  if (dep.state !== "READY") return fail(`That build is ${dep.state}, not READY.`);

  const [previous, migrations, candidate] = await Promise.all([
    currentProduction(g.cfg),
    migrationState(),
    fetchDeployedVersion(dep),
  ]);
  if (previous?.id === deploymentId)
    return fail("That build is already serving the scoreboard host.");

  // Ask the CANDIDATE what it needs, not this console — the console is
  // routinely the older build, which is exactly when the numbers differ.
  const required = candidate?.migrations ?? null;
  const applied = migrations.appliedProd;
  const verdict = migrationVerdict({ required, applied, action });
  if (!verdict.ok) return fail(verdict.error);
  const migrationWarning = verdict.warning ? ` (warning: ${verdict.warning})` : "";

  await promoteDeployment(g.cfg, deploymentId);

  await db.insert(releases).values({
    id: newId("rel"),
    deploymentId,
    sha: dep.sha,
    message: dep.message,
    branch: dep.branch,
    previousDeploymentId: previous?.id ?? null,
    migrationsInRepo: required,
    migrationsApplied: applied,
    action,
    promotedBy: g.ctx.user.email,
    note,
    project: "board",
  });
  await recordAudit({
    tenantId: null,
    actor: { userId: g.ctx.user.id, email: g.ctx.user.email },
    action: action === "ROLLBACK" ? "release.rollback" : "release.promote",
    entityType: "deployment",
    entityId: deploymentId,
    summary:
      action === "ROLLBACK"
        ? `Rolled the scoreboard host back to ${dep.shortSha}`
        : `Promoted ${dep.shortSha} to the scoreboard host`,
    metadata: {
      sha: dep.sha,
      previous: previous?.shortSha ?? null,
      project: "board",
      note,
    },
  });

  revalidatePath(PATH);
  return ok(
    action === "ROLLBACK"
      ? `Scoreboard host rolled back to ${dep.shortSha}.${migrationWarning}`
      : `Scoreboard host now serves ${dep.shortSha}.${migrationWarning}`,
  );
}
