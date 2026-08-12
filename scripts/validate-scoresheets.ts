// Scoresheet integrity check: does the official e-scoresheet's derived data
// agree with an INDEPENDENT re-count of the raw event log, for every match in a
// competition? The sheet is rebuilt from the log by its own survivor pass, so
// this is a real cross-check rather than a tautology — it catches ladder,
// substitution, time-out and results-block drift.
//
//   npx tsx --env-file=.env.local scripts/validate-scoresheets.ts [competitionId]
//
// Checks per match: set scores, sets won / winner, one RALLY_START per rally,
// substitution and time-out counts, service-ladder monotonicity + set-end
// circles (paper convention: a box is filled when the server LOSES serve, so a
// team holding serve mid-set is legitimately behind), and that the PDF renders.
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, matches } from "@/db/schema";
import { loadMatchReport } from "@/lib/match-report";
import { buildOfficialSheetData } from "@/lib/scoresheet/official-data";
import { renderIndoorOfficialPdf } from "@/lib/scoresheet/indoor-official";
import { resolveMatchConfig } from "@/lib/match-engine";

const COMPETITION_ID = process.argv[2] ?? "comp_lna_2526";

let failures = 0;
const bad = (m: string) => { failures++; console.log("  ✗ " + m); };

async function main() {
  const ms = await db
    .select({ id: matches.id, n: matches.matchNumber, status: matches.status,
              setsA: matches.setsWonA, setsB: matches.setsWonB, winner: matches.winner })
    .from(matches).where(eq(matches.competitionId, COMPETITION_ID))
    .orderBy(asc(matches.matchNumber));

  let pdfBytes = 0, checked = 0;
  for (const m of ms) {
    const log = await db.select().from(events)
      .where(eq(events.matchId, m.id)).orderBy(asc(events.sequence));

    if (m.status === "SCHEDULED") {
      if (log.length !== 0) bad(`match ${m.n}: SCHEDULED but has ${log.length} events`);
      continue;
    }

    // ── naive recount straight from the raw log ──────────────────────────────
    const setScores: [number, number][] = [];
    let a = 0, b = 0, subs = 0, tos = 0, rallyStarts = 0, rallies = 0;
    let serving: "A" | "B" | null = null; // rally winner serves next
    for (const e of log) {
      if (e.eventType === "RALLY_WON_A") { a++; rallies++; serving = "A"; }
      else if (e.eventType === "RALLY_WON_B") { b++; rallies++; serving = "B"; }
      else if (e.eventType === "RALLY_START") rallyStarts++;
      else if (e.eventType === "SUBSTITUTION") subs++;
      else if (e.eventType === "TIMEOUT_REQUEST") tos++;
      else if (e.eventType === "SET_END") { setScores.push([a, b]); a = 0; b = 0; }
    }
    const partial: [number, number] | null = a + b > 0 ? [a, b] : null;

    const report = await loadMatchReport(m.id);
    const sheet = buildOfficialSheetData(report);
    checked++;

    // 1. every completed set's score matches the recount
    setScores.forEach(([ea, eb], i) => {
      const s = sheet.sets.find((x) => x.setNumber === i + 1) as unknown as
        { scoreA: number; scoreB: number } | undefined;
      if (!s) return bad(`match ${m.n} set ${i + 1}: missing from sheet`);
      if (s.scoreA !== ea || s.scoreB !== eb)
        bad(`match ${m.n} set ${i + 1}: sheet ${s.scoreA}-${s.scoreB} vs log ${ea}-${eb}`);
    });

    // 2. the in-progress set of a LIVE match is on the sheet too
    if (partial) {
      const s = sheet.sets.find((x) => x.setNumber === setScores.length + 1) as unknown as
        { scoreA: number; scoreB: number } | undefined;
      if (!s) bad(`match ${m.n}: live set ${setScores.length + 1} missing from sheet`);
      else if (s.scoreA !== partial[0] || s.scoreB !== partial[1])
        bad(`match ${m.n} live set: sheet ${s.scoreA}-${s.scoreB} vs log ${partial[0]}-${partial[1]}`);
    }

    // 3. sets won / winner agree with the match row
    const wonA = setScores.filter(([x, y]) => x > y).length;
    const wonB = setScores.length - wonA;
    if (m.setsA !== wonA || m.setsB !== wonB)
      bad(`match ${m.n}: row ${m.setsA}-${m.setsB} vs log ${wonA}-${wonB}`);
    if (m.status === "FINISHED") {
      const w = wonA > wonB ? "A" : "B";
      if (m.winner !== w) bad(`match ${m.n}: winner ${m.winner} vs log ${w}`);
      if (wonA !== 3 && wonB !== 3) bad(`match ${m.n}: FINISHED without a 3rd set won`);
    }

    // 4. every rally was opened by a RALLY_START (complete timing log)
    if (rallyStarts !== rallies)
      bad(`match ${m.n}: ${rallies} rallies but ${rallyStarts} RALLY_STARTs`);

    // 5. sheet's substitution + timeout boxes account for every such event
    const sheetSubs = sheet.sets.reduce((n, s) => {
      const x = s as unknown as { subsA?: unknown[]; subsB?: unknown[] };
      return n + (x.subsA?.length ?? 0) + (x.subsB?.length ?? 0);
    }, 0);
    const sheetTos = sheet.sets.reduce((n, s) => {
      const x = s as unknown as { timeouts?: unknown[] };
      return n + (x.timeouts?.length ?? 0);
    }, 0);
    if (sheetSubs !== subs) bad(`match ${m.n}: ${subs} SUBSTITUTION events, sheet shows ${sheetSubs}`);
    if (sheetTos !== tos) bad(`match ${m.n}: ${tos} timeouts, sheet shows ${sheetTos}`);

    // 6. service ladders. Paper convention: one entry per SERVICE TURN holding
    //    the score reached, so the invariants are monotonicity, a final entry
    //    equal to the set score, and exactly one circle (the set-ending point).
    type Entry = { col: number; round: number; score: number; circled: boolean };
    for (const s of sheet.sets) {
      const x = s as unknown as {
        setNumber: number; scoreA: number; scoreB: number; winner: string | null;
        serviceA?: Entry[]; serviceB?: Entry[];
      };
      const complete = x.winner != null;
      for (const [side, ladder, score] of [
        ["A", x.serviceA ?? [], x.scoreA],
        ["B", x.serviceB ?? [], x.scoreB],
      ] as const) {
        const tag = `match ${m.n} set ${x.setNumber} ladder ${side}`;
        for (let i = 1; i < ladder.length; i++)
          if (ladder[i].score <= ladder[i - 1].score)
            bad(`${tag}: not increasing (${ladder[i - 1].score} → ${ladder[i].score})`);
        // Paper convention: a service-turn box is filled when the team LOSES
        // serve (or circled at set end). So mid-set, the team currently holding
        // serve may legitimately be "behind" by the points of its open turn;
        // every other case must land exactly on the score.
        const last = ladder[ladder.length - 1];
        const openTurn = !complete && serving === side;
        if (score > 0 && !last && !openTurn)
          bad(`${tag}: empty but team scored ${score}`);
        else if (last && !openTurn && last.score !== score)
          bad(`${tag}: ends at ${last.score}, set score is ${score}`);
        else if (last && openTurn && last.score > score)
          bad(`${tag}: ends at ${last.score}, above the score ${score}`);
        const circles = ladder.filter((e) => e.circled).length;
        if (complete && circles !== 1) bad(`${tag}: ${circles} circles on a finished set`);
        if (complete && last && !last.circled) bad(`${tag}: final point not circled`);
        if (!complete && circles !== 0) bad(`${tag}: circled entry on an unfinished set`);
      }
    }

    // 7. the PDF renders
    const pdf = await renderIndoorOfficialPdf(report, sheet, await resolveMatchConfig(m.id));
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
      bad(`match ${m.n}: not a PDF`);
    if (pdf.length < 20_000) bad(`match ${m.n}: suspiciously small PDF (${pdf.length}B)`);
    pdfBytes += pdf.length;
  }

  console.log(`\nchecked ${checked} played matches; ${(pdfBytes / checked / 1024).toFixed(0)}KB avg PDF`);
  console.log(failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
