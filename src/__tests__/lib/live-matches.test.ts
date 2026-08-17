/**
 * The promote-time live-match warning (spec/31 backlog item 3).
 *
 * Two properties, both previously untested, both wrong at some point:
 *
 * 1. THE COUNT IS THE REAL COUNT. The query caps its sample at 10 rows for the
 *    names, and the count used to be `rows.length` — so a busy evening with 40
 *    live matches warned about 10, understating the blast radius exactly when
 *    the operator most needs the true number. Fixed with a window function
 *    during the spec/28 hardening; nothing pinned it until now.
 *
 * 2. IT ALWAYS ASKS ABOUT PRODUCTION. The release console may itself be
 *    running on the homolog tables, and "is anyone live" is a question about
 *    production — so the query is schema-qualified `public.` whenever this
 *    process is not on the production schema. If that qualification were lost,
 *    a promote from a homolog console would report the CLONE's live matches
 *    and cheerfully wave through a promotion during a real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  /** Rows the mocked `db.execute` returns. */
  rows: [] as Record<string, unknown>[],
  /** The SQL actually issued, flattened to a string for inspection. */
  lastSql: "",
}));

vi.mock("@/db", () => ({
  db: {
    execute: async (q: unknown) => {
      // drizzle's SQL object exposes its fragments; flatten whatever is there
      // so the test can assert on the schema qualification.
      dbState.lastSql = JSON.stringify(q);
      return dbState.rows;
    },
    select: () => ({
      from: () => ({ where: () => Promise.resolve([]) }),
    }),
  },
  dbTx: {},
}));

describe("liveMatches", () => {
  beforeEach(() => {
    vi.resetModules();
    dbState.rows = [];
    dbState.lastSql = "";
    vi.unstubAllEnvs();
  });

  /** Rows as the query shapes them: a label per row, the total on every row. */
  const row = (label: string, total: number) => ({ label, total: String(total) });

  it("reports zero when nothing is being scored", async () => {
    const { liveMatches } = await import("@/lib/releases");
    expect(await liveMatches()).toEqual({ count: 0, samples: [] });
  });

  it("reports the count and the names together", async () => {
    dbState.rows = [row("BRA – ITA", 2), row("POL – USA", 2)];
    const { liveMatches } = await import("@/lib/releases");
    const r = await liveMatches();
    expect(r.count).toBe(2);
    expect(r.samples).toEqual(["BRA – ITA", "POL – USA"]);
  });

  it("reports the TRUE total when more are live than are named", async () => {
    // The regression: 40 live, 10 sampled. `rows.length` would say 10 and the
    // operator would promote thinking a tenth of the hall was affected.
    dbState.rows = Array.from({ length: 10 }, (_, i) => row(`match ${i}`, 40));
    const { liveMatches } = await import("@/lib/releases");
    const r = await liveMatches();
    expect(r.count).toBe(40);
    expect(r.samples).toHaveLength(10);
    expect(r.count).toBeGreaterThan(r.samples.length);
  });

  it("asks about PRODUCTION even when the console runs on the clone", async () => {
    vi.stubEnv("DB_SCHEMA", "homolog");
    dbState.rows = [row("BRA – ITA", 1)];
    const { liveMatches } = await import("@/lib/releases");
    await liveMatches();
    // The qualification is the whole safety property here.
    expect(dbState.lastSql).toContain("public.");
  });

  it("leaves the production console's query unqualified", async () => {
    vi.stubEnv("DB_SCHEMA", "public");
    dbState.rows = [row("BRA – ITA", 1)];
    const { liveMatches } = await import("@/lib/releases");
    await liveMatches();
    expect(dbState.lastSql).not.toContain("public.matches");
  });
});
