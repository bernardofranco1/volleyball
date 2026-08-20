/**
 * Promote a commit to production from the command line (spec/28 §7, spec/45).
 *
 * The /admin/releases console is the normal way to do this and remains so. This
 * is the same sequence, minus only the browser session — it exists because a
 * promote sometimes has to happen from a terminal, and doing it with a bare
 * `vercel promote` would silently skip the three things the console does that
 * actually matter:
 *
 *   1. a FULL backup of every tenant before the domain moves;
 *   2. the migration guard — refuse a build that expects more migrations than
 *      the database has applied, asked of the CANDIDATE rather than of this
 *      checkout, so a rollback passes the same test;
 *   3. the `releases` row and the audit entry, so the history stays true.
 *
 * Nothing here is a shortcut around those. It is a shortcut around the login.
 *
 *   DB_SCHEMA=public npx tsx --env-file=.env.local scripts/promote-prod.mts <sha> --by you@example.com
 *   …                                                                    --project board
 *   …                                                                    --rebuild   (env changed)
 *
 * Dry-run by default; `--execute` is required to build or flip anything.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { IS_PROD_SCHEMA } from "../src/db/env";
import { releases } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { recordAudit } from "../src/lib/audit";
import { runBackup } from "../src/lib/backup";
import { allTenantIds, migrationState, migrationVerdict } from "../src/lib/releases";
import {
  boardVercelConfig,
  createProductionBuild,
  currentProduction,
  fetchDeployedVersion,
  getDeployment,
  listDeployments,
  promoteDeployment,
  vercelConfig,
  type Deployment,
} from "../src/lib/vercel";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const execute = process.argv.includes("--execute");
/** Force a fresh build even if one of this commit exists — for an env change. */
const rebuild = process.argv.includes("--rebuild");
const project = arg("project") === "board" ? "board" : "scoring";
const sha = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
const by = arg("by") ?? "cli";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!IS_PROD_SCHEMA) {
    console.error(
      "Refusing: this process is pointed at the clone. Prefix with DB_SCHEMA=public —\n" +
        "otherwise the backups, the release row and the audit entry all land in the\n" +
        "wrong schema while the production domain moves anyway.",
    );
    process.exit(1);
  }
  const cfg = project === "board" ? boardVercelConfig() : vercelConfig();
  if (!cfg) {
    console.error(`No Vercel config for the ${project} project (RELEASE_*/BOARD_RELEASE_* env).`);
    process.exit(1);
  }
  if (!sha) {
    console.error("Usage: promote-prod.mts <sha> [--project scoring|board] [--by email] [--execute]");
    process.exit(1);
  }

  const previous = await currentProduction(cfg);
  console.log(`${project}: production currently serves ${previous?.shortSha ?? "—"}`);
  if (previous?.sha === sha && !rebuild) {
    console.log("Already serving that commit. Nothing to do (pass --rebuild if the env changed).");
    return;
  }

  // Reuse a production build of this commit if one exists; otherwise make one.
  const existing = rebuild
    ? undefined
    : (await listDeployments(cfg, 20)).find(
        (d) => d.target === "production" && d.sha.startsWith(sha) && d.state !== "ERROR",
      );
  if (!execute) {
    console.log(
      `Would ${existing ? `promote existing build ${existing.id}` : `build ${sha} then promote it`}` +
        `\n(dry run — pass --execute)`,
    );
    return;
  }

  let dep: Deployment =
    existing ?? (await createProductionBuild(cfg, sha, "main"));
  if (!existing) console.log(`Building ${sha.slice(0, 7)} → ${dep.id}`);

  for (let i = 0; dep.state !== "READY" && i < 120; i++) {
    if (dep.state === "ERROR" || dep.state === "CANCELED") {
      console.error(`Build ${dep.state}.`);
      process.exit(1);
    }
    await sleep(5000);
    dep = await getDeployment(cfg, dep.id);
    if (i % 6 === 0) console.log(`  …${dep.state}`);
  }
  if (dep.state !== "READY") {
    console.error("Build did not become READY in time.");
    process.exit(1);
  }
  console.log(`Build READY: ${dep.shortSha}`);

  // The guard, asked of the CANDIDATE — this checkout is not the authority.
  const [migrations, candidate] = await Promise.all([
    migrationState(),
    fetchDeployedVersion(dep),
  ]);
  const required = candidate?.migrations ?? null;
  const verdict = migrationVerdict({
    required,
    applied: migrations.appliedProd,
    action: "PROMOTE",
  });
  if (!verdict.ok) {
    console.error(`Refusing to promote: ${verdict.error}`);
    process.exit(1);
  }
  console.log(
    `Migrations: candidate needs ${required ?? "?"}, database has ${migrations.appliedProd ?? "?"}` +
      (verdict.warning ? ` (warning: ${verdict.warning})` : ""),
  );

  // Belt and braces before the domain moves. The board host owns no tenant
  // data, so backing it up would be theatre — the console makes the same
  // distinction (spec/45 W7).
  let backedUp = 0;
  if (project === "scoring") {
    const tenantIds = await allTenantIds();
    console.log(`Backing up ${tenantIds.length} tenant(s)…`);
    const results = await Promise.allSettled(
      tenantIds.map((tenantId) => runBackup({ tenantId, kind: "FULL", trigger: "MANUAL" })),
    );
    const failed = results.filter((r) => r.status === "rejected" || !r.value.ok);
    backedUp = tenantIds.length - failed.length;
    console.log(`  ${backedUp}/${tenantIds.length} backed up${failed.length ? " — SOME FAILED" : ""}`);
    if (failed.length) {
      console.error("Refusing to promote with failed backups. Check /admin/backups.");
      process.exit(1);
    }
  }

  await promoteDeployment(cfg, dep.id);
  await db.insert(releases).values({
    id: newId("rel"),
    deploymentId: dep.id,
    sha: dep.sha,
    message: dep.message,
    branch: dep.branch,
    previousDeploymentId: previous?.id ?? null,
    migrationsInRepo: required,
    migrationsApplied: migrations.appliedProd,
    action: "PROMOTE",
    promotedBy: by,
    note: "promoted from the CLI (scripts/promote-prod.mts)",
    project,
  });
  await recordAudit({
    tenantId: null,
    actor: { userId: "cli", email: by },
    action: "release.promote",
    entityType: "deployment",
    entityId: dep.id,
    summary: `Promoted ${dep.shortSha} to ${project === "board" ? "the scoreboard host" : "production"}`,
    metadata: { sha: dep.sha, previous: previous?.shortSha ?? null, backedUpTenants: backedUp, project },
  });
  console.log(`\n✓ ${project} now serves ${dep.shortSha}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
