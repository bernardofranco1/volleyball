import { DB_SCHEMA, IS_PROD_SCHEMA } from "@/db/env";
import { requireGlobalAdmin } from "@/lib/authz";
import {
  latestRelease,
  listReleases,
  liveMatches,
  migrationState,
} from "@/lib/releases";
import {
  currentProduction,
  homologDeploymentId,
  listDeployments,
  vercelConfig,
  type Deployment,
} from "@/lib/vercel";
import {
  prepareRelease,
  promoteRelease,
  setHomolog,
} from "@/lib/release-actions";
import { ActionForm } from "@/components/admin/ActionForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { LocalTime } from "@/components/LocalTime";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Page, PageHeader, Panel, StatRow, StatTile } from "@/components/ui/Page";
import { ui } from "@/components/admin/styles";

export const dynamic = "force-dynamic";

/**
 * Where the production release console lives.
 *
 * `NEXT_PUBLIC_APP_URL` is deliberately NOT set on the Preview environment —
 * on a homologation build it would make provisioning emails link to production
 * (`appOrigin` falls back to the request headers there, which is correct). So
 * this build cannot read the production origin from its own environment, and
 * the canonical address from spec/28 §8 is the fallback.
 */
const PRODUCTION_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
  "https://volleyball-eight.vercel.app";

/** State → badge, so a building candidate reads at a glance. */
function stateBadge(state: Deployment["state"]) {
  const tone =
    state === "READY"
      ? "bg-success-soft text-success"
      : state === "ERROR" || state === "CANCELED"
        ? "bg-danger-soft text-danger"
        : "bg-warning-soft text-warning";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {state}
    </span>
  );
}

