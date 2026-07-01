// Next sequential match number within a competition, computed with SQL MAX
// instead of fetching every row. Accepts `db` or a transaction handle so
// bracket generation can call it inside its advisory-locked transaction.
import { eq, max } from "drizzle-orm";
import { db } from "@/db";
import { matches } from "@/db/schema";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function nextMatchNumber(
  exec: Executor,
  competitionId: string,
): Promise<number> {
  const rows = await exec
    .select({ n: max(matches.matchNumber) })
    .from(matches)
    .where(eq(matches.competitionId, competitionId));
  return (rows[0]?.n ?? 0) + 1;
}
