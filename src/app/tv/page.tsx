/**
 * The TV overlay's front door (spec/47): paste a stream link, pick a match, go.
 *
 * Unlinked on purpose. Nothing in the app points here — no nav item, no button,
 * no index entry — and both this page and the output page are noindex. The
 * mechanism is exactly the one `/m/{matchNo}` already relies on (spec/38): the
 * URL is the credential, and it exposes nothing a public board does not.
 *
 * Deliberately plain. It is a utility an operator sees once per session, before
 * anything goes to air, and every pixel of design effort belongs on the graphics
 * instead.
 */

import type { Metadata } from "next";
import { getMatchList, getVisCompetition } from "@/lib/vis-live/store";
import { visCompetitions } from "@/lib/vis-live/resolve";
import { TvLauncher, type LaunchableMatch } from "@/components/tv/TvLauncher";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TV Overlay",
  robots: { index: false, follow: false },
};

export default async function TvEntryPage() {
  const comps = await visCompetitions().catch(() => []);

  // Every match of every VIS-linked competition, live first. A production is
  // set up before the match starts, so UPCOMING has to be offered too — and a
  // finished one is worth keeping for a rehearsal against real data.
  const lists = await Promise.all(
    comps.map(async (c) => {
      const rows = await getMatchList(c.visTournamentNo)
        .then((r) => r.value)
        .catch(() => []);
      return rows.map((m) => ({
        matchNo: m.matchNo,
        competition: c.competitionName,
        label: `${m.teamACode ?? m.teamAName} v ${m.teamBCode ?? m.teamBName}`,
        status: m.status,
        when: m.scheduledVenue ?? m.dateLocal ?? null,
        hall: m.hall,
      }));
    }),
  );

  const rank = { LIVE: 0, UPCOMING: 1, FINISHED: 2 } as const;
  const matches: LaunchableMatch[] = lists
    .flat()
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] || (a.when ?? "").localeCompare(b.when ?? ""),
    )
    .slice(0, 200);

  // The rehearsal boards (spec/44). Worth surfacing here above all: an operator
  // can align the delay and learn the hotkeys against a match that is always
  // running, at any hour, without waiting for a fixture.
  void getVisCompetition;

  return <TvLauncher matches={matches} />;
}
