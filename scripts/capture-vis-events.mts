/**
 * Capture the full event stream of finished VIS matches as test fixtures
 * (spec/43 §8).
 *
 * READ-ONLY, and enforced as such: only `Get*` envelopes are ever sent. The
 * incident of 2026-07-29 — a guest-tier probe of an Upload request that erased a
 * production match's result and its 86-rally live store — is why that guard
 * exists here as well as in the runtime client.
 *
 *   npx tsx --env-file=.env.local scripts/capture-vis-events.mts 27550 27547
 *
 * The saved fixture keeps the Match/Team/Set/Events skeleton and drops the
 * statistics rows, which are 80% of the bytes and irrelevant to rotation. The
 * roster is kept in full: names and libero flags are what the enforced lineup
 * is dressed with.
 */

import { writeFileSync } from "node:fs";

const ENDPOINT = "https://www.fivb.org/Vis2009/XmlRequest.asmx";
const DEFAULT_MATCHES = [27550, 27547, 27549, 26959];

async function get(envelope: string): Promise<string> {
  if (!/^<Requests><Request\s+Type="Get[A-Za-z]*"/.test(envelope)) {
    throw new Error("refusing a non-Get VIS request — this script is read-only");
  }
  const appId = process.env.VIS_APP_ID?.trim();
  if (!appId) throw new Error("VIS_APP_ID is not set");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "X-FIVB-App-ID": appId,
    },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`VIS HTTP ${res.status}`);
  if (/<(Error|BadParameter|NotAuthorized|BadMatchNo)\b/.test(text)) {
    throw new Error(`VIS soft error: ${text.slice(0, 200)}`);
  }
  return text;
}

/**
 * Two edits, both of which the fixture header must declare, because a fixture
 * that quietly differs from what VIS sends is worse than no fixture:
 *
 *  - the statistics rows go, except a `NoPlayer`/`NoShirt`/`NoTeam`/
 *    `TotalPoints` remnant per player — they are ~30% of the bytes and say
 *    nothing about rotation;
 *  - the `Identifier` UUIDs go — another ~25%, and nothing reads them. They are
 *    VIS's idempotency keys for UPLOADS, which this codebase never sends.
 *
 * Everything the enforcement model consumes — Action/Skill/NoPlayer, LineUp,
 * Substitution, the rally scores, the rosters and their libero flags — is
 * verbatim.
 */
function trim(xml: string): string {
  const keep = ["NoPlayer", "NoShirt", "NoTeam", "TotalPoints"];
  return xml
    .replace(/<PlayerStatistics\b([^>]*)\/>/g, (_whole, attrs: string) => {
      const kept = keep
        .map((k) => new RegExp(`\\s${k}="[^"]*"`).exec(attrs)?.[0] ?? "")
        .join("");
      return `<PlayerStatistics${kept} />`;
    })
    .replace(/<TeamStatistics\b[^>]*\/>/g, "")
    .replace(/\sIdentifier="[^"]*"/g, "");
}

async function main() {
  const matches = process.argv.slice(2).map(Number).filter(Boolean);
  for (const no of matches.length > 0 ? matches : DEFAULT_MATCHES) {
    const xml = await get(
      `<Requests><Request Type="GetVolleyLive" No="${no}" Options="65535" Version="0"></Request></Requests>`,
    );
    const out = trim(xml);
    const path = `src/__tests__/fixtures/vis/volley-live-events-${no}.xml`;
    writeFileSync(path, out);
    const rallies = (out.match(/<Rally\b/g) ?? []).length;
    console.log(
      `${path}: ${(out.length / 1024).toFixed(0)} KB ` +
        `(from ${(xml.length / 1024).toFixed(0)} KB), ${rallies} rallies`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
