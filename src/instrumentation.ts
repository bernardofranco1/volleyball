// Next.js server instrumentation (Phase 11). Initializes Sentry only when a DSN
// is configured; otherwise this is a no-op and the app runs unchanged. We skip
// `withSentryConfig` (build-time source-map plugin) to avoid Turbopack friction —
// runtime error capture works without it.
import * as Sentry from "@sentry/nextjs";

export function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (
    process.env.NEXT_RUNTIME === "nodejs" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    Sentry.init({ dsn, tracesSampleRate: 0.1 });
  }
}

// Captures errors thrown in Route Handlers / Server Components. No-op until init.
export const onRequestError = Sentry.captureRequestError;
