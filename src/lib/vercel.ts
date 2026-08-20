/**
 * The slice of Vercel's REST API the release console needs (spec/28 §7).
 *
 * Server-only: it carries a token that can deploy and re-point the production
 * domain, so nothing here may ever be imported from a client component.
 *
 * Deliberately hand-rolled rather than pulling in `@vercel/sdk` — five calls,
 * no streaming, no pagination beyond a `limit`, and a dependency that can
 * deploy production is a dependency worth not having.
 */
import { captureError } from "@/lib/observability";

const API = "https://api.vercel.com";

export interface VercelConfig {
  token: string;
  projectId: string;
  teamId: string;
  /** GitHub repo id, needed to create a deployment from a commit. */
  repoId: number;
  /** Stable hostname the homologation alias points at. */
  homologAlias: string | null;
  /** Vercel project NAME, which a deployment creation must carry. */
  projectName: string;
}

/**
 * Null when the console is not configured — the page then renders a setup
 * notice instead of failing, so a deployment without the token is inert rather
 * than broken.
 */
export function vercelConfig(): VercelConfig | null {
  // Only the token and the team id have to be configured: Vercel already
  // injects VERCEL_PROJECT_ID and VERCEL_GIT_REPO_ID as system variables, and
  // setting our own copies under those names would shadow them. The RELEASE_*
  // overrides exist for local development, where no system vars are present.
  // Blanks count as absent throughout: clearing a value in the Vercel
  // dashboard leaves an EMPTY string, not an unset variable (the same gotcha
  // db/env.ts documents for DB_SCHEMA). `??` does not treat "" as missing, so
  // before the spec/31 audit a blanked RELEASE_REPO_ID coalesced to
  // Number("") === 0 — a "configured" console that would try to deploy repo 0.
  const env = (name: string): string | null => {
    const v = process.env[name]?.trim();
    return v ? v : null;
  };
  const token = env("RELEASE_TOKEN") ?? env("VERCEL_TOKEN");
  const projectId = env("RELEASE_PROJECT_ID") ?? env("VERCEL_PROJECT_ID");
  const teamId = env("RELEASE_TEAM_ID");
  const rawRepo = env("RELEASE_REPO_ID") ?? env("VERCEL_GIT_REPO_ID");
  const repoId = rawRepo == null ? NaN : Number(rawRepo);
  if (!token || !projectId || !teamId || !Number.isFinite(repoId) || repoId <= 0)
    return null;
  return {
    token,
    projectId,
    teamId,
    repoId,
    homologAlias: env("HOMOLOG_ALIAS"),
    projectName: env("RELEASE_PROJECT_NAME") ?? "volleyball",
  };
}

/**
 * The same console, pointed at the SCOREBOARD host (spec/45 W7).
 *
 * Same team, same token, same repository — the board host is a second
 * deployment of this codebase (spec/38), so only the project id and the alias
 * differ. Null when the board project has not been configured, which is how a
 * deployment that predates W7 renders a setup notice rather than a broken
 * panel.
 *
 * Deliberately a separate function rather than a parameter on `vercelConfig`:
 * every call site then has to say WHICH deployment it means, and "promote"
 * without an object is exactly the ambiguity worth designing out.
 */
export function boardVercelConfig(): VercelConfig | null {
  const base = vercelConfig();
  if (!base) return null;
  const env = (name: string): string | null => {
    const v = process.env[name]?.trim();
    return v ? v : null;
  };
  const projectId = env("BOARD_RELEASE_PROJECT_ID");
  if (!projectId) return null;
  return {
    ...base,
    projectId,
    homologAlias: env("BOARD_HOMOLOG_ALIAS"),
    projectName: env("BOARD_RELEASE_PROJECT_NAME") ?? "fivb-live-scoreboards",
  };
}

async function call<T>(
  cfg: VercelConfig,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${sep}teamId=${cfg.teamId}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // fall through — a non-JSON body is itself the error message
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } })?.error;
    throw new Error(
      `Vercel ${method} ${path} → ${res.status} ${err?.code ?? ""} ${
        err?.message ?? text.slice(0, 200)
      }`.trim(),
    );
  }
  return json as T;
}

export type DeployState =
  | "QUEUED"
  | "INITIALIZING"
  | "BUILDING"
  | "READY"
  | "ERROR"
  | "CANCELED";

export interface Deployment {
  id: string;
  url: string;
  /** "production" for a build made with production config, else a candidate. */
  target: "production" | "preview";
  state: DeployState;
  sha: string;
  shortSha: string;
  message: string;
  branch: string;
  createdAt: number;
}

interface RawDeployment {
  uid?: string;
  id?: string;
  url: string;
  target?: string | null;
  state?: string;
  readyState?: string;
  created?: number;
  createdAt?: number;
  meta?: Record<string, string | undefined>;
}

function normalise(d: RawDeployment): Deployment {
  const meta = d.meta ?? {};
  const sha = meta.githubCommitSha ?? "";
  return {
    id: d.uid ?? d.id ?? "",
    url: d.url,
    target: d.target === "production" ? "production" : "preview",
    state: ((d.state ?? d.readyState ?? "QUEUED") as DeployState) ?? "QUEUED",
    sha,
    shortSha: sha.slice(0, 7),
    message: (meta.githubCommitMessage ?? "").split("\n")[0],
    branch: meta.githubCommitRef ?? "",
    createdAt: d.created ?? d.createdAt ?? 0,
  };
}

