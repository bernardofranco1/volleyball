/**
 * VIS transport for the read-only live scoreboard (spec/34).
 *
 * TWO rules this module exists to enforce, both learned the hard way:
 *
 * 1. READ-ONLY. Only `Get*` request types may ever be sent. On 2026-07-29 a
 *    guest-tier probe of an Upload request silently destroyed a production
 *    match's result and its 86-rally live store (vis-connector
 *    docs/INCIDENT-2026-07-29-337016.md). The guard below makes a write
 *    impossible from this codebase rather than merely discouraged.
 *
 * 2. RAW `text/xml` BODY. The live feeds answer HTTP 400 when the envelope is
 *    posted form-encoded (`Request=<…>`), which is how most VIS clients send
 *    plain reads. Verified 2026-08-18; recorded in the quirk ledger.
 */

const ENDPOINT = "https://www.fivb.org/Vis2009/XmlRequest.asmx";
const TIMEOUT_MS = 8_000;

/** Only `Get…` requests. Anything else is a bug, not a runtime condition. */
const READ_ONLY = /^<Requests><Request\s+Type="Get[A-Za-z]*"/;

export class VisRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VisRequestError";
  }
}

/**
 * POST one VIS envelope and return the raw XML body.
 *
 * No retry loop: the caller's polling cadence IS the retry, and the store
 * serves its last good payload while VIS is unreachable — retrying inside a
 * 20-second poll would only stack requests on a struggling upstream.
 */
export async function visRequest(envelope: string): Promise<string> {
  if (!READ_ONLY.test(envelope)) {
    throw new VisRequestError(
      "refusing a non-Get VIS request — this module is read-only (spec/34)",
    );
  }
  const appId = process.env.VIS_APP_ID?.trim();
  if (!appId) {
    throw new VisRequestError("VIS_APP_ID is not set — cannot reach VIS");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      // Raw body, NOT form-encoded — see the module comment.
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "X-FIVB-App-ID": appId,
      },
      body: envelope,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new VisRequestError(`VIS HTTP ${res.status}`, res.status);
    }
    // VIS reports soft errors as HTTP 200 bodies (quirk ledger).
    if (/<(Error|BadParameter|ParameterMissing|NotAuthorized|BadMatchNo)\b/.test(text)) {
      throw new VisRequestError(`VIS soft error: ${text.slice(0, 160)}`);
    }
    return text;
  } catch (err) {
    if (err instanceof VisRequestError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new VisRequestError(`VIS timed out after ${TIMEOUT_MS}ms`);
    }
    throw new VisRequestError(
      `VIS request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `Options` bitmask for the board's live request, mapped empirically against
 * production on 2026-08-18 (the SDK does not publish the flag values):
 *
 *     2 → Match/Team/Set/Tournament/Pool only ......... ~2 KB
 *     8 → + team rosters (Player/VolleyballPlayer) ... ~13 KB
 *    16 → + LineUp (court positions 1-6 per set) ..... ~5 KB
 *  2048 → + Player/TeamStatistics, match totals ...... ~25 KB
 *   256 → + Player/TeamStatistics, per-set rows ...... ~58 KB (not needed)
 *     1 → + Rally/Action play-by-play ................ ~66 KB (not needed)
 * 65535 → everything ............................... ~284 KB (not needed)
 *
 *   512 → + the Events/Rally stream, which carries a LineUp PER RALLY ..~60 KB
 *
 * 8|16|512|2048 = 2584 → ~95 KB carrying exactly what the board renders:
 * score, sets, serving side, timeouts/subs/challenges, each player's point
 * total, and — the reason for bit 512 — the CURRENT rotation rather than only
 * the registered starting six (spec/35 W3). Polled once per PollDelay per
 * match and cached server-side, so the extra payload costs nothing per viewer.
 */
export const BOARD_OPTIONS = 2584;

export function volleyLiveEnvelope(matchNo: number, options = BOARD_OPTIONS): string {
  return `<Requests><Request Type="GetVolleyLive" No="${matchNo}" Options="${options}" Version="0"></Request></Requests>`;
}

/** Single match — the pre-start fallback, when no live row exists yet. */
export function volleyMatchEnvelope(matchNo: number): string {
  const fields = [
    "No", "NoTournament", "NoInTournament", "TeamACode", "TeamBCode",
    "TeamAName", "TeamBName", "DateLocal", "TimeLocal", "Status",
    "MatchPointsA", "MatchPointsB", "MatchResultText", "SetsResultsText",
    "Hall", "City", "CountryCode",
  ].join(" ");
  return `<Requests><Request Type="GetVolleyMatch" No="${matchNo}" Fields="${fields}"></Request></Requests>`;
}

/** Every match of a tournament — the day index and the match allowlist. */
export function volleyMatchListEnvelope(tournamentNo: number): string {
  const fields = [
    "No", "NoTournament", "NoInTournament", "TeamACode", "TeamBCode",
    "TeamAName", "TeamBName", "DateLocal", "TimeLocal", "Status",
    "MatchPointsA", "MatchPointsB", "MatchResultText", "SetsResultsText",
    "Hall", "City",
  ].join(" ");
  return `<Requests><Request Type="GetVolleyMatchList" Fields="${fields}"><Filter NoTournament="${tournamentNo}"/></Request></Requests>`;
}
