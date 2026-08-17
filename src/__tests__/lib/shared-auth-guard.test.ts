/**
 * The homologation split separates TABLES. It does not separate the Supabase
 * auth project (spec/28 §5) — there is one set of sign-in accounts, and the
 * clone copies `users` with identical ids.
 *
 * So an account mutation issued from homologation lands on a real person's
 * production login: `deleteUser` destroys it, `updateUserById` rewrites its
 * password, `generateLink` mints a working recovery token for it. None of that
 * is undone by re-cloning, because the clone rebuilds tables and the account
 * lives in a schema the clone does not own.
 *
 * These tests pin the refusal. They are cheap; the incident they prevent is not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(schema?: string) {
  vi.resetModules();
  vi.stubEnv("DB_SCHEMA", schema ?? "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  return import("@/lib/supabase-admin");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("authWriteBlockedReason", () => {
  it("allows account mutations on the production tables", async () => {
    const { authWriteBlockedReason } = await load(undefined);
    expect(authWriteBlockedReason("delete a sign-in account")).toBeNull();
  });

  it("blocks them everywhere else, naming the operation", async () => {
    const { authWriteBlockedReason } = await load("homolog");
    const reason = authWriteBlockedReason("delete a sign-in account");
    expect(reason).toContain("homolog");
    expect(reason).toContain("delete a sign-in account");
    // The operator has to understand WHY, or they will look for a workaround.
    expect(reason).toMatch(/shared with production/i);
  });
});

describe("createSupabaseAdminClient", () => {
  it("refuses to hand out a client for an auth write outside production", async () => {
    const { createSupabaseAdminClient } = await load("homolog");
    expect(() =>
      createSupabaseAdminClient({ authWrite: "reset a password" }),
    ).toThrow(/Refused/);
  });

  it("still serves reads and storage work in homologation", async () => {
    // Storage is namespaced rather than refused, so backup and restore stay
    // exercisable in homologation — the disaster path deserves rehearsal
    // somewhere other than production.
    const { createSupabaseAdminClient } = await load("homolog");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    expect(() => createSupabaseAdminClient()).not.toThrow();
  });
});
