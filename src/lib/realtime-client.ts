// Client realtime channel options (Phase 11 / spec/14 §B2).
//
// Defence-in-depth on top of B1 (broadcasts are untrusted signals). When
// `NEXT_PUBLIC_REALTIME_PRIVATE=1`, match channels are created as PRIVATE so
// Supabase Realtime Authorization (RLS on realtime.messages) governs who may
// receive and forbids clients from broadcasting. Enable ONLY after applying
// spec/migrations/realtime-authorization.sql — a private channel with no policy
// is default-deny and would silently break live updates.
//
// Default (flag unset) = public channels = today's behaviour, unchanged.
import type { SupabaseClient } from "@supabase/supabase-js";

export function realtimePrivate(): boolean {
  return process.env.NEXT_PUBLIC_REALTIME_PRIVATE === "1";
}

/** `channel()` options — `{ config: { private: true } }` when enabled, else none. */
export function channelConfig(): { config: { private: true } } | undefined {
  return realtimePrivate() ? { config: { private: true } } : undefined;
}

/** Attach the current session/anon token so private-channel joins authorize. */
export function ensureRealtimeAuth(supabase: SupabaseClient): void {
  if (!realtimePrivate()) return;
  try {
    supabase.realtime.setAuth();
  } catch {
    /* best-effort; falls back to the connection's default key */
  }
}
