-- Cooldown Caller -- cooldown_caller_tracked_items table
--
-- SAFETY: this table has NO phone/destination column of any kind, on
-- purpose. The call destination is a single fixed constant (TARGET_PHONE,
-- read from an env var) in app/api/check/route.ts and is NEVER read from
-- this table. A tracked item can only ever describe WHAT a reminder call
-- is about, never WHO gets called. See lib/tracked-items-store.ts and
-- lib/tracked-items-store.test.ts for the application-layer half of this
-- guarantee.
--
-- Applied to project_id botgwdtfxuqnphdovkoi ("daily-resilience-system",
-- OGUNLEYE834/MO.Org) -- the same shared Supabase project already used by
-- sibling projects Publish Window Keeper and Grant Scout. That project
-- already has its own generic "tracked_items" table (Publish Window
-- Keeper's) and will shortly have a "grant_scout_searches" table too, so
-- this table is deliberately named "cooldown_caller_tracked_items" to
-- avoid any collision. arknet-os was NOT touched or considered for this
-- (off-limits per standing rule); no project was paused or restored to
-- make room -- daily-resilience-system was already active.

create table if not exists public.cooldown_caller_tracked_items (
  id text primary key,
  name text not null,
  category text not null,
  cooldown_hours numeric not null,
  last_action_at timestamptz not null default now(),
  source text not null default 'user-added',
  created_at timestamptz not null default now(),
  constraint cooldown_caller_tracked_items_cooldown_floor check (cooldown_hours >= 1)
);

comment on table public.cooldown_caller_tracked_items is
  'Tracked recurring-action items for Cooldown Caller (a distinct project sharing the daily-resilience-system Supabase instance with Publish Window Keeper and Grant Scout). Deliberately has NO phone/destination column -- the call destination is fixed at the infrastructure level (TARGET_PHONE env var in app/api/check/route.ts) and is never read from this table.';

alter table public.cooldown_caller_tracked_items enable row level security;

-- No auth system exists in this hackathon demo (single shared dashboard,
-- no user accounts) -- same honestly-scoped shared-policy pattern used by
-- the sibling ArkNet hackathon projects. Anyone with the anon/publishable
-- key can read, add, or update items; nobody can delete via the API
-- (no delete policy is defined, so RLS denies it by default). This is a
-- deliberate, narrow trust boundary: even a fully malicious writer to this
-- table can only ever influence WHAT a reminder call is about, never WHO
-- gets called -- there is no column here that feeds the call destination.
create policy "cooldown_caller_tracked_items_public_select"
  on public.cooldown_caller_tracked_items for select
  using (true);

create policy "cooldown_caller_tracked_items_public_insert"
  on public.cooldown_caller_tracked_items for insert
  with check (cooldown_hours >= 1);

create policy "cooldown_caller_tracked_items_public_update"
  on public.cooldown_caller_tracked_items for update
  using (true)
  with check (cooldown_hours >= 1);

-- Seed data: the same three honestly-labeled example items that used to
-- live in data/tracked_items.json (now unused at runtime -- see that
-- file's updated header note). last_action_at values are copied as-is.
insert into public.cooldown_caller_tracked_items (id, name, category, cooldown_hours, last_action_at, source)
values
  (
    'elevenlabs-music-publish',
    'ElevenLabs Music Marketplace: publish next track',
    'content-publishing',
    24,
    '2026-08-24T09:00:00Z',
    'example (ElevenLabs Music Marketplace caps publishing at 5 tracks per rolling 24 hours)'
  ),
  (
    'craigslist-repost-listing',
    'Craigslist: repost ''Vintage record player'' listing',
    'marketplace-listing',
    1080,
    '2026-07-20T14:30:00Z',
    'example (Craigslist listings expire and need reposting roughly every 45 days)'
  ),
  (
    'quarterly-domain-renewal-check',
    'Domain portfolio: quarterly renewal audit',
    'back-office',
    2160,
    '2026-05-28T12:00:00Z',
    'example (a quarterly recurring back-office check, modeled as a 90 day cooldown to show a third cadence)'
  )
on conflict (id) do nothing;
