import { stopImpersonation } from "@/lib/impersonation-actions";

// Persistent "you are signed in as someone else" bar (spec/26 §7).
//
// Rendered from the ROOT layout so it survives every surface — tenant pages,
// /login, /select-tenant, and the cross-subdomain hop into a tenant domain —
// and so the exit control exists even where the target has no access at all.
// English-only, like the rest of the platform console: its only audience is a
// global admin.
export function ImpersonationBanner({
  targetEmail,
  expiresAt,
}: {
  targetEmail: string | null;
  expiresAt: number;
}) {
  // Rendered server-side; a plain UTC clock time avoids both a hydration
  // mismatch and a client component for a bar that never needs to tick.
  const until = new Date(expiresAt * 1000)
    .toISOString()
    .slice(11, 16);

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[100] border-t-2 border-amber-400 bg-amber-500 px-4 py-2 text-black shadow-[0_-4px_16px_rgba(0,0,0,0.35)] print:hidden"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span className="min-w-0">
          <strong className="font-semibold">Signed in as</strong>{" "}
          <span className="break-all font-mono">{targetEmail ?? "another user"}</span>
          <span className="ml-2 whitespace-nowrap opacity-80">
            (until {until} UTC)
          </span>
        </span>
        <form action={stopImpersonation}>
          <button
            type="submit"
            className="rounded-md border border-black/30 bg-black/10 px-3 py-1 text-sm font-medium hover:bg-black/20"
          >
            Exit
          </button>
        </form>
      </div>
    </div>
  );
}
