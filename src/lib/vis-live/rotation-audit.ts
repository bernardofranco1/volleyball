/**
 * The rotation shadow: run our own model beside the feed and record where they
 * part company (spec/42).
 *
 * Shown nowhere. The boards keep taking VIS at its word — overriding the source
 * of record would put six names on an arena screen that VIS disagrees with, and
 * the measured divergence is real but rare. This is here so that after a day of
 * matches the question "is the feed's rotation trustworthy?" has an answer made
 * of rows rather than impressions.
 *
 * Two properties it has to have, because it runs inside the poll loop of a live
 * board at one request a second:
 *
 *  - **It must never break a board.** Every failure is swallowed. A logging
 *    table that takes a scoreboard down with it would be a bad trade at any
 *    price.
 *  - **It must not write on every poll.** A divergence is recorded once per
 *    (match, set, rally, team, kind): an in-memory set stops the repeat within
 *    an instance, and a unique index makes another instance's duplicate a
 *    no-op rather than a second row.
 */

import { db } from "@/db";
import { visRotationLog } from "@/db/schema";
import { newId } from "@/lib/id";
import { allTagAttrs, num, str, tagBlocks, type Attrs } from "./parse";
import {
  inferFirstServer,
  ralliesOf,
  rotateOnce,
  rotationsBefore,
  sixOf,
  type Side,
  type Six,
} from "./rotation";

/** Divergences already written by this instance. */
const logged = new Set<string>();
/** First server per match+set, learned by seeing the set before its first rally. */
const firstServers = new Map<string, Side>();
/** Keep the memo from growing without bound over a long-lived instance. */
const MAX_MEMO = 500;

function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.size > MAX_MEMO) map.clear();
  map.set(key, value);
}

/**
 * Note who serves first, while the set still has no rallies.
 *
 * This is the only moment `Set@NoServingTeam` means "first server": one rally
 * later it already means "whoever won that rally". A board polling every second
 * always passes through this state, so in practice it is observed rather than
 * inferred — except on an instance that came up mid-set, which is exactly what
 * the inference in rotation.ts is for.
 */
export function noteFirstServer(
  matchNo: number,
  setNo: number,
  rallies: number,
  servingSide: Side | null,
): void {
  if (rallies > 0 || !servingSide) return;
  remember(firstServers, `${matchNo}:${setNo}`, servingSide);
}

/** What we know about who served this set's first rally, if anything. */
export function firstServerFor(matchNo: number, setNo: number): Side | null {
  return firstServers.get(`${matchNo}:${setNo}`) ?? null;
}

export interface RotationAuditRow {
  matchNo: number;
  setNo: number;
  rallyNo: number;
  team: Side;
  kind: "rotation" | "libero-serving";
  firstServer: Side | null;
  confidence: string;
  expectedTurns: number | null;
  feedSix: string | null;
  modelSix: string | null;
  scoreA: number;
  scoreB: number;
}

/**
 * Compare the feed's published lineups with the model's, for the latest set.
 * Pure: it returns what it found and writes nothing.
 */
