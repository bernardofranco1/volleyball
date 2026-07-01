"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { ui } from "@/components/admin/styles";

// Tenant-surface error boundary: branded recovery instead of the raw Next
// error screen, with the exception reported to monitoring.
export default function TenantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-score-dim">
          The error has been logged{error.digest ? ` (ref ${error.digest})` : ""}.
          Match data is safe — every score is stored as it happens.
        </p>
        <button onClick={reset} className={`${ui.btnSecondary} mt-4`}>
          Try again
        </button>
      </div>
    </main>
  );
}
