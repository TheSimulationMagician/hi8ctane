-- Hi8ctane 0026: anonymous first-party metrics (P0-6, 2.31). Counts what makes real sessions happen, no tracker.
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0025. Safe to run again.
--
-- The site sends a handful of events (a crew started, shared, a link opened, joined, directions tapped, added to the
-- calendar, run again, "I'm looking"). Each holds: the event, the crew code, a random id made in that browser (not
-- the rider key, not the email, not the IP), where the visit came from (e.g. a utm source), and the time.
-- Only you read them, here in the SQL Editor:   select * from public.m_summary;
-- Switch: app_settings 'metrics' (true by default; 'false' stops recording at once).
-- Way back: update public.app_settings set value = 'false' where key = 'metrics';  (or drop the table and views)

insert into public.app_settings (key, value, public) values ('metrics', 'true', true) on conflict (key) do nothing;

create table if not exists public.events (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  name   text not null check (name in ('start_open', 'publish', 'share', 'link_open', 'join', 'nav', 'ics', 'again', 'looking')),
  crew   text check (crew is null or crew ~ '^[A-Z0-9]{6}$'),
  anon   text not null check (anon ~ '^[a-z0-9]{8,32}$'),
  src    text check (src is null or char_length(src) <= 80),
  extra  text check (extra is null or extra ~ '^[a-z_]{1,20}$')
);
create index if not exists events_at on public.events (at);
create index if not exists events_name_at on public.events (name, at);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;

create or replace function public.hi8_track(p_name text, p_anon text, p_crew text default null, p_src text default null, p_extra text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select value from public.app_settings where key = 'metrics'), 'true'::jsonb) = 'false'::jsonb then return; end if;
  perform public.hi8_limit('track', public.hi8_client(), 300, interval '1 hour');
  insert into public.events (name, anon, crew, src, extra)
  values (p_name, lower(p_anon), nullif(upper(trim(coalesce(p_crew, ''))), ''), left(nullif(trim(coalesce(p_src, '')), ''), 80), nullif(lower(trim(coalesce(p_extra, ''))), ''));
exception when check_violation then null;   -- a malformed event is dropped, never an error on the rider's screen
end $$;
revoke execute on function public.hi8_track(text, text, text, text, text) from public;
grant execute on function public.hi8_track(text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The views (read them in the SQL Editor; the website can't)
-- ---------------------------------------------------------------------------------------------
-- an activated crew: published, and at least two riders other than the captain said they're going
create or replace view public.m_activated_crews as
  select c.code, c.city, c.sport, c.day, c.created_at,
    (select count(distinct lower(m.email)) from public.crew_members m where m.crew_id = c.id and lower(m.email) <> lower(c.host_email)) as riders,
    (select count(*) from public.crew_members m where m.crew_id = c.id) as headcount
  from public.crews c
  where not c.is_test
    and (select count(distinct lower(m.email)) from public.crew_members m where m.crew_id = c.id and lower(m.email) <> lower(c.host_email)) >= 2;

-- a completed outing, with how strongly we know it happened
create or replace view public.m_completed as
  select c.code, c.city, c.sport, c.day,
    case when exists (select 1 from public.spot_reports r where r.crew_id = c.id and r.verdict in ('on', 'meh')) then 'rider report'
         when exists (select 1 from public.crew_members m where m.crew_id = c.id and m.here_at is not null) then 'check-in at the spot'
         else 'not confirmed' end as verified_by
  from public.crews c
  where not c.is_test and c.status = 'on' and public.hi8_crew_past(c);

-- organizers who started another crew within 30 days of one before
create or replace view public.m_repeat_organizers as
  select lower(a.host_email) as captain_email, count(*) as repeats
  from public.crews a join public.crews b on lower(b.host_email) = lower(a.host_email) and b.created_at > a.created_at and b.created_at <= a.created_at + interval '30 days'
  where not a.is_test and not b.is_test
  group by lower(a.host_email);

-- seconds from opening the start form to publishing (same browser), and from opening a crew link to joining it
create or replace view public.m_time_to as
  select 'publish' as what, p.at, extract(epoch from p.at - (select max(o.at) from public.events o where o.anon = p.anon and o.name = 'start_open' and o.at <= p.at and o.at > p.at - interval '1 hour'))::int as seconds
  from public.events p where p.name = 'publish'
  union all
  select 'join', j.at, extract(epoch from j.at - (select max(o.at) from public.events o where o.anon = j.anon and o.name = 'link_open' and o.crew = j.crew and o.at <= j.at and o.at > j.at - interval '1 day'))::int
  from public.events j where j.name = 'join';

-- what can be measured with real riders, the last 30 days in one row
create or replace view public.m_summary as
  select
    (select count(*) from public.m_activated_crews where created_at > now() - interval '30 days') as activated_crews_30d,
    (select count(*) from public.m_completed where day > current_date - 30 and verified_by <> 'not confirmed') as completed_outings_30d,
    (select count(*) from public.m_repeat_organizers) as repeat_organizers,
    (select percentile_cont(0.5) within group (order by seconds) from public.m_time_to where what = 'publish' and seconds is not null and at > now() - interval '30 days') as median_seconds_to_publish,
    (select percentile_cont(0.5) within group (order by seconds) from public.m_time_to where what = 'join' and seconds is not null and at > now() - interval '30 days') as median_seconds_to_join,
    (select count(*) from public.events where name = 'nav' and at > now() - interval '30 days') as direction_taps_30d,
    (select count(*) from public.events where name = 'share' and at > now() - interval '30 days') as shares_30d,
    (select count(*) from public.events where name = 'link_open' and at > now() - interval '30 days') as link_opens_30d,
    (select count(*) from public.events where name = 'join' and at > now() - interval '30 days') as joins_30d,
    -- crews that ended in the last 30 days with more riders needing a seat than seats in cars (as they stand now)
    (select count(*) from public.crews c where not c.is_test and c.status = 'on' and public.hi8_crew_past(c) and c.day > current_date - 30
       and (select count(*) from public.crew_members m where m.crew_id = c.id and m.getting = 'seat')
         > (select coalesce(sum(m.seats), 0) from public.crew_members m where m.crew_id = c.id and m.getting = 'drive')) as ended_with_riders_short_of_a_seat_30d;

revoke all on public.m_activated_crews, public.m_completed, public.m_repeat_organizers, public.m_time_to, public.m_summary from anon, authenticated;

-- check: one row of zeros (or your numbers)
select * from public.m_summary;

notify pgrst, 'reload schema';
