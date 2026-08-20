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
 * production on 2026-08-18 and completed on 2026-08-20 (the SDK does not
 * publish the flag values). Sizes are for a 3-set indoor match:
 *
 *     2 → Match/Team/Set/Tournament/Pool only ......... ~2 KB
 *     8 → + team rosters (Player/VolleyballPlayer) ... ~13 KB
 *    16 → + LineUp (court positions 1-6 per set) ..... ~5 KB
 *  2048 → + Player/TeamStatistics, match totals ...... ~25 KB
 *   256 → + Player/TeamStatistics, per-set rows ...... ~58 KB (not needed)
 *   512 → + the Events/Rally stream, a LineUp PER RALLY ~60 KB
 *     1 → + Action play-by-play inside each Rally ..... ~66 KB
 *  8192 → actions but no interruptions ............... (subsumed by 1)
 * 65535 → everything ............................... ~292 KB (not needed)
 *
 * Bits 4, 32, 64, 128, 1024 and 4096 were probed on 2026-08-20 and add nothing
 * for indoor: there is no further payload to fetch.
 *
 * 1|8|16|512|2048 = 2585 → ~160 KB carrying exactly what the board renders and
 * what the rotation must be proved against: score, sets, serving side,
 * timeouts/subs/challenges, each player's point total, the CURRENT rotation
 * rather than the registered starting six (bit 512, spec/35 W3), and — the
 * reason for bit 1 — every rally's `<Action>` rows and `<Substitution>` events.
 * The first Action of a rally is its SERVE, which names the player who actually
 * served: the ground truth the enforced rotation is anchored to (spec/43).
 *
 * The extra ~65 KB over spec/35's 2584 is paid back by the `Version` handshake
 * below, which answers every poll that changed nothing in ~0.1 KB. Polled once
 * per cadence interval per match and cached server-side, so no per-viewer cost.
 */
export const BOARD_OPTIONS = 2585;

/**
 * `Version` handshake (verified 2026-08-20): send back the root `Version` of
 * the payload you last received and VIS answers `<NoChanges />` instead of
 * repeating ~91 KB. An OLDER version returns the full snapshot — there is no
 * delta format, so a stale version costs nothing but a normal reply.
 *
 * Beyond the bandwidth this is a SIGNAL: a version bump with an unchanged rally
 * count is the feed rewriting an already-recorded rally, which is the flicker
 * spec/42's stabiliser exists to absorb. Observed rather than guessed at last.
 */
export function isNoChanges(xml: string): boolean {
  return /<NoChanges\s*\/>/.test(xml);
}

export function volleyLiveEnvelope(
  matchNo: number,
  options = BOARD_OPTIONS,
  version = 0,
): string {
  return `<Requests><Request Type="GetVolleyLive" No="${matchNo}" Options="${options}" Version="${version}"></Request></Requests>`;
}

/** The root `VolleyLive@Version` of a payload, or 0 when absent. */
export function payloadVersion(xml: string): number {
  const m = /<VolleyLive\b[^>]*\bVersion="(\d+)"/.exec(xml);
  return m ? Number(m[1]) : 0;
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
