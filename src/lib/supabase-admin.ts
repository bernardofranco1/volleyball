// Service-role Supabase client for privileged auth-admin operations (creating
// accounts for people a tenant admin grants access to). Uses the secret service
// role key — MUST only ever be imported from server code (Server Actions /
// Route Handlers), never a Client Component.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS AND IS NOT SEPARATED BY THE HOMOLOGATION SPLIT (spec/28)
//
// The split is a POSTGRES SCHEMA. It separates tables and nothing else. Two
// Supabase subsystems this client reaches are project-global and are therefore
// SHARED between production and homologation:
//
//   • Auth (the `auth` schema / GoTrue) — one set of accounts, and the clone
//     copies `users` with IDENTICAL ids. So `deleteUser(id)` run from the
//     homologation host destroys a REAL person's production login, and
//     `updateUserById(id, {password})` rewrites a REAL production credential.
//     Neither is undone by re-cloning: the clone rebuilds tables, and the
//     account it referred to is gone from a schema the clone does not own.
//     spec/28 §5 called auth "shared on purpose", which was true of READING it
//     and false of writing it.
//
//   • Storage buckets — one `backups` bucket and one `branding` bucket. Object
//     keys start with a tenant id, and cloned tenant ids equal production's,
//     so an unprefixed write from homologation lands on production's object.
//     `backups` is uploaded with `upsert: true`, which made a homologation
//     backup overwrite the production backup of the same tenant on the same
//     day — quietly replacing the recovery point that `promoteRelease` takes
//     before every promotion.
//
// The two get different treatment, because the right answer differs:
//
//   AUTH  → REFUSE outside `public`. There is no namespace to hide behind; an
//           account either exists in the one auth project or it does not. The
//           cost (account provisioning cannot be exercised in homologation) is
//           accepted and recorded in spec/28 §5.
//   STORAGE → NAMESPACE. A `homolog/` key prefix keeps homologation writes off
//           production objects while leaving backup, restore and logo upload
//           fully exercisable — and restore is precisely the path that deserves
//           rehearsing somewhere other than production.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { DB_SCHEMA, IS_PROD_SCHEMA } from "@/db/env";

/**
 * Why this process may not mutate the shared auth project, or null when it may.
 *
 * Returns a string rather than throwing so Server Actions can surface it as
 * ordinary form feedback; `createSupabaseAdminClient({ authWrite })` throws on
 * the same condition as the backstop for anything that forgets to ask.
 */
export function authWriteBlockedReason(operation: string): string | null {
  if (IS_PROD_SCHEMA) return null;
  return (
    `Refused: this deployment serves the \`${DB_SCHEMA}\` tables, but sign-in accounts are shared with ` +
    `production — there is only one set of them. Attempting to ${operation} here would change a real ` +
    `person's production login, and re-cloning would not undo it. Do this on the production console.`
  );
}

/** Throwing form of {@link authWriteBlockedReason}, for non-form callers. */
export function assertAuthWriteAllowed(operation: string): void {
  const reason = authWriteBlockedReason(operation);
  if (reason) throw new Error(reason);
}

// The storage-key namespacing lives in db/env.ts beside `envKey` (same idea,
// applied to buckets instead of advisory locks) so that dependency-free modules
// like backup-policy.ts can use it. Re-exported here because this is where a
// reader looking for "how do we not clobber production's objects" will land.
export {
  ownsStoragePath,
  scopedStoragePath,
  storagePrefix,
} from "@/db/env";

/**
 * @param opts.authWrite Names the account-mutating operation about to be
 * performed (e.g. "delete a sign-in account"). Pass it whenever the client
 * will call `auth.admin.createUser/updateUserById/deleteUser/inviteUserByEmail`
 * or mint a recovery link: it refuses outside the production schema. Omit for
 * reads (`listUsers`) and for storage work, which is namespaced instead.
 */
export function createSupabaseAdminClient(opts?: { authWrite?: string }) {
  if (opts?.authWrite) assertAuthWriteAllowed(opts.authWrite);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase admin client not configured (URL / service key).");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