export default async function ReleasesPage() {
  await requireGlobalAdmin("/admin/releases");

  // The release console is PRODUCTION-ONLY, and says so here rather than
  // letting the "not configured" notice below imply a misconfiguration.
  //
  // Promoting from a homologation build would back up CLONE tenants, write the
  // `releases` row and the audit entry into `homolog.*` where the production
  // console cannot see them, and flip the production domain anyway — leaving
  // production promoted with no backup. `promoteRelease` refuses outright for
  // that reason; this page has to give the same answer, because an operator
  // who reads "needs RELEASE_TOKEN…" will reasonably go and add it.
  if (!IS_PROD_SCHEMA) {
    return (
      <Page width="narrow">
        <PageHeader title="Releases" />
        <Panel title="Production console only">
          <p className="text-sm text-score-dim">
            This build serves the
            <code className="mx-1 rounded bg-surface px-1">{DB_SCHEMA}</code>
            tables, so it deliberately cannot promote. Backups, the release
            history and the audit trail would all be written to the wrong
            schema, while the production domain moved anyway.
          </p>
          <p className="mt-3 text-sm text-score-dim">
            Promote from the production console:{" "}
            <a
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              href={`${PRODUCTION_ORIGIN}/admin/releases`}
              target="_blank"
              rel="noreferrer"
            >
              {PRODUCTION_ORIGIN}/admin/releases
            </a>
            . Everything else on this build is here to be validated — see
            spec/28 §7.
          </p>
        </Panel>
      </Page>
    );
  }

  const cfg = vercelConfig();

  if (!cfg) {
    return (
      <Page width="narrow">
        <PageHeader title="Releases" />
        <Panel title="Not configured">
          <p className="text-sm text-score-dim">
            This console talks to Vercel on your behalf and needs
            <code className="mx-1 rounded bg-surface px-1">RELEASE_TOKEN</code>,
            <code className="mx-1 rounded bg-surface px-1">RELEASE_TEAM_ID</code> and
            <code className="mx-1 rounded bg-surface px-1">HOMOLOG_ALIAS</code> in
            the environment. The project and repo ids come from Vercel&apos;s own
            system variables. See spec/28.
          </p>
        </Panel>
      </Page>
    );
  }

  const [deployments, production, homologId, migrations, live, history, current] =
    await Promise.all([
      listDeployments(cfg, 20),
      currentProduction(cfg),
      homologDeploymentId(cfg),
      migrationState(),
      liveMatches(),
      listReleases(15),
      latestRelease(),
    ]);

  // Candidates are preview builds — they run against the homologation tables.
  const candidates = deployments.filter((d) => d.target === "preview").slice(0, 8);
  const allProductionBuilds = deployments.filter((d) => d.target === "production");
  // Cap the rollback menu: every past production build is technically a target,
  // but a wall of twenty identical buttons is a way to click the wrong one. The
  // useful window is the last handful plus whatever is serving.
  const productionBuilds = allProductionBuilds.slice(0, 8);
  const hiddenBuilds = allProductionBuilds.length - productionBuilds.length;
  // A commit that already has a production build does not need another one.
  const builtShas = new Set(allProductionBuilds.map((d) => d.sha));
  const building = deployments.some(
    (d) => d.state === "BUILDING" || d.state === "QUEUED" || d.state === "INITIALIZING",
  );
  const homologSha = candidates.find((d) => d.id === homologId)?.shortSha ?? null;

  return (
    <Page>
      {/* While anything is building, keep the page honest without a manual refresh. */}
      <LiveRefresh active={building} />
      <PageHeader
        title="Releases"
        meta={
          <>
            A push to <code className="rounded bg-surface-raised px-1">main</code>{" "}
            builds a candidate against the homologation tables; it cannot reach
            the production domain. Promoting rebuilds that same commit with
            production configuration, then points the domain at it.
          </>
        }
        actions={
          cfg.homologAlias && (
            <a
              href={`https://${cfg.homologAlias}`}
              target="_blank"
              rel="noopener noreferrer"
              className={ui.btnSecondary}
            >
              Open homologation ↗
            </a>
          )
        }
      />

      <StatRow>
        <StatTile
          label="In production"
          value={
            <span className="font-mono text-lg">
              {production?.shortSha ?? "—"}
            </span>
          }
          hint={
            current?.createdAt ? (
              <>
                since <LocalTime date={current.createdAt} />
              </>
            ) : (
              (production?.message ?? "").slice(0, 40) || "unknown"
            )
          }
        />
        <StatTile
          label="In homologation"
          value={<span className="font-mono text-lg">{homologSha ?? "—"}</span>}
          hint={cfg.homologAlias ?? "no alias configured"}
          tone={homologSha ? "warning" : "default"}
        />
        <StatTile
          label="Migrations"
          value={`${migrations.appliedProd ?? "?"}/${migrations.inRepo}`}
          hint={
            migrations.appliedProd === null
              ? "could not read production's count"
              : (migrations.pendingProd ?? 0) > 0
                ? `${migrations.pendingProd} pending vs this console's build`
                : "production is up to date"
          }
          tone={
            migrations.appliedProd === null || (migrations.pendingProd ?? 0) > 0
              ? "warning"
              : "default"
          }
        />
        <StatTile
          label="Live matches"
          value={live.count}
          hint={
            live.count > 0
              ? live.samples.slice(0, 2).join(" · ")
              : "nobody is scoring right now"
          }
          tone={live.count > 0 ? "warning" : "default"}
        />
      </StatRow>

      {live.count > 0 && (
        <div className="mb-4 rounded-xl border border-warning bg-warning-soft px-4 py-3 text-sm">
          <b className="text-warning">
            {live.count} match{live.count === 1 ? " is" : "es are"} being scored
            right now.
          </b>{" "}
          <span className="text-score-dim">
            Promoting swaps the app under their scorers and invalidates the
            assets their browsers already loaded. It works — a scorer reload
            recovers everything, and offline actions are queued — but if this is
            not a hotfix, wait for the whistle. ({live.samples.join(" · ")}
            {live.count > live.samples.length
              ? ` · +${live.count - live.samples.length} more`
              : ""}
            )
          </span>
        </div>
      )}

      {migrations.appliedProd === null && (
        <div className="mb-4 rounded-xl border border-warning bg-warning-soft px-4 py-3 text-sm">
          <b className="text-warning">
            Production&rsquo;s applied-migration count could not be read.
          </b>{" "}
          <span className="text-score-dim">
            Promotion is refused while this is unknown. Rollback is still
            allowed — it is the recovery path — and will say on the receipt that
            it shipped unverified.
          </span>
        </div>
      )}

      {(migrations.pendingProd ?? 0) > 0 && (
        <div className="mb-4 rounded-xl border border-warning bg-warning-soft px-4 py-3 text-sm">
          <b className="text-warning">
            Production is {migrations.pendingProd} migration(s) behind this
            console&rsquo;s build.
          </b>{" "}
          <span className="text-score-dim">
            Run{" "}
            <code className="rounded bg-surface px-1">npm run db:migrate:prod</code>
            . This figure is indicative — it compares against whatever build is
            serving this console. Each promotion is gated on what the candidate
            itself reports needing, so a build requiring these migrations is
            refused until they are applied. Homologation is at{" "}
            {migrations.appliedHomolog ?? "?"}.
          </span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Candidates — built against homologation tables">
          {candidates.length === 0 ? (
            <p className="text-sm text-score-dim">
              No candidate builds yet. Push to <code>main</code>.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {candidates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="font-mono text-sm">{d.shortSha}</span>
                  {stateBadge(d.state)}
                  {d.id === homologId && (
                    <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                      in homolog
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-score-dim">
                    {d.message || d.branch}
                  </span>
                  <span className="whitespace-nowrap text-xs text-score-dim">
                    <LocalTime date={new Date(d.createdAt)} />
                  </span>
                  {d.state === "READY" && (
                    <span className="flex gap-2">
                      {d.id !== homologId && (
                        <ActionForm action={setHomolog}>
                          <input type="hidden" name="deploymentId" value={d.id} />
                          <SubmitButton variant="secondary" pendingLabel="…">
                            Set as homolog
                          </SubmitButton>
                        </ActionForm>
                      )}
                      {builtShas.has(d.sha) ? (
                        <span className="whitespace-nowrap text-xs text-score-dim">
                          release built →
                        </span>
                      ) : (
                        <ActionForm
                          action={prepareRelease}
                          confirm={`Build ${d.shortSha} for production? This does not release it — you promote it afterwards.`}
                        >
                          <input type="hidden" name="sha" value={d.sha} />
                          <input type="hidden" name="ref" value={d.branch || "main"} />
                          <SubmitButton variant="secondary" pendingLabel="starting…">
                            Prepare release
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Production builds — promote or roll back">
          {productionBuilds.length === 0 ? (
            <p className="text-sm text-score-dim">
              None yet. Prepare a release from a candidate.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {productionBuilds.map((d) => {
                const serving = d.id === production?.id;
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <span className="font-mono text-sm">{d.shortSha}</span>
                    {stateBadge(d.state)}
                    {serving && (
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                        serving
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-score-dim">
                      {d.message || d.branch}
                    </span>
                    <span className="whitespace-nowrap text-xs text-score-dim">
                      <LocalTime date={new Date(d.createdAt)} />
                    </span>
                    {!serving && d.state === "READY" && (
                      <ActionForm
                        action={promoteRelease}
                        confirm={
                          `Point the production domain at ${d.shortSha}?` +
                          (live.count > 0
                            ? `\n\n${live.count} match(es) are LIVE right now.`
                            : "") +
                          "\n\nEvery tenant is backed up first."
                        }
                      >
                        <input type="hidden" name="deploymentId" value={d.id} />
                        {/* Anything older than what is serving is a rollback,
                            and the history should say so. */}
                        <input
                          type="hidden"
                          name="action"
                          value={
                            production && d.createdAt < production.createdAt
                              ? "ROLLBACK"
                              : "PROMOTE"
                          }
                        />
                        <SubmitButton pendingLabel="promoting…">
                          {production && d.createdAt < production.createdAt
                            ? "Roll back to this"
                            : "Promote"}
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {hiddenBuilds > 0 && (
            <p className="mt-3 text-xs text-score-dim">
              {hiddenBuilds} older production build(s) not shown — still
              promotable from the Vercel dashboard if you need to go back
              further.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="Release history" className="mt-4">
        {history.length === 0 ? (
          <p className="text-sm text-score-dim">
            No releases recorded through this console yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className={ui.th}>When</th>
                  <th className={ui.th}>Commit</th>
                  <th className={ui.th}>What</th>
                  <th className={ui.th}>Action</th>
                  <th className={ui.th}>Migrations</th>
                  <th className={ui.th}>By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className={`${ui.td} whitespace-nowrap text-score-dim`}>
                      <LocalTime date={r.createdAt} />
                    </td>
                    <td className={`${ui.td} font-mono text-xs`}>
                      {r.sha.slice(0, 7)}
                    </td>
                    <td className={ui.td}>{r.message ?? "—"}</td>
                    <td className={ui.td}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          r.action === "ROLLBACK"
                            ? "bg-warning-soft text-warning"
                            : "bg-surface-3 text-score-dim"
                        }`}
                      >
                        {r.action}
                      </span>
                    </td>
                    <td className={`${ui.td} font-mono text-xs text-score-dim`}>
                      {r.migrationsApplied ?? "?"}/{r.migrationsInRepo ?? "?"}
                    </td>
                    <td className={`${ui.td} text-xs text-score-dim`}>
                      {r.promotedBy ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}
