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
} from "@/lib/releases";
import {
  createProductionBuild,
  currentProduction,
  getDeployment,
  promoteDeployment,
  setHomologAlias,
  vercelConfig,
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

  const [previous, migrations] = await Promise.all([
    currentProduction(g.cfg),
    migrationState(),
  ]);
  if (previous?.id === deploymentId)
    return fail("That build is already serving production.");

  // Refuse to ship code that expects a schema production does not have yet:
  // the app would be querying columns that are not there. The operator's
  // recourse is `npm run db:migrate:prod`, deliberately a separate act.
  if (migrations.pendingProd > 0)
    return fail(
      `Production is ${migrations.pendingProd} migration(s) behind the repo. Run \`npm run db:migrate:prod\` first — promoting now would serve code against a schema that lacks its columns.`,
    );

  // Belt and braces before the domain moves.
  const tenantIds = await allTenantIds();
  const backups = await Promise.allSettled(
    tenantIds.map((tenantId) =>
      runBackup({ tenantId, kind: "FULL", trigger: "MANUAL" }),
    ),
  );
  const failedBackups = backups.filter((b) => b.status === "rejected").length;

  await promoteDeployment(g.cfg, deploymentId);

  await db.insert(releases).values({
    id: newId("rel"),
    deploymentId,
    sha: dep.sha,
    message: dep.message,
    branch: dep.branch,
    previousDeploymentId: previous?.id ?? null,
    migrationsInRepo: migrations.inRepo,
    migrationsApplied: migrations.appliedProd,
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
    failedBackups > 0
      ? ` (warning: ${failedBackups} tenant backup(s) failed — check Backups)`
      : "";
  return ok(
    action === "ROLLBACK"
      ? `Rolled back to ${dep.shortSha}.${suffix}`
      : `Promoted ${dep.shortSha}. The domain is serving it now.${suffix}`,
  );
}
