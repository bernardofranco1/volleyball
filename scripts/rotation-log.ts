/**
 * Read back the rotation shadow (spec/42) and the enforced rotation's own
 * findings (spec/43).
 *
 * Since spec/43 the boards no longer take VIS at its word for the rotation, so
 * this has two kinds of row in it:
 *
 *  - the spec/42 shadow — `rotation`, `libero-serving` — the feed's published
 *    lineup against an independent model, with no verdict either way;
 *  - the spec/43 enforcement — everything else — where the rally's own SERVE
 *    ACTION adjudicates, so `feed-wrong-confirmed` and `model-wrong-confirmed`
 *    are judgements rather than observations.
 *
 * `serve-anomaly` is the interesting one to watch: a serve that the rules and
 * the feed's own lineup both say should not have happened. One of those is a
 * wrong-server fault on court (real, and rare); a run of them in one match is
 * more likely a scouting problem worth reporting upstream.
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
    // `confidence` packs how the first server was known and, for spec/43 rows,
    // the disagreement itself as "observed|<served>≠<predicted>".
    const confidences = new Set(
      list.map((r) => (r.confidence ?? "-").split("|")[0]),
    );
    console.log(`   first server known by: ${[...confidences].join(", ")}`);
    const overrides = list.filter((r) => r.kind.startsWith("reanchor")).length;
    const anomalies = list.filter((r) => r.kind === "serve-anomaly").length;
    if (overrides || anomalies) {
      console.log(
        `   enforced overrides: ${overrides} · serves against the rules: ${anomalies}`,
      );
    }
    if (process.argv.includes("--full")) {
      for (const r of list.slice().reverse()) {
        const servers = (r.confidence ?? "").split("|")[1];
        console.log(
          `   set ${r.setNo} rally ${r.rallyNo} team ${r.team} [${r.kind}] ` +
            `${r.scoreA}-${r.scoreB} turns=${r.expectedTurns ?? "-"}` +
            (servers ? ` served≠predicted ${servers}` : "") +
            `\n      feed  ${r.feedSix}\n` +
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
