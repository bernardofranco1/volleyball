// What is actually running here? (spec/28)
//
// Answers the question the release workflow keeps asking — of the production
// domain, of a candidate URL, and later of the release console: which commit is
// this, and which set of tables is it talking to?
//
// Deliberately unauthenticated and deliberately thin: a commit SHA and an
// environment name, both of which the homologation banner already shows in the
// page. No connection strings, no configuration, no database access — so it
// stays cheap enough to poll and carries nothing worth protecting.
import { DB_SCHEMA, IS_PROD_SCHEMA } from "@/db/env";
import { MIGRATIONS_IN_REPO } from "@/lib/migrations-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      environment: IS_PROD_SCHEMA ? "production" : "homologation",
      schema: DB_SCHEMA,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      // "production" for a build made from the release branch, "preview" for a
      // candidate — the Vercel-side counterpart to `schema`. If these two ever
      // disagree, the env vars are wrong.
      target: process.env.VERCEL_ENV ?? "development",
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      // How many migrations THIS build expects to exist. The release console
      // asks a candidate for this before promoting it, because the console's
      // own bundled count is its own build's, which is routinely older than the
      // one being shipped. A static integer: no database access, and nothing
      // worth protecting.
      migrations: MIGRATIONS_IN_REPO,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
