-- Supabase Realtime Authorization (spec/14 §B2) — DEFENCE IN DEPTH.
--
-- The primary realtime fix (§B1) already neutralizes the threat: broadcasts are
-- only "something advanced" signals and clients refetch authoritative state, so a
-- forged broadcast can't push fake state. This migration additionally stops
-- clients from broadcasting or snooping the scorer channel at the broker.
--
-- NOT auto-applied: it touches the Supabase-internal `realtime` schema and must be
-- run against the project (SQL editor / migration) AND paired with marking the
-- sensitive client channels `private: true`. Apply BOTH together, then verify a
-- second anon client can neither send to `match:{id}` nor read `:scorer`.
--
--   client change (after this SQL is live):
--     supabase.channel(`match:${id}:scorer`, { config: { private: true } })
--     supabase.channel(`match:${id}:team-${t}`, { config: { private: true } })
--   the public scoreboard channel `match:${id}` may stay non-private (anon read),
--   because §B1 makes forged sends harmless; broadcasting is still denied below.

alter table realtime.messages enable row level security;

-- Receive (SELECT) on the public match channels — anon + authenticated.
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
create policy "recv scorer channel"
  on realtime.messages for select
  to authenticated
  using ( realtime.topic() like 'match:%:scorer' );

-- No INSERT policy for anon/authenticated ⇒ clients cannot broadcast. The server
-- broadcasts with the service-role key (bypasses RLS), which remains allowed.
