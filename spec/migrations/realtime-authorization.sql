-- Supabase Realtime Authorization (spec/14 §B2) — DEFENCE IN DEPTH.
--
-- The primary realtime fix (§B1) already neutralizes the threat: broadcasts are
-- only "something advanced" signals and clients refetch authoritative state, so a
-- forged broadcast can't push fake state. This migration additionally stops
-- clients from broadcasting or snooping at the broker itself.
--
-- NOT auto-applied: it touches the Supabase-internal `realtime` schema and must be
-- run against the project (SQL editor / migration). Pair it with the client flag:
--
--   1. Run this SQL in the Supabase SQL editor (idempotent — safe to re-run).
--   2. Set NEXT_PUBLIC_REALTIME_PRIVATE=1 and redeploy. The client then creates
--      every match channel as `{ config: { private: true } }` and calls
--      `supabase.realtime.setAuth()` (see src/lib/realtime-client.ts), so these
--      policies take effect. With the flag unset (default) channels stay public
--      and this SQL is inert.
--   3. Verify: a second anon client can still READ the scoreboard topic
--      `match:{id}` but can neither READ `match:{id}:scorer` nor BROADCAST to any
--      channel; an authenticated scorer still receives `:scorer` notifications.
--
-- When the flag is ON, even the public scoreboard channel `match:{id}` is private
-- (anon read is granted below), so the "no INSERT policy" rule blocks forged
-- sends to it too — a strict superset of the §B1 mitigation.

alter table realtime.messages enable row level security;

-- Receive (SELECT) on the public match channels — anon + authenticated.
drop policy if exists "recv match public" on realtime.messages;
create policy "recv match public"
  on realtime.messages for select
  to anon, authenticated
  using (
    realtime.topic() like 'match:%'
    and realtime.topic() not like '%:scorer'
    and realtime.topic() not like 'match:%:team-%'
  );

-- Receive on the scorer channel — authenticated only (blocks anonymous snooping).
-- A per-tenant restriction would add a SECURITY DEFINER function mapping the topic
-- → match → user_tenant_roles; left as a follow-up.
drop policy if exists "recv scorer channel" on realtime.messages;
create policy "recv scorer channel"
  on realtime.messages for select
  to authenticated
  using ( realtime.topic() like 'match:%:scorer' );

-- No INSERT policy for anon/authenticated ⇒ clients cannot broadcast. The server
-- broadcasts with the service-role key (bypasses RLS), which remains allowed.
