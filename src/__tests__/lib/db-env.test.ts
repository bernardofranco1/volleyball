/**
 * Guards for the production/homologation schema split (spec/28).
 *
 * These are the rules that keep a test deployment from writing into production
 * tables, so they are worth pinning even though the code is a few lines.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// DB_SCHEMA is read once at module load, so each case needs a fresh module.
async function loadEnv(schema?: string) {
  vi.resetModules();
  vi.stubEnv("DB_SCHEMA", schema ?? "");
  return import("@/db/env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("DB_SCHEMA resolution", () => {
  it("defaults to production when unset", async () => {
    const env = await loadEnv(undefined);
    expect(env.DB_SCHEMA).toBe("public");
    expect(env.IS_PROD_SCHEMA).toBe(true);
  });

  it("accepts homolog", async () => {
    const env = await loadEnv("homolog");
    expect(env.DB_SCHEMA).toBe("homolog");
    expect(env.IS_PROD_SCHEMA).toBe(false);
  });

  it("refuses an unknown schema rather than guessing", async () => {
    await expect(loadEnv("staging")).rejects.toThrow(/DB_SCHEMA must be one of/);
  });
});

describe("searchPathFor", () => {
  it("leaves production connections completely alone", async () => {
    const { searchPathFor } = await loadEnv(undefined);
    expect(searchPathFor("public")).toBeNull();
  });

  it("pins homolog WITHOUT a public fallback", async () => {
    const { searchPathFor } = await loadEnv(undefined);
    const path = searchPathFor("homolog")!;
    expect(path).toContain("homolog");
    // The critical property: a table missing from the clone must error, never
    // silently resolve against production data.
    expect(path.split(",").map((s) => s.trim())).not.toContain("public");
  });
});

describe("envKey", () => {
  it("does not namespace production", async () => {
    const { envKey } = await loadEnv(undefined);
    expect(envKey("comp_1")).toBe("comp_1");
  });

  it("namespaces homolog so cloned ids cannot collide", async () => {
    const { envKey } = await loadEnv("homolog");
    expect(envKey("comp_1")).toBe("homolog:comp_1");
  });
});
