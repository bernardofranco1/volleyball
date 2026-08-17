// Next.js server instrumentation (Phase 11). Initializes Sentry only when a DSN
// is configured; otherwise this is a no-op and the app runs unchanged. We skip
// `withSentryConfig` (build-time source-map plugin) to avoid Turbopack friction —
// runtime error capture works without it.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) {
    if (
      process.env.NEXT_RUNTIME === "nodejs" ||
      process.env.NEXT_RUNTIME === "edge"
    ) {
      Sentry.init({ dsn, tracesSampleRate: 0.1 });
    }
  }

  // Prove, once per server boot, that a non-production deployment really is
  // pinned to its own schema (spec/28). If the pooler ever stopped forwarding
  // the search_path startup parameter, this deployment would be reading and
  // writing PRODUCTION tables; better to refuse to boot. Production skips the
  // round trip (there is nothing to get wrong) and never pays for it.
  //
  // NOT conditional on `process.env.DB_SCHEMA` any more: keying the check off
  // the variable meant a deployment that LOST that variable — the one case
  // where a preview silently falls back to the production tables — was also
  // the one case that skipped the check. Importing `@/db` runs `db/env.ts`,
  // whose Vercel-environment cross-check throws on exactly that.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertDbSchema } = await import("@/db");
    await assertDbSchema();
  }
}

// Captures errors thrown in Route Handlers / Server Components. No-op until init.
export const onRequestError = Sentry.captureRequestError;
