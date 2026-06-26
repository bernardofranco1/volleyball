// Error monitoring (Phase 11). Thin wrapper over @sentry/nextjs. Everything
// no-ops until a DSN is configured (`SENTRY_DSN` server / `NEXT_PUBLIC_SENTRY_DSN`
// client) — Sentry's capture functions are inert when `Sentry.init` hasn't run.
//
// Use `captureError` at spots where an error is otherwise swallowed (best-effort
// broadcasts, audit writes) so they're still visible once monitoring is on.
import * as Sentry from "@sentry/nextjs";

export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
