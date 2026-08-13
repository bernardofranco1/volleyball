/**
 * Realtime channel names, shared by the server broadcaster and every browser
 * subscriber.
 *
 * Supabase Realtime topics are project-global, and homologation runs against a
 * CLONE of production — same match ids, same tenant, same project. Without a
 * namespace, a point scored on a homolog match would light up the production
 * scoreboard showing "the same" match, and vice versa. The environment prefix
 * keeps the two conversations apart.
 *
 * Isomorphic on purpose: it reads `NEXT_PUBLIC_DB_SCHEMA` (baked at build time)
 * rather than the server-only `DB_SCHEMA`, so the client bundle computes the
 * identical topic. Both are set together — see spec/28.
 */
const PREFIX =
  process.env.NEXT_PUBLIC_DB_SCHEMA && process.env.NEXT_PUBLIC_DB_SCHEMA !== "public"
    ? `${process.env.NEXT_PUBLIC_DB_SCHEMA}:`
    : "";

/** The public channel for a match: score, serve clock, state updates. */
export function matchTopic(matchId: string): string {
  return `${PREFIX}match:${matchId}`;
}

/** The scorer-only channel: interrupt requests from team tablets. */
export function scorerTopic(matchId: string): string {
  return `${PREFIX}match:${matchId}:scorer`;
}
