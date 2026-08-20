/**
 * The scoreboard host's release panel (spec/45 W7).
 *
 * The board host has no console of its own and must never grow one — it has no
 * sessions, and the whole point of `BOARD_ONLY` is that nothing but boards is
 * reachable there. So it is released from the scoring app's console, which
 * already has the auth, the Vercel client and the audit trail.
 *
 * Reads as a sibling of the scoring panels above it, with one difference stated
 * plainly in the copy: a scoreboard candidate reads the PRODUCTION schema, so
 * pointing real screens at it during a rehearsal is safe and is the intended
 * use, where a scoring candidate deliberately writes to the clone.
 */

import {
  boardVercelConfig,
  currentProduction,
  listDeployments,
  type Deployment,
} from "@/lib/vercel";
import { latestRelease, listReleases } from "@/lib/releases";
import {
  prepareBoardRelease,
  promoteBoardRelease,
  setBoardHomolog,
} from "@/lib/release-actions";
import { ActionForm } from "@/components/admin/ActionForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { LocalTime, SWISS_TIME_ZONE } from "@/components/LocalTime";
import { Panel, StatRow, StatTile } from "@/components/ui/Page";
import { ui } from "@/components/admin/styles";

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

export async function BoardReleasePanel() {
  const cfg = boardVercelConfig();
  if (!cfg) {
    return (
      <Panel title="Scoreboard host" className="mt-4">
        <p className="text-sm text-score-dim">
          Not configured. The scoreboard host is released from here once
          <code className="mx-1 rounded bg-surface px-1">BOARD_RELEASE_PROJECT_ID</code>
          (and, for a staging URL,
          <code className="mx-1 rounded bg-surface px-1">BOARD_HOMOLOG_ALIAS</code>)
          are set. Until then a push to <code className="rounded bg-surface px-1">main</code>{" "}
          reaches the venue screens unattended — see spec/45 W7.
        </p>
      </Panel>
    );
  }

  const [deployments, production, history, current] = await Promise.all([
    listDeployments(cfg, 20).catch(() => [] as Deployment[]),
    currentProduction(cfg).catch(() => null),
    listReleases(10, "board").catch(() => []),
    latestRelease("board").catch(() => null),
  ]);

  const candidates = deployments.filter((d) => d.target === "preview").slice(0, 6);
  const productionBuilds = deployments.filter((d) => d.target === "production").slice(0, 6);
  const builtShas = new Set(
    deployments.filter((d) => d.target === "production").map((d) => d.sha),
  );

  return (
    <>
      <StatRow>
        <StatTile
          label="Scoreboard host"
          value={<span className="font-mono text-lg">{production?.shortSha ?? "—"}</span>}
          hint={
            current?.createdAt ? (
              <>
                since <LocalTime date={current.createdAt} timeZone={SWISS_TIME_ZONE} />
              </>
            ) : (
              (production?.message ?? "").slice(0, 40) || "unknown"
            )
          }
        />
        <StatTile
          label="Scoreboard homologation"
          value={
            <span className="font-mono text-sm">
              {cfg.homologAlias ?? "no alias configured"}
            </span>
          }
          hint="candidates read the PRODUCTION schema — safe to point screens at"
          tone={cfg.homologAlias ? "warning" : "default"}
        />
      </StatRow>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Scoreboard candidates">
          <p className="mb-2 text-xs text-score-dim">
            Built from a push to <code className="rounded bg-surface px-1">main</code>.
            These cannot reach the venue screens; promoting rebuilds the same
            commit with production configuration and then moves the domain.
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-score-dim">No recent candidates.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {candidates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="font-mono text-sm">{d.shortSha}</span>
                  {stateBadge(d.state)}
                  <span className="min-w-0 flex-1 truncate text-sm text-score-dim">
                    {d.message || d.branch}
                  </span>
                  {d.state === "READY" && (
                    <span className="flex gap-2">
                      {cfg.homologAlias && (
                        <ActionForm action={setBoardHomolog}>
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
                          action={prepareBoardRelease}
                          confirm={`Build ${d.shortSha} for the scoreboard host? This does not release it.`}
                        >
                          <input type="hidden" name="sha" value={d.sha} />
                          <input type="hidden" name="ref" value={d.branch || "main"} />
                          <SubmitButton variant="secondary" pendingLabel="…">
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

        <Panel title="Promote / roll back the scoreboard">
          <p className="mb-2 text-xs text-score-dim">
            Moves the venue-screen domain onto a build that is already green. No
            rebuild, so a rollback is immediate — and no tenant backup runs,
            because this deployment holds none.
          </p>
          {productionBuilds.length === 0 ? (
            <p className="text-sm text-score-dim">
              No production build of the scoreboard host yet — prepare one first.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {productionBuilds.map((d) => {
                const serving = production?.id === d.id;
                const isRollback =
                  !!production && d.createdAt < production.createdAt;
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
                      <LocalTime date={new Date(d.createdAt)} timeZone={SWISS_TIME_ZONE} />
                    </span>
                    {!serving && d.state === "READY" && (
                      <ActionForm
                        action={promoteBoardRelease}
                        confirm={
                          isRollback
                            ? `Roll the venue screens back to ${d.shortSha}?`
                            : `Point the venue screens at ${d.shortSha}?`
                        }
                      >
                        <input type="hidden" name="deploymentId" value={d.id} />
                        <input
                          type="hidden"
                          name="action"
                          value={isRollback ? "ROLLBACK" : "PROMOTE"}
                        />
                        <SubmitButton
                          variant={isRollback ? "secondary" : "primary"}
                          pendingLabel="…"
                        >
                          {isRollback ? "Roll back" : "Promote"}
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Scoreboard release history" className="mt-4">
        {history.length === 0 ? (
          <p className="text-sm text-score-dim">
            No scoreboard releases recorded through this console yet.
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
                  <th className={ui.th}>By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className={`${ui.td} whitespace-nowrap text-score-dim`}>
                      <LocalTime date={r.createdAt} timeZone={SWISS_TIME_ZONE} />
                    </td>
                    <td className={`${ui.td} font-mono text-xs`}>{r.sha.slice(0, 7)}</td>
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
    </>
  );
}
