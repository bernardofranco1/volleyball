/**
 * Point a competition's boards at a feed (spec/45 W2.2).
 *
 * The VIS tournament link is set by provision-vis-live.ts; this is its
 * VolleyStation counterpart plus the lever that decides which feed a
 * competition's boards SERVE by default:
 *
 *   vis   the VIS live feed (the default, and what every competition has today)
 *   vs    VolleyStation, falling back to VIS on any failure
 *   auto  VolleyStation when mapped and healthy, else VIS
 *
 * An individual screen always overrides this with `?source=vis|vs` on its URL,
 * so this is the setting that moves every OTHER screen — which is what makes
 * it the mid-event lever: if VolleyStation misbehaves at 18-17 in the fourth,
 * one run of this puts every default board back on VIS within a poll, with no
 * deploy and no restart.
 *
 * Dry-run by default — prints what it would write and touches nothing.
 *   npx tsx --env-file=.env.local scripts/set-board-source.ts                     (list)
 *   npx tsx --env-file=.env.local scripts/set-board-source.ts --vis 1766 --vs 6181
 *   npx tsx --env-file=.env.local scripts/set-board-source.ts --vis 1766 --source vs --execute
 *
 * PRODUCTION needs the prefix, as always (AGENTS.md):
 *   DB_SCHEMA=public npx tsx --env-file=.env.local scripts/set-board-source.ts … --execute
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { competitions } from "../src/db/schema";

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const execute = process.argv.includes("--execute");

async function main() {
  const schema = process.env.DB_SCHEMA ?? "(default)";
  const visNo = arg("vis") ? Number(arg("vis")) : null;
  const vsId = arg("vs") ? Number(arg("vs")) : null;
  const source = arg("source");

  const rows = await db
    .select({
      id: competitions.id,
      name: competitions.name,
      visTournamentNo: competitions.visTournamentNo,
      vsChampionshipId: competitions.vsChampionshipId,
      boardSource: competitions.boardSource,
    })
    .from(competitions);
  const linked = rows.filter((r) => r.visTournamentNo != null);

  if (visNo == null) {
    console.log(`schema ${schema} — VIS-linked competitions:\n`);
    for (const r of linked) {
      console.log(
        `  VIS ${String(r.visTournamentNo).padEnd(5)} ` +
          `VS ${String(r.vsChampionshipId ?? "—").padEnd(6)} ` +
          `source ${r.boardSource.padEnd(5)} ${r.name}`,
      );
    }
    console.log("\nPass --vis <tournamentNo> with --vs <championshipId> and/or --source vis|vs|auto.");
    return;
  }

  const target = linked.find((r) => r.visTournamentNo === visNo);
  if (!target) {
    console.error(`No competition with vis_tournament_no ${visNo} in schema ${schema}.`);
    process.exit(1);
  }
  if (source && !["vis", "vs", "auto"].includes(source)) {
    console.error(`--source must be vis, vs or auto (got ${source}).`);
    process.exit(1);
  }
  // Refuse the one combination that reads as a working setup and is not: a
  // competition told to serve VolleyStation with nothing to serve it from.
  const nextVsId = vsId ?? target.vsChampionshipId;
  if ((source === "vs" || source === "auto") && nextVsId == null) {
    console.error(
      `Refusing: ${target.name} has no VolleyStation championship id, so it cannot serve '${source}'. Pass --vs <championshipId> too.`,
    );
    process.exit(1);
  }

  const changes: Record<string, unknown> = {};
  if (vsId != null) changes.vsChampionshipId = vsId;
  if (source) changes.boardSource = source as "vis" | "vs" | "auto";
  if (Object.keys(changes).length === 0) {
    console.log("Nothing to change — pass --vs and/or --source.");
    return;
  }

  console.log(
    `schema ${schema}${schema === "public" ? " — PRODUCTION" : ""}\n` +
      `  ${target.name}\n` +
      `    vs_championship_id ${target.vsChampionshipId ?? "—"} → ${changes.vsChampionshipId ?? target.vsChampionshipId ?? "—"}\n` +
      `    board_source       ${target.boardSource} → ${changes.boardSource ?? target.boardSource}\n` +
      (execute ? "" : "\n(dry run — pass --execute to write)"),
  );
  if (!execute) return;

  await db.update(competitions).set(changes).where(eq(competitions.id, target.id));
  console.log("\nWritten. Boards pick it up within one mapping TTL (10 min) or on the next cold start.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
