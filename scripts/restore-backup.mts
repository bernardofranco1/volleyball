/**
 * Restore a tenant backup (spec/23 §7.5).
 *
 * NEVER runs from the production app — this is an operator tool, pointed at an
 * explicit target database. Typical uses: single-tenant disaster restore,
 * porting a tenant between projects, staging-from-prod.
 *
 * Usage:
 *   DATABASE_URL=postgres://… npx tsx scripts/restore-backup.mts <file.json.gz> \
 *     --schema prod|homolog [--dry-run]
 *
 * `--schema` is REQUIRED and has no default (same reasoning as db:migrate,
 * spec/28): production and homologation are two schemas in ONE database, so
 * naming the database no longer says where the rows land. Guessing has two
 * failure modes and both are bad — clone data upserted over production, or a
 * production restore that quietly went into the clone while the operator
 * believed the outage was over.
 *
 * Rows are upserted (INSERT … ON CONFLICT (pk) DO UPDATE) in FK-safe order,
 * id-preserving, inside one transaction. Refuses files written against a NEWER
 * migration journal than the exporter version this script knows about.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import postgres from "postgres";

const EXPECTED_FORMAT = 1;
// Keep in sync with MIGRATION_JOURNAL_IDX in src/lib/backup-policy.ts. Had
// drifted to 8 while the exporter stamped 14 — every backup since migration 9
// would have been refused here despite restoring fine (exports carry full rows,
// so additive columns flow through).
const KNOWN_JOURNAL_IDX = 28;

// Restore order = EXPORTED_TABLES order (FK-safe). Column lists come from the
// backup rows themselves (drizzle exports camelCase keys → snake_case here).
// Must cover every EXPORTED_TABLES entry (backup-policy.ts), in the same
// FK-safe order — a table exported but missing here is silently skipped on
// restore (which is how people/person_roles/team_staff/tenant_config were
// dropped until 2026-08-12, breaking players.person_id on any restore).
const PK: Record<string, string[]> = {
  tenants: ["id"],
  tenant_branding: ["tenant_id"],
  tenant_billing: ["tenant_id"],
  tenant_config: ["tenant_id"],
  users: ["id"],
  user_tenant_roles: ["id"],
  people: ["id"],
  person_roles: ["id"],
  competitions: ["id"],
  tournament_config: ["competition_id"],
  competition_branding: ["competition_id"],
  pools: ["id"],
  teams: ["id"],
  team_staff: ["id"],
  pool_teams: ["pool_id", "team_id"],
  players: ["id"],
  matches: ["id"],
  events: ["id"],
  match_sessions: ["id"],
  interrupt_requests: ["id"],
  match_officials: ["id"],
  match_signatures: ["id"],
  csv_imports: ["id"],
  audit_log: ["id"],
};

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const [, , file, ...flags] = process.argv;
if (!file) {
  console.error(
    "Usage: npx tsx scripts/restore-backup.mts <file.json.gz> --schema prod|homolog [--dry-run]",
  );
  process.exit(1);
}
const dryRun = flags.includes("--dry-run");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to the TARGET database (direct connection).");
  process.exit(1);
}

/** Which set of tables receives the rows. Explicit or nothing (spec/28). */
const schemaArg = flags[flags.indexOf("--schema") + 1];
const targetSchema =
  flags.includes("--schema") &&
  (schemaArg === "prod" || schemaArg === "public"
    ? "public"
    : schemaArg === "homolog"
      ? "homolog"
      : null);
if (!targetSchema) {
  console.error(
    "Refusing to guess which tables to restore into.\n" +
      "  --schema homolog   → the homologation clone\n" +
      "  --schema prod      → PRODUCTION tables",
  );
  process.exit(1);
}

const raw = readFileSync(file);
const doc = JSON.parse(
  (file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"),
);

if (doc.formatVersion !== EXPECTED_FORMAT) {
  console.error(`Unsupported formatVersion ${doc.formatVersion} (expected ${EXPECTED_FORMAT}).`);
  process.exit(1);
}
if (doc.migrationJournalIdx > KNOWN_JOURNAL_IDX) {
  console.error(
    `Backup written against migration idx ${doc.migrationJournalIdx}, this script knows ${KNOWN_JOURNAL_IDX}. ` +
      "Update the script (and check schema compatibility) first.",
  );
  process.exit(1);
}

console.log(
  `Restoring ${doc.kind} backup of tenant ${doc.tenantId} (exported ${doc.exportedAt})` +
    ` into schema "${targetSchema}"${targetSchema === "public" ? " — PRODUCTION" : ""}` +
    (doc.scope?.competitionId ? ` scope competition ${doc.scope.competitionId}` : "") +
    (dryRun ? " [dry-run]" : ""),
);

const order = Object.keys(PK);
for (const t of order) {
  const rows: Record<string, unknown>[] = doc.tables[t] ?? [];
  console.log(`  ${t.padEnd(22)} ${rows.length} rows`);
}

if (dryRun) process.exit(0);

// One entry, no `public` fallback — a table missing from the target must error
// rather than resolve against production data (spec/28 §0).
const sql = postgres(url, {
  max: 1,
  connection: { search_path: `${targetSchema}, extensions` },
});
try {
  // Prove the connection really landed where we asked before writing a row: the
  // whole safety of this rests on one startup parameter being honoured.
  const [{ cs }] = await sql<{ cs: string | null }[]>`select current_schema() as cs`;
  if (cs !== targetSchema) {
    throw new Error(
      `Refusing to restore: asked for schema "${targetSchema}" but the connection resolves to "${cs ?? "nothing"}".`,
    );
  }
  await sql.begin(async (tx) => {
    for (const table of order) {
      const rows: Record<string, unknown>[] = doc.tables[table] ?? [];
      if (rows.length === 0) continue;
      const pk = PK[table];
      for (const row of rows) {
        const entries = Object.entries(row).map(([k, v]) => [snake(k), v] as const);
        const cols = entries.map(([k]) => k);
        const vals = entries.map(([, v]) =>
          v !== null && typeof v === "object" ? JSON.stringify(v) : v,
        );
        const updatable = cols.filter((c) => !pk.includes(c));
        const colList = cols.map((c) => `"${c}"`).join(",");
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
        const conflict = pk.map((c) => `"${c}"`).join(",");
        const updates = updatable.map((c) => `"${c}" = excluded."${c}"`).join(",");
        const stmt =
          `insert into "${table}" (${colList}) values (${placeholders})` +
          (updatable.length > 0
            ? ` on conflict (${conflict}) do update set ${updates}`
            : ` on conflict (${conflict}) do nothing`);
        await tx.unsafe(stmt, vals as never[]);
      }
      console.log(`  ✓ ${table}`);
    }
  });
  console.log("Restore complete.");
} finally {
  await sql.end();
}
