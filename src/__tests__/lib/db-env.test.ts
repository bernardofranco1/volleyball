/**
 * Guards for the production/homologation schema split (spec/28).
 *
 * These are the rules that keep a test deployment from writing into production
 * tables, so they are worth pinning even though the code is a few lines.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// DB_SCHEMA is read once at module load, so each case needs a fresh module.
async function loadEnv(schema?: string, vercel?: { env: string }) {
  vi.resetModules();
  vi.stubEnv("DB_SCHEMA", schema ?? "");
  vi.stubEnv("VERCEL", vercel ? "1" : "");
  vi.stubEnv("VERCEL_ENV", vercel?.env ?? "");
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

describe("the Vercel-environment cross-check", () => {
  // The one place the design was fail-OPEN: a missing DB_SCHEMA silently means
  // production tables, and the boot check used to be skipped in exactly that
  // case. Vercel already knows what kind of deployment this is, so the two
  // facts must agree.
  it("refuses a preview deployment that resolves to the production tables", async () => {
    await expect(loadEnv(undefined, { env: "preview" })).rejects.toThrow(
      /VERCEL_ENV=preview[\s\S]*DB_SCHEMA resolves to "public"/,
    );
  });

  it("refuses a production deployment pointed at the clone", async () => {
    await expect(loadEnv("homolog", { env: "production" })).rejects.toThrow(
      /expected "public"/,
    );
  });

  it("accepts the two correct pairings", async () => {
    expect((await loadEnv("homolog", { env: "preview" })).DB_SCHEMA).toBe("homolog");
    expect((await loadEnv(undefined, { env: "production" })).DB_SCHEMA).toBe("public");
  });

  it("leaves local shells alone, so `DB_SCHEMA=public npx tsx` still works", async () => {
    // No VERCEL=1 → not a deployment → nothing to cross-check. AGENTS.md tells
    // operators to aim scripts at production exactly this way.
    expect((await loadEnv("public")).DB_SCHEMA).toBe("public");
  });
});

describe("storage namespacing", () => {
  it("leaves production object keys byte-for-byte unchanged", async () => {
    const { scopedStoragePath, storagePrefix } = await loadEnv(undefined);
    expect(storagePrefix()).toBe("");
    expect(scopedStoragePath("tnt1/full/2026-08-17.json.gz")).toBe(
      "tnt1/full/2026-08-17.json.gz",
    );
  });

  it("keeps a homolog backup off production's object of the same day", async () => {
    const { scopedStoragePath } = await loadEnv("homolog");
    // `upsert: true` + identical cloned tenant ids = production's recovery
    // point replaced by clone data, which is what the prefix prevents.
    expect(scopedStoragePath("tnt1/full/2026-08-17.json.gz")).toBe(
      "homolog/tnt1/full/2026-08-17.json.gz",
    );
  });

  it("will not let homologation delete a production object", async () => {
    const { ownsStoragePath } = await loadEnv("homolog");
    expect(ownsStoragePath("homolog/tnt1/logo-abc.png")).toBe(true);
    // A cloned branding row points here — the row was copied, the object wasn't.
    expect(ownsStoragePath("tnt1/logo-abc.png")).toBe(false);
  });

  it("lets production clean up its own objects but not homolog's", async () => {
    const { ownsStoragePath } = await loadEnv(undefined);
    expect(ownsStoragePath("tnt1/logo-abc.png")).toBe(true);
    expect(ownsStoragePath("homolog/tnt1/logo-abc.png")).toBe(false);
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