export function auditSet(opts: {
  matchNo: number;
  setInner: string;
  setAttrs: Attrs | null;
  noTeamA: number;
  noTeamB: number;
  liberos: ReadonlySet<string>;
}): RotationAuditRow[] {
  const { matchNo, setInner, setAttrs, noTeamA, noTeamB, liberos } = opts;
  const setNo = num(setAttrs, "No", 0);
  const rallies = ralliesOf(setInner);
  if (rallies.length === 0) return [];

  const teamNo: Record<Side, number> = { A: noTeamA, B: noTeamB };
  const lineupFor = (blob: string, side: Side): Six | null => {
    const l = allTagAttrs(blob, "LineUp").find((x) => num(x, "NoTeam", -1) === teamNo[side]);
    return l ? sixOf(l) : null;
  };

  const head = setInner.split("<Events")[0];
  const starting: Record<Side, Six | null> = { A: lineupFor(head, "A"), B: lineupFor(head, "B") };
  if (!starting.A || !starting.B) return [];

  const rallyBlobs = setInner.split("<Rally ").slice(1);
  const published: Record<Side, (Six | null)[]> = {
    A: rallyBlobs.map((r) => lineupFor(r, "A")),
    B: rallyBlobs.map((r) => lineupFor(r, "B")),
  };

  const { firstServer, confidence } = inferFirstServer(
    rallies,
    starting as Record<Side, Six>,
    published,
    liberos,
    firstServers.get(`${matchNo}:${setNo}`) ?? null,
  );
  if (!firstServer) return [];

  const last = rallies[rallies.length - 1];
  const out: RotationAuditRow[] = [];

  for (const side of ["A", "B"] as const) {
    // Walk the set forward, one rally at a time, rather than predicting each
    // rally from the starting six.
    //
    // The absolute form does not survive contact with a real match: a
    // substitution or a libero coming on changes WHO is on court, not where
    // anybody is standing, and a model that only ever rotates the starting
    // lineup then disagrees with the feed for the rest of the set. The first
    // version of this did exactly that and reported ninety divergences in a
    // match with nine.
    //
    // So: expect a rotation only when the rules call for one, and whenever the
    // SET of players changes — a substitution, a libero swapping in or out —
    // take the feed's word and carry on from there. What remains, and is worth
    // recording, is the same six standing in a different order.
    let expect: Six | null = starting[side];
    for (const r of rallies) {
      const seen = published[side][r.index - 1];
      if (!seen) continue;
      if (!expect) { expect = seen; continue; }

      const sameSquad =
        [...expect].sort().join(",") === [...seen].sort().join(",");
      if (!sameSquad) {
        expect = seen; // a substitution or a libero change: reseed, do not judge
      } else if (expect.join() !== seen.join()) {
        const turns = rotationsBefore(rallies, firstServer, r.index)[side];
        out.push({
          matchNo, setNo, rallyNo: r.index, team: side, kind: "rotation",
          firstServer, confidence, expectedTurns: turns,
          feedSix: seen.join(","), modelSix: expect.join(","),
          scoreA: r.scoreA, scoreB: r.scoreB,
        });
        expect = seen; // reseed so one disagreement does not cascade
      }

      // Advance to the rotation the rules give the NEXT rally.
      const during = rotationsBefore(rallies, firstServer, r.index);
      const after = rotationsBefore(rallies, firstServer, r.index + 1);
      if (after[side] > during[side]) expect = rotateOnce(expect);
    }

    // A libero cannot serve (FIVB 19.3.2.1). If the feed has one in position 1
    // of the side about to serve, the feed is mid-write or wrong.
    const servingNo = num(setAttrs, "NoServingTeam", -1);
    if (servingNo === teamNo[side]) {
      const newest = published[side][published[side].length - 1];
      if (newest && liberos.has(newest[0])) {
        out.push({
          matchNo, setNo, rallyNo: 0, team: side, kind: "libero-serving",
          firstServer, confidence, expectedTurns: null,
          feedSix: newest.join(","), modelSix: null,
          scoreA: last.scoreA, scoreB: last.scoreB,
        });
      }
    }
  }
  return out;
}

/** Write anything new. Never throws — a board must not depend on this. */
export async function recordRotationAudit(rows: RotationAuditRow[]): Promise<void> {
  const fresh = rows.filter((r) => {
    const key = `${r.matchNo}:${r.setNo}:${r.rallyNo}:${r.team}:${r.kind}`;
    if (logged.has(key)) return false;
    logged.add(key);
    return true;
  });
  if (fresh.length === 0) return;
  if (logged.size > 20_000) logged.clear();
  try {
    await db
      .insert(visRotationLog)
      .values(fresh.map((r) => ({ id: newId("rot"), ...r })))
      .onConflictDoNothing();
  } catch {
    // Deliberately silent: this is instrumentation, not a feature.
  }
}

/** Liberos of both teams, from the roster's own flag. */
export function liberosOf(xml: string): Set<string> {
  const out = new Set<string>();
  for (const t of tagBlocks(xml, "Team")) {
    for (const v of allTagAttrs(t.inner, "VolleyballPlayer")) {
      if (str(v, "IsLibero") === "true") {
        const no = str(v, "NoPlayer");
        if (no) out.add(no);
      }
    }
  }
  return out;
}
