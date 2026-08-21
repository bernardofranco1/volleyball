"use client";

/**
 * The three-way clock choice shared by both fixture indexes (spec/46): the
 * public board host's `/c/{competitionId}` and the in-app
 * `/t/{slug}/scoreboard/vis/{competitionId}`.
 *
 * Only the machinery is shared, not the markup — the two pages present the same
 * fixtures to the same people but in different chrome, and forcing one row
 * layout on both would be a redesign dressed up as reuse. What must not diverge
 * is the arithmetic, the storage key and the hydration strategy, so those live
 * here.
 *
 * Both client-only facts this needs — the stored preference and the browser's
 * own zone — are read through `useSyncExternalStore` rather than an effect, so
 * the server render has one defined answer and React swaps in the real one
 * after hydration with no mismatch. `venue` is the only choice a server CAN
 * render: the browser's zone is not knowable there.
 */

import { useMemo, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n/client";
import {
  type ClockZone,
  type ReaderZoneSource,
  type ScheduledPair,
  isPlaceholderZone,
  readerOffsetLabel,
  resolveReaderZone,
  venueOffsetLabel,
} from "@/lib/vis-live/match-times";

const STORAGE_KEY = "fivb.board.clockZone";
const ZONES: ClockZone[] = ["local", "venue", "gmt"];
/** What a first-time reader gets: the clock on the device in their hand. */
const DEFAULT_ZONE: ClockZone = "local";
/** What the server renders, and the first client render with it. */
const SERVER_ZONE: ClockZone = "venue";

const KEYS: Record<ClockZone, string> = {
  local: "clock.local",
  venue: "clock.venue",
  gmt: "clock.gmt",
};

function isZone(value: string | null): value is ClockZone {
  return value === "local" || value === "venue" || value === "gmt";
}

// ── the stored choice, as an external store ──────────────────────────────────
// Module-level so every mount agrees, and so `getSnapshot` can be referentially
// stable — returning a fresh value on each call would loop.

const listeners = new Set<() => void>();
let cached: ClockZone | null = null;

function readStored(): ClockZone {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isZone(raw) ? raw : DEFAULT_ZONE;
  } catch {
    // Storage blocked (private mode, or a locked-down venue browser).
    return DEFAULT_ZONE;
  }
}

function subscribeZone(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab of the same index — venues open several — should follow along.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cached = null;
      for (const l of listeners) l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function zoneSnapshot(): ClockZone {
  if (cached == null) cached = readStored();
  return cached;
}

const serverZoneSnapshot = (): ClockZone => SERVER_ZONE;

/** Apply and remember a choice. Exported for tests and for other surfaces. */
export function setClockZone(next: ClockZone): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice still applies for this visit.
  }
  cached = next;
  for (const l of listeners) l();
}

// ── the manually chosen reader zone (spec/46 picker) ─────────────────────────
// Same shape as the clock-zone store. Only consulted when the device reports a
// placeholder zone, so a stale value from a privacy-mode session cannot leak
// into a session where the device answers for itself.

const MANUAL_KEY = "fivb.board.readerZone";
const manualListeners = new Set<() => void>();
/** undefined = not read yet; null = read, nothing stored. */
let manualCached: string | null | undefined;