/** Recent deployments, newest first — the console's whole working set. */
export async function listDeployments(
  cfg: VercelConfig,
  limit = 20,
): Promise<Deployment[]> {
  const data = await call<{ deployments: RawDeployment[] }>(
    cfg,
    "GET",
    `/v6/deployments?projectId=${cfg.projectId}&limit=${limit}`,
  );
  return (data.deployments ?? []).map(normalise);
}

export async function getDeployment(
  cfg: VercelConfig,
  id: string,
): Promise<Deployment> {
  return normalise(await call<RawDeployment>(cfg, "GET", `/v13/deployments/${id}`));
}

/** Which deployment currently serves the production domain. */
export async function currentProduction(
  cfg: VercelConfig,
): Promise<Deployment | null> {
  const p = await call<{
    targets?: { production?: RawDeployment | null };
  }>(cfg, "GET", `/v9/projects/${cfg.projectId}`);
  const prod = p.targets?.production;
  return prod ? normalise(prod) : null;
}

/** What a deployment reports about itself at /api/version. */
export interface DeployedVersion {
  commit: string | null;
  schema: string | null;
  environment: string | null;
  /** Migrations that build expects to exist, or null if it predates the field. */
  migrations: number | null;
}

/**
 * Ask a deployment what it is, over its own URL.
 *
 * The console cannot read a candidate's migration count out of its own bundle:
 * it is routinely the OLDER build, which is precisely the case where the two
 * numbers differ and the answer matters. So each deployment self-reports.
 *
 * Deployment URLs sit behind Vercel SSO (the project runs `ssoProtection:
 * all_except_custom_domains`), so a server-side fetch needs the automation
 * bypass secret. Vercel injects VERCEL_AUTOMATION_BYPASS_SECRET into every
 * deployment once "Protection Bypass for Automation" is on. Without it — or if
 * the build predates /api/version reporting migrations — this returns null,
 * and the caller decides whether not knowing is fatal for what it is doing.
 */
export async function fetchDeployedVersion(
  d: Deployment,
): Promise<DeployedVersion | null> {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    const res = await fetch(`https://${d.url}/api/version`, {
      headers: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
      cache: "no-store",
      // A candidate that cannot answer promptly is treated as unknown rather
      // than holding a Server Action open until the function times out.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const m = j.migrations;
    return {
      commit: typeof j.commit === "string" ? j.commit : null,
      schema: typeof j.schema === "string" ? j.schema : null,
      environment: typeof j.environment === "string" ? j.environment : null,
      migrations: typeof m === "number" && Number.isInteger(m) ? m : null,
    };
  } catch {
    // Unreachable, DNS failure, SSO wall, timeout, non-JSON body.
    return null;
  }
}

/**
 * Build the PRODUCTION flavour of a commit that was validated as a candidate.
 *
 * A candidate is a preview deployment configured for the homologation tables,
 * so it cannot itself serve production — the same commit has to be rebuilt with
 * production configuration. This is that rebuild: same code, same lockfile,
 * different environment. It stages (never takes the domain) because the project
 * has auto-assignment of production domains switched off.
 */
export async function createProductionBuild(
  cfg: VercelConfig,
  sha: string,
  ref: string,
): Promise<Deployment> {
  const created = await call<RawDeployment>(
    cfg,
    "POST",
    `/v13/deployments?skipAutoDetectionConfirmation=1`,
    {
      name: cfg.projectName,
      project: cfg.projectId,
      target: "production",
      gitSource: { type: "github", repoId: cfg.repoId, ref, sha },
    },
  );
  return normalise(created);
}

/**
 * Point the production domain at an existing deployment. No rebuild — which is
 * what makes rollback instant and makes a promotion serve exactly the artifact
 * that was inspected.
 */
export async function promoteDeployment(
  cfg: VercelConfig,
  deploymentId: string,
): Promise<void> {
  await call(cfg, "POST", `/v10/projects/${cfg.projectId}/promote/${deploymentId}`);
}

/** Move the stable homologation hostname onto a candidate. */
export async function setHomologAlias(
  cfg: VercelConfig,
  deploymentId: string,
): Promise<string> {
  if (!cfg.homologAlias) throw new Error("HOMOLOG_ALIAS is not configured");
  await call(cfg, "POST", `/v2/deployments/${deploymentId}/aliases`, {
    alias: cfg.homologAlias,
  });
  return cfg.homologAlias;
}

/**
 * Which deployment the homologation alias resolves to. Best-effort: the console
 * only uses it to draw a badge, so a transient API failure must not take the
 * page down with it.
 */
export async function homologDeploymentId(
  cfg: VercelConfig,
): Promise<string | null> {
  if (!cfg.homologAlias) return null;
  try {
    const a = await call<{ deploymentId?: string; deployment?: { id?: string } }>(
      cfg,
      "GET",
      `/v4/aliases/${encodeURIComponent(cfg.homologAlias)}`,
    );
    return a.deploymentId ?? a.deployment?.id ?? null;
  } catch (err) {
    captureError(err, { scope: "vercel.homologAlias" });
    return null;
  }
}

/**
 * Exported for tests only (spec/31 audit). `normalise` reconciles the two row
 * shapes Vercel's list and detail endpoints return, and `vercelConfig` decides
 * whether the release console exists at all — both feed the promote path, and
 * neither had a test.
 */
export const __testing = { normalise };
