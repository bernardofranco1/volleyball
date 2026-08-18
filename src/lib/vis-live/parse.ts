/**
 * Minimal XML reader for FIVB VIS responses (spec/34).
 *
 * VIS puts every value in a PascalCase ATTRIBUTE and never in a text node, so
 * a full parser buys nothing: attributes plus element nesting is the whole
 * grammar. Stats-hub ran this same approach in production for two seasons.
 * Deliberately dependency-free (spec/34 ground rule 7) and pure, so the
 * fixtures in src/__tests__/fixtures/vis pin every mapping decision.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Decode the five XML entities plus numeric refs. Values arrive UTF-8. */
export function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, ref: string) => {
    if (ref.startsWith("#")) {
      const code = ref.startsWith("#x")
        ? parseInt(ref.slice(2), 16)
        : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref] ?? whole;
  });
}

export type Attrs = Record<string, string>;

function parseAttrs(raw: string): Attrs {
  const out: Attrs = {};
  for (const m of raw.matchAll(/([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g)) {
    out[m[1]] = decodeXml(m[2]);
  }
  return out;
}

/**
 * Opening tags of `tag`, in document order, as attribute maps. Matches both
 * `<Tag …/>` and `<Tag …>`; ignores closing tags. Alias-tolerant callers pass
 * each candidate name (`VolleyballMatch` | `VolleyMatch` | `Match`) — response
 * node names genuinely vary by request (vis-connector quirk ledger).
 */
export function allTagAttrs(xml: string, tag: string): Attrs[] {
  const re = new RegExp(`<${tag}\\b([^>]*?)/?>`, "g");
  return [...xml.matchAll(re)].map((m) => parseAttrs(m[1]));
}

/** First opening tag of `tag`, or null. */
export function firstTagAttrs(xml: string, tag: string): Attrs | null {
  return allTagAttrs(xml, tag)[0] ?? null;
}

/** First match among several alias names, in the order given. */
export function firstAliasAttrs(xml: string, ...tags: string[]): Attrs | null {
  for (const t of tags) {
    const found = firstTagAttrs(xml, t);
    if (found) return found;
  }
  return null;
}

/** All matches for the first alias that yields any rows. */
export function allAliasAttrs(xml: string, ...tags: string[]): Attrs[] {
  for (const t of tags) {
    const rows = allTagAttrs(xml, t);
    if (rows.length > 0) return rows;
  }
  return [];
}

export interface TagBlock {
  attrs: Attrs;
  /** Everything between the open and close tag ("" for a self-closed tag). */
  inner: string;
}

/**
 * Blocks of `tag` with their inner XML, so nested rows can be scoped to their
 * parent — VIS nests `Player` inside `Team` and `LineUp` inside `Set`, and a
 * flat scan would mix both teams' players together.
 *
 * Non-recursive on purpose: none of the elements this is used for nests inside
 * itself, so the first `</tag>` after the opening is the right one.
 */
export function tagBlocks(xml: string, tag: string): TagBlock[] {
  const out: TagBlock[] = [];
  const open = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, "g");
  for (const m of xml.matchAll(open)) {
    const attrs = parseAttrs(m[1]);
    if (m[2] === "/") {
      out.push({ attrs, inner: "" });
      continue;
    }
    const from = (m.index ?? 0) + m[0].length;
    const end = xml.indexOf(`</${tag}>`, from);
    out.push({ attrs, inner: end < 0 ? xml.slice(from) : xml.slice(from, end) });
  }
  return out;
}

/**
 * Integer attribute, or `fallback`. VIS omits attributes whose value is zero
 * ("omitted-zero" quirk) and sends empty strings for not-yet-known numbers, so
 * absent and "" must both fall back rather than become NaN.
 */
export function num(attrs: Attrs | null | undefined, key: string, fallback = 0): number {
  const raw = attrs?.[key];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Non-empty string attribute, else null. */
export function str(attrs: Attrs | null | undefined, key: string): string | null {
  const raw = attrs?.[key];
  return raw != null && raw.trim() !== "" ? raw : null;
}