function subscribeManualZone(onChange: () => void): () => void {
  manualListeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === MANUAL_KEY) {
      manualCached = undefined;
      for (const l of manualListeners) l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    manualListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function manualZoneSnapshot(): string | null {
  if (manualCached === undefined) {
    try {
      manualCached = window.localStorage.getItem(MANUAL_KEY);
    } catch {
      manualCached = null;
    }
  }
  return manualCached;
}

const serverManualZoneSnapshot = (): string | null => null;

/** Apply and remember the picker's choice; null clears back to automatic. */
export function setManualReaderZone(next: string | null): void {
  try {
    if (next == null) window.localStorage.removeItem(MANUAL_KEY);
    else window.localStorage.setItem(MANUAL_KEY, next);
  } catch {
    // The choice still applies for this visit.
  }
  manualCached = next;
  for (const l of manualListeners) l();
}

// ── the browser's own zone, likewise ─────────────────────────────────────────

let readerZoneCache: string | null = null;
/** Never changes within a page's life, so there is nothing to subscribe to. */
const subscribeNothing = () => () => {};

function readerZoneSnapshot(): string {
  if (readerZoneCache == null) {
    try {
      readerZoneCache = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      // A browser with no `resolvedOptions().timeZone`. UTC is then the honest
      // answer: we know nothing better, and `isPlaceholderZone` will say so.
      readerZoneCache = "UTC";
    }
  }
  return readerZoneCache;
}

/**
 * NOT "UTC" — null, meaning "the browser has not told us yet".
 *
 * A server that answers its own question with UTC labels the Local-time button
 * "GMT" on every first paint, which is wrong for all but a handful of readers
 * and looks exactly like a broken conversion. Unknown must stay unknown until
 * the browser answers.
 */
const serverReaderZoneSnapshot = (): string | null => null;

export interface ClockChoice {
  zone: ClockZone;
  /** The viewer's IANA zone; null on the server and until hydration. */
  readerZone: string | null;
  /** Where `readerZone` came from; null = an unfilled placeholder. */
  readerZoneSource: ReaderZoneSource;
  /** The event's single offset label, or null when its venues disagree. */
  oneVenueOffset: string | null;
  /** The viewer's offset over the event, or null when there are no fixtures. */
  readerOffset: string | null;
}

export function useClockZone(
  matches: readonly ScheduledPair[],
  /**
   * The zone Vercel estimated from the connection (`x-vercel-ip-timezone`),
   * passed down from the page's server render. Used only when the device
   * reports no real zone — see `resolveReaderZone`.
   */
  networkZone?: string | null,
): ClockChoice {
  const zone = useSyncExternalStore(subscribeZone, zoneSnapshot, serverZoneSnapshot);
  const deviceZone = useSyncExternalStore<string | null>(
    subscribeNothing,
    readerZoneSnapshot,
    serverReaderZoneSnapshot,
  );
  const manualZone = useSyncExternalStore<string | null>(
    subscribeManualZone,
    manualZoneSnapshot,
    serverManualZoneSnapshot,
  );
  const { zone: readerZone, source: readerZoneSource } = useMemo(
    () => resolveReaderZone(deviceZone, manualZone, networkZone ?? null),
    [deviceZone, manualZone, networkZone],
  );

  const { oneVenueOffset, readerOffset } = useMemo(() => {
    // One label when the whole event sits in one offset, which is the normal
    // case; null when it does not — VIS tournament 1736 spans eight — and then
    // each row carries its own.
    const offsets = new Set(
      matches.map(venueOffsetLabel).filter((o): o is string => o != null),
    );
    // The reader's offset is read AT the first fixture, not at "now": that is
    // the offset their schedule will actually be in, and it keeps this render
    // pure (a clock read during render is neither).
    const first = matches
      .map((m) => (m.scheduledUtc ? Date.parse(m.scheduledUtc) : NaN))
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => a - b)[0];
    return {
      oneVenueOffset: offsets.size === 1 ? [...offsets][0] : null,
      readerOffset: first == null ? null : readerOffsetLabel(readerZone, first),
    };
  }, [matches, readerZone]);

  return { zone, readerZone, readerZoneSource, oneVenueOffset, readerOffset };
}

/**
 * Three buttons, not a time-zone picker. Nobody reading a fixture list wants to
 * *choose* a zone from four hundred; they want the one they are standing in,
 * the one the match is played in, or the neutral one everyone converts from.
 */
