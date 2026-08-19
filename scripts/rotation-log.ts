/**
 * Read back the rotation shadow (spec/42).
 *
 * The boards take VIS at its word; this is the record of where our own model
 * disagreed, written in the background and surfaced nowhere. Run it after a
 * day's play to judge the feed on evidence.
 *
 *   DB_SCHEMA=public npx tsx --env-file=.env.local scripts/rotation-log.ts
 *   DB_SCHEMA=public npx tsx --env-file=.env.local scripts/rotation-log.ts --match 27550
 *   DB_SCHEMA=public npx tsx --env-file=.env.local scripts/rotation-log.ts --since 2026-08-19 --full
 *
 * `--full` prints every row; the default is a summary per match, which is
 * usually the question being asked ("was yesterday clean?").
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../src/db";
import { visRotationLog } from "../src/db/schema";

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

async function main() {
  const matchNo = arg("match") ? Number(arg("match")) : null;
  const since = arg("since")
    ? new Date(`${arg("since")}T00:00:00Z`)
    : new Date(Date.now() - 36 * 3600 * 1000);

  const rows = await db
    .select()
    .from(visRotationLog)
    .where(
      matchNo != null
        ? and(gte(visRotationLog.createdAt, since), eq(visRotationLog.matchNo, matchNo))
        : gte(visRotationLog.createdAt, since),
    )
    .orderBy(desc(visRotationLog.createdAt))
    .limit(5000);

  console.log(
    `schema ${process.env.DB_SCHEMA ?? "(default)"} · since ${since.toISOString()} · ${rows.length} divergences\n`,
  );
  if (rows.length === 0) {
    console.log("Nothing recorded — our model and the feed agreed throughout.");
    return;
  }

  const byMatch = new Map<number, typeof rows>();
  for (const r of rows) byMatch.set(r.matchNo, [...(byMatch.get(r.matchNo) ?? []), r]);

  for (const [no, list] of [...byMatch].sort((a, b) => a[0] - b[0])) {
    const kinds = new Map<string, number>();
    for (const r of list) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    const sets = new Set(list.map((r) => r.setNo));
    console.log(
      `match ${no}: ${list.length} divergence(s) across set(s) ${[...sets].sort().join(",")} — ` +
        [...kinds].map(([k, n]) => `${k} ${n}`).join(", "),
    );
    const confidences = new Set(list.map((r) => r.confidence));
    console.log(`   first server known by: ${[...confidences].join(", ")}`);
    if (process.argv.includes("--full")) {
      for (const r of list.slice().reverse()) {
        console.log(
          `   set ${r.setNo} rally ${r.rallyNo} team ${r.team} [${r.kind}] ` +
            `${r.scoreA}-${r.scoreB} turns=${r.expectedTurns ?? "-"}\n` +
            `      feed  ${r.feedSix}\n` +
            (r.modelSix ? `      model ${r.modelSix}\n` : ""),
        );
      }
    }
  }
  if (!process.argv.includes("--full")) console.log("\nPass --full for every row.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
