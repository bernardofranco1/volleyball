// Multi-tenancy operations tests (spec/23): subdomain routing helpers, the
// backup export coverage guard, retention math, and the migration-idx pin.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import {
  EXPORTED_TABLES,
  FULL_BACKUPS_KEPT,
  MIGRATION_JOURNAL_IDX,
  selectExpiredBackups,
} from "@/lib/backup";
import {
  RESERVED_SUBDOMAINS,
  isValidSubdomain,
  subdomainFromHost,
  tenantUrl,
} from "@/lib/subdomain";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("subdomain validation (spec/23 §6)", () => {
  it("accepts plain DNS labels", () => {
    expect(isValidSubdomain("lisbon")).toBe(true);
    expect(isValidSubdomain("beach-2026")).toBe(true);
    expect(isValidSubdomain("x")).toBe(true);
  });

  it("rejects bad charset, casing and hyphen placement", () => {
    expect(isValidSubdomain("")).toBe(false);
    expect(isValidSubdomain("Lisbon")).toBe(false);
    expect(isValidSubdomain("-lisbon")).toBe(false);
    expect(isValidSubdomain("lisbon-")).toBe(false);
    expect(isValidSubdomain("lis bon")).toBe(false);
    expect(isValidSubdomain("li.sbon")).toBe(false);
    expect(isValidSubdomain("a".repeat(64))).toBe(false);
  });

  it("rejects every reserved label", () => {
    for (const r of RESERVED_SUBDOMAINS) {
      expect(isValidSubdomain(r)).toBe(false);
    }
  });
});

describe("subdomainFromHost (spec/23 §6.2)", () => {
  it("is inert without a configured root domain", () => {
    expect(subdomainFromHost("lisbon.example.com")).toBe(null);
  });

  it("extracts a first-level tenant label under the root domain", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "example.com");
    expect(subdomainFromHost("lisbon.example.com")).toBe("lisbon");
    expect(subdomainFromHost("LISBON.example.com:443")).toBe("lisbon");
  });

  it("ignores apex, reserved, foreign and deeper hosts", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "example.com");
    expect(subdomainFromHost("example.com")).toBe(null);
    expect(subdomainFromHost("www.example.com")).toBe(null);
    expect(subdomainFromHost("admin.example.com")).toBe(null);
    expect(subdomainFromHost("a.b.example.com")).toBe(null);
    expect(subdomainFromHost("volleyball-eight.vercel.app")).toBe(null);
    expect(subdomainFromHost(null)).toBe(null);
  });
});

describe("tenantUrl (spec/23 §6.3)", () => {
  const tenant = { slug: "lisbon-league", subdomain: "lisbon" };

  it("path form without a root domain", () => {
    expect(tenantUrl(tenant, "/dashboard")).toBe("/t/lisbon-league/dashboard");
  });

  it("subdomain form when both root domain and subdomain exist", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "example.com");
    expect(tenantUrl(tenant, "/dashboard")).toBe(
      "https://lisbon.example.com/dashboard",
    );
  });

  it("falls back to the path form for tenants without a subdomain", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "example.com");
    expect(tenantUrl({ slug: "x", subdomain: null }, "/dashboard")).toBe(
      "/t/x/dashboard",
    );
  });
});

describe("backup export coverage (spec/23 §7.1)", () => {
  it("every tenant-scoped table is exported (silent-backup-rot guard)", () => {
    const exported = new Set<string>(EXPORTED_TABLES);
    const missing: string[] = [];
    for (const value of Object.values(schema)) {
      let cfg;
      try {
        cfg = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
      } catch {
        continue; // not a table export
      }
      const hasTenantId = cfg.columns.some((c) => c.name === "tenant_id");
      // backup_runs is backup metadata, not tenant data — deliberately excluded.
      if (hasTenantId && cfg.name !== "backup_runs" && !exported.has(cfg.name)) {
        missing.push(cfg.name);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the competition-subtree tables without tenant_id are exported too", () => {
    for (const t of ["tournament_config", "competition_branding", "pool_teams"]) {
      expect(EXPORTED_TABLES).toContain(t);
    }
  });

  it("MIGRATION_JOURNAL_IDX matches the drizzle journal (restore guard)", () => {
    const journal = JSON.parse(
      readFileSync(
        join(process.cwd(), "src/db/migrations/meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: { idx: number }[] };
    const latest = Math.max(...journal.entries.map((e) => e.idx));
    expect(MIGRATION_JOURNAL_IDX).toBe(latest);
  });
});

describe("backup retention (spec/23 §7.2)", () => {
  const day = (n: number) =>
    new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);

  it("keeps the newest N fulls and incrementals since the oldest kept full", () => {
    // 40 dailies, newest first.
    const fulls = Array.from({ length: 40 }, (_, i) => `${day(39 - i)}.json.gz`);
    const incrementals = [
      `${day(2)}T10-00-00-000Z-comp1.json.gz`, // older than oldest kept (day 10)
      `${day(15)}T10-00-00-000Z-comp1.json.gz`, // within window
      `${day(39)}T10-00-00-000Z-comp2.json.gz`, // today
    ];
    const r = selectExpiredBackups(fulls, incrementals);
    expect(r.expiredFulls).toHaveLength(40 - FULL_BACKUPS_KEPT);
    expect(r.expiredFulls[0]).toBe(`${day(9)}.json.gz`);
    expect(r.expiredIncrementals).toEqual([`${day(2)}T10-00-00-000Z-comp1.json.gz`]);
  });

  it("expires nothing while under the retention count", () => {
    const fulls = [`${day(2)}.json.gz`, `${day(1)}.json.gz`];
    const r = selectExpiredBackups(fulls, [`${day(0)}T09-00-00-000Z-c.json.gz`]);
    expect(r.expiredFulls).toEqual([]);
    // Oldest kept full is day(1) → the day(0) incremental predates it.
    expect(r.expiredIncrementals).toEqual([`${day(0)}T09-00-00-000Z-c.json.gz`]);
  });

  it("keeps all incrementals when no fulls exist yet", () => {
    const r = selectExpiredBackups([], ["2026-01-01T09-00-00-000Z-c.json.gz"]);
    expect(r.expiredFulls).toEqual([]);
    expect(r.expiredIncrementals).toEqual([]);
  });
});