export function ClockZoneToggle({
  choice,
  venueName,
  className,
}: {
  choice: ClockChoice;
  /** The venue's city, when the whole event is in one. For the caption. */
  venueName?: string | null;
  className?: string;
}) {
  const t = useT();
  const { zone, readerZone, readerZoneSource, oneVenueOffset, readerOffset } = choice;

  const hints: Record<ClockZone, string | null> = {
    local: readerOffset,
    venue: oneVenueOffset,
    gmt: null,
  };

  // Assembled here rather than as four more catalogue entries: the pieces are
  // proper nouns and offsets, which read the same in every language.
  const venuePlace =
    venueName && oneVenueOffset
      ? `${venueName} (${oneVenueOffset})`
      : (venueName ?? oneVenueOffset ?? "");
  // The picker shows whenever the zone did NOT come from the device: the
  // honest-GMT state, a network estimate (which a VPN can put in the wrong
  // country), or a manual choice already made — all states where the reader
  // may know better than we do. Only a real device zone hides it: there is
  // nothing to correct, and nobody browsing normally ever meets a 400-entry
  // list — the global selector this feature deliberately is not (spec/46).
  const showPicker =
    zone === "local" && readerZone != null && readerZoneSource !== "device";
  const zoneOptions = useMemo<string[]>(() => {
    if (!showPicker) return [];
    // Older engines lack supportedValuesOf; the picker simply stays away and
    // the honest caption remains, rather than offering a list we cannot fill.
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, [showPicker]);

  const zoneWithOffset =
    readerZone == null
      ? ""
      : [readerZone, readerOffset && `(${readerOffset})`].filter(Boolean).join(" ");
  const caption =
    zone === "local"
      ? readerZone == null
        ? // Pre-hydration only, and pre-hydration the toggle is on venue time,
          // so this is a belt-and-braces case rather than a visible one.
          t("clock.captionLocalUnknown")
        : readerZoneSource === "manual"
          ? t("clock.captionLocalManual", { zone: zoneWithOffset })
          : readerZoneSource === "network"
            ? // The device gave us nothing, so this zone came from the network —
              // say so, because an estimate presented as a fact is how a reader
              // on a VPN misses a match.
              t("clock.captionLocalFromIp", { zone: zoneWithOffset })
            : isPlaceholderZone(readerZone)
              ? t("clock.captionLocalIsUtc")
              : t("clock.captionLocal", { zone: zoneWithOffset })
      : zone === "gmt"
        ? t("clock.captionGmt")
        : venuePlace
          ? t("clock.captionVenue", { zone: venuePlace })
          : oneVenueOffset === null
            ? t("clock.captionVenueMulti")
            : t("clock.captionVenuePlain");

  return (
    <div className={className}>
      <div
        role="group"
        aria-label={t("clock.groupLabel")}
        className="inline-flex flex-wrap gap-1 rounded-lg border border-border p-1"
      >
        {ZONES.map((z) => {
          const active = z === zone;
          const name = t(KEYS[z]);
          return (
            <button
              key={z}
              type="button"
              aria-pressed={active}
              // The offset is decoration on top of the name; without this the
              // accessible name reads "Local timeGMT+2".
              aria-label={hints[z] ? `${name} (${hints[z]})` : name}
              onClick={() => setClockZone(z)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 ${
                active ? "bg-foreground text-surface" : "text-score-dim hover:text-foreground"
              }`}
            >
              {name}
              {hints[z] ? (
                <span
                  aria-hidden="true"
                  className={`ml-1.5 font-normal ${active ? "opacity-70" : "opacity-60"}`}
                >
                  {hints[z]}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-score-dim">{caption}</p>
      {showPicker && zoneOptions.length > 0 ? (
        <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-score-dim">
          {t("clock.pickerLabel")}
          <select
            value={readerZoneSource === "manual" ? (readerZone ?? "") : ""}
            onChange={(e) => setManualReaderZone(e.target.value || null)}
            className="rounded border border-border bg-surface px-2 py-1 text-xs text-foreground focus-visible:outline focus-visible:outline-2"
          >
            <option value="">{t("clock.pickerAuto")}</option>
            {zoneOptions.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
