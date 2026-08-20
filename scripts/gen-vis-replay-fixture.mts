/**
 * Capture the donor match for the replay board (spec/44).
 *
 * READ-ONLY: only `Get*` envelopes are ever sent (incident 2026-07-29).
 *
 *   npx tsx --env-file=.env.local scripts/gen-vis-replay-fixture.mts [matchNo]
 *
 * Writes `src/lib/vis-live/replay-capture.ts` with the payload embedded as a
 * string, exactly as mock.ts does: the replay must work inside the bundle with
 * no filesystem, and must never reach VIS.
 *
 * What is dropped, and why it can be:
 *
 *  - **every `PlayerStatistics` and `TeamStatistics` row.** The replay
 *    RECOMPUTES them at each frame from the action stream, because a capture's
 *    final totals shown from rally one would be a lie the whole way through.
 *    Three of the four figures the board renders recompute exactly (verified
 *    against this match and 27547): per-player `TotalPoints` = that player's
 *    `Note="3"` actions, `BlockPoint` = the same on `Skill="1"`, `ServePoint`
 *    on `Skill="4"`, and team `OpponentErrors` = `<TeamPoint Note="3">` rows.
 *    Attack points are the exception — VIS credits a few more than the action
 *    stream carries as `Skill="6" Note="3"` — so the replay's attack bar reads
 *    slightly low against the real one. Recorded in spec/44 §4.
 *  - **the `Identifier` UUIDs**, which are VIS's idempotency keys for uploads
 *    and are read by nothing here. Roughly a quarter of the bytes.
 *
 * Everything else is verbatim, including every rally, action, substitution,
 * timeout, challenge and time offset.
 */

import { writeFileSync } from "node:fs";

const ENDPOINT = "https://www.fivb.org/Vis2009/XmlRequest.asmx";
const DONOR = 27550;

async function get(envelope: string): Promise<string> {
  if (!/^<Requests><Request\s+Type="Get[A-Za-z]*"/.test(envelope)) {
    throw new Error("refusing a non-Get VIS request — this script is read-only");
  }
  const appId = process.env.VIS_APP_ID?.trim();
  if (!appId) throw new Error("VIS_APP_ID is not set");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", "X-FIVB-App-ID": appId },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`VIS HTTP ${res.status}`);
  if (/<(Error|BadParameter|NotAuthorized|BadMatchNo)\b/.test(text)) {
    throw new Error(`VIS soft error: ${text.slice(0, 200)}`);
  }
  return text;
}

async function main() {
  const matchNo = Number(process.argv[2]) || DONOR;
  const raw = await get(
    `<Requests><Request Type="GetVolleyLive" No="${matchNo}" Options="65535" Version="0"></Request></Requests>`,
  );
  const trimmed = raw
    .replace(/<PlayerStatistics\b[^>]*\/>\s*/g, "")
    .replace(/<TeamStatistics\b[^>]*\/>\s*/g, "")
    .replace(/\sIdentifier="[^"]*"/g, "");

  const path = "src/lib/vis-live/replay-capture.ts";
  writeFileSync(
    path,
    `/**\n` +
      ` * The replay board's donor match (spec/44), captured read-only from VIS by\n` +
      ` * scripts/gen-vis-replay-fixture.mts. Do not edit by hand: regenerate.\n` +
      ` *\n` +
      ` * Statistics rows and Identifier UUIDs are stripped; see the generator for\n` +
      ` * why, and for which figures the replay recomputes.\n` +
      ` */\n\n` +
      `export const REPLAY_CAPTURE_XML = ${JSON.stringify(trimmed)};\n`,
  );
  const rallies = (trimmed.match(/<Rally\b/g) ?? []).length;
  console.log(
    `${path}: match ${matchNo}, ${(trimmed.length / 1024).toFixed(0)} KB ` +
      `(from ${(raw.length / 1024).toFixed(0)} KB), ${rallies} rallies`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
