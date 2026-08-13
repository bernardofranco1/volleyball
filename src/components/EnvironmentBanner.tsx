import { DB_SCHEMA, IS_PROD_SCHEMA } from "@/db/env";

/**
 * The amber "you are not in production" bar (spec/28).
 *
 * Rendered on EVERY surface — scorer console, team tablets and public boards
 * included — because the whole point of homologation is validating those
 * surfaces, and a tester must never be in doubt about which set of tables they
 * just wrote to.
 *
 * The trigger is unspoofable and needs no cookie, host check or database read:
 * a deployment either was built with `DB_SCHEMA=homolog` or it was not. A
 * production build cannot render this bar, and a homologation build cannot
 * hide it.
 *
 * Fixed to the bottom rather than the top: the top-left of a tenant page is the
 * sidebar brand and the top of the scorer console is the score, and covering
 * either would change the very layout being validated. The impersonation banner
 * uses the same convention (spec/26 §7).
 */
export function EnvironmentBanner() {
  if (IS_PROD_SCHEMA) return null;

  const sha = (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_COMMIT_SHA ??
    ""
  ).slice(0, 7);
  const message = process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? "";

  return (
    <div
      role="status"
      // pointer-events-none so it can never swallow a tap meant for the console
      // underneath; the bar carries no controls of its own.
      // Solid amber, not a tint: this is the one piece of chrome that must never
      // be mistaken for decoration, and a soft fill read as background noise in
      // the dark theme. pointer-events-none so it can never swallow a tap meant
      // for the console underneath; the bar carries no controls of its own.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 bg-warning px-3 py-1 text-center text-xs font-bold text-surface"
    >
      <span className="tracking-[0.12em]">⚠ HOMOLOGATION</span>
      {sha && (
        <span className="font-mono font-medium opacity-80">
          {sha}
          {message ? ` · ${message.slice(0, 60)}` : ""}
        </span>
      )}
      <span className="font-medium opacity-90">
        test data ({DB_SCHEMA} tables) — this is not production
      </span>
    </div>
  );
}
