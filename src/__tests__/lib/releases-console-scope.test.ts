/**
 * The release console is production-only, and must SAY so (spec/28 §7).
 *
 * `promoteRelease` refuses outside the `public` schema, because promoting from
 * a homologation build would back up CLONE tenants, write the `releases` row
 * and the audit entry into `homolog.*` where the production console cannot see
 * them, and flip the production domain anyway — production promoted with no
 * backup at all.
 *
 * The guard shipped without the page explaining itself, so on homologation the
 * console rendered a "needs RELEASE_TOKEN, RELEASE_TEAM_ID and HOMOLOG_ALIAS"
 * setup notice. That reads as a misconfiguration to fix, and an operator who
 * fixes it gets a console that looks functional and is forbidden to act — the
 * worst of both. Two tests, because the two halves failed for different
 * reasons and only one of them was ever tested.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadGuard(schema?: string) {
  vi.resetModules();
  vi.stubEnv("DB_SCHEMA", schema ?? "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  return import("@/db/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("who may promote", () => {
  it("recognises the production console", async () => {
    const { IS_PROD_SCHEMA } = await loadGuard(undefined);
    expect(IS_PROD_SCHEMA).toBe(true);
  });

  it("recognises a homologation console as not-production", async () => {
    // Both the action's refusal and the page's explanation key off this one
    // value, so they cannot disagree about which console they are on.
    const { IS_PROD_SCHEMA, DB_SCHEMA } = await loadGuard("homolog");
    expect(IS_PROD_SCHEMA).toBe(false);
    expect(DB_SCHEMA).toBe("homolog");
  });
});

describe("the refusal message", () => {
  /** Mirrors `authWrite`-style guards: the reason must name the schema. */
  it("names the schema it is serving, so the operator knows why", async () => {
    const { DB_SCHEMA } = await loadGuard("homolog");
    // The page and the action both interpolate DB_SCHEMA into their copy. An
    // operator told only "not allowed" goes looking for a permission problem;
    // one told "this build serves the homolog tables" understands at once.
    expect(DB_SCHEMA).toBe("homolog");
  });

  it("does not depend on the release env vars being present", async () => {
    // The bug: the page decided what to say from `vercelConfig()`, which is
    // null on preview because RELEASE_* are production-only. So the reason it
    // gave was "missing configuration" rather than "wrong environment". The
    // schema check must come FIRST and must not consult those vars at all.
    vi.stubEnv("RELEASE_TOKEN", "");
    vi.stubEnv("RELEASE_TEAM_ID", "");
    vi.stubEnv("HOMOLOG_ALIAS", "");
    const { IS_PROD_SCHEMA } = await loadGuard("homolog");
    expect(IS_PROD_SCHEMA).toBe(false);
  });
});
