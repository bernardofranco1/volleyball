// Beach pairs are displayed by the name each player is actually known by —
// the segment of the pair team name ("Duda / Ana Patrícia", "Graudina /
// Kravcenoka"). A surname is the wrong label for players known by a single
// name (Duda Lisboa → "Duda", not "Lisboa"), so every player-facing surface
// (court markers, service-order prompt, scoreboard underline) resolves the
// display name from the team name and only falls back to the surname.

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Fallback: last whitespace-separated token of the full name. */
export function surnameOf(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : full;
}

/**
 * The name a player is known by within a pair team name: the "/"-separated
 * segment whose words all appear in the player's full name (longest match
 * wins). Falls back to the surname when the team name isn't a pair or no
 * segment matches.
 */
export function pairDisplayName(teamName: string, fullName: string): string {
  const fullWords = new Set(normalize(fullName).split(/\s+/));
  const segments = teamName
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  let best: string | null = null;
  for (const segment of segments) {
    const words = normalize(segment).split(/\s+/);
    if (words.length > 0 && words.every((w) => fullWords.has(w))) {
      if (!best || segment.length > best.length) best = segment;
    }
  }
  return best ?? surnameOf(fullName);
}
