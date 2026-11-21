-- Hi8ctane 0023: better matching (2.29).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0022. Safe to run again.
--
--   * The best crew for you first: the site ranks crews by your level, a free seat from near you, the riders you've
--     ridden with before, and crews that need one or two more. hi8_mates tells a signed-in rider, per coming crew, how
--     many of its riders they've ridden with (a number only: no names).
--   * "I'm looking": a rider says which days they're free (and if they need a seat, from where) without starting a crew.
--     Captains see how many are looking (numbers only). When a crew that fits goes up, the alert worker tells them,
--     once, by push or email (hi8_ask_match, every 10 minutes).

-- ---------------------------------------------------------------------------------------------
-- 1. Riders you've ridden with, per coming crew
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_mates(p_key uuid) returns json
language plpgsql volatile security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  return coalesce((
    select json_agg(json_build_object('code', x.code, 'mates', x.n))
    from (
      select c.code, count(distinct lower(m.email)) as n
      from public.crews c
      join public.crew_members m on m.crew_id = c.id and lower(m.email) <> em
      where c.status = 'on' and c.day >= public.hi8_today(c.city) and c.day <= public.hi8_today(c.city) + 14
        and exists (select 1 from public.crews x
                    join public.crew_members a on a.crew_id = x.id and lower(a.email) = em and not a.no_show
                    join public.crew_members b on b.crew_id = x.id and lower(b.email) = lower(m.email) and not b.no_show
                    where x.status = 'on' and public.hi8_crew_past(x))
      group by c.code
    ) x), '[]'::json);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. "I'm looking"
-- ---------------------------------------------------------------------------------------------
create table if not exists public.ride_asks (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,                       -- lower case
  city       text not null references public.cities (slug),
  sport      text not null,
  day        date not null,
  need_seat  boolean not null default false,
  hub        text,                                -- where they'd be picked up (a hubs.slug), if they need a seat
  level      text not null default 'regular' check (level in ('rookie', 'regular', 'ripper')),
  created_at timestamptz not null default now(),
  crew_id    uuid references public.crews (id) on delete set null,   -- the crew they were told about (or joined)
  told_at    timestamptz,
  unique (email, sport, day)
);
create index if not exists ride_asks_open on public.ride_asks (city, sport, day) where told_at is null;
alter table public.ride_asks enable row level security;
revoke all on public.ride_asks from anon, authenticated;

-- set the days I'm looking for one sport (replaces the ones I had; an empty list = not looking)
create or replace function public.hi8_ask(p_key uuid, p_city text, p_sport text, p_days date[], p_seat boolean default false,
  p_hub text default null, p_level text default 'regular') returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); t date := public.hi8_today(p_city); d date; hb text := nullif(trim(coalesce(p_hub, '')), '');
begin
  perform public.hi8_limit('ask', p_key::text, 30, interval '10 minutes');
  if not exists (select 1 from public.spots where city = p_city and active and p_sport = any (sports)) then raise exception 'no_sport' using errcode = '22023'; end if;
  if coalesce(p_level, '') not in ('rookie', 'regular', 'ripper') then raise exception 'bad_level' using errcode = '22023'; end if;
  if hb is not null and not exists (select 1 from public.hubs where slug = hb and city = p_city) then hb := null; end if;
  if coalesce(array_length(p_days, 1), 0) > 14 then raise exception 'too_many_days' using errcode = '22023'; end if;
  delete from public.ride_asks where email = em and sport = p_sport and city = p_city and day >= t and not (day = any (coalesce(p_days, '{}')));
  foreach d in array coalesce(p_days, '{}') loop
    continue when d < t or d > t + 13;
    insert into public.ride_asks (email, city, sport, day, need_seat, hub, level) values (em, p_city, p_sport, d, coalesce(p_seat, false), case when p_seat then hb end, p_level)
    on conflict (email, sport, day) do update set city = excluded.city, need_seat = excluded.need_seat, hub = excluded.hub, level = excluded.level,
      crew_id = case when ride_asks.told_at is null then null else ride_asks.crew_id end;
  end loop;
  return public.hi8_my_asks(p_key);
end $$;

-- what I'm looking for (and the crew I was told about)
create or replace function public.hi8_my_asks(p_key uuid) returns json
language sql volatile security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('city', a.city, 'sport', a.sport, 'day', a.day, 'seat', a.need_seat, 'hub', a.hub, 'level', a.level,
           'crew', (select code from public.crews c where c.id = a.crew_id)) order by a.day, a.sport), '[]'::json)
  from public.ride_asks a
  where a.email = public.hi8_email(p_key) and a.day >= public.hi8_today(a.city);
$$;

-- how many riders are looking, per day (numbers only: no names, no emails)
create or replace function public.hi8_asks(p_city text, p_sport text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('day', d.day, 'n', d.n, 'seat', d.seat, 'rookies', d.rookies, 'hubs', d.hubs) order by d.day), '[]'::json)
  from (
    select a.day, count(*) as n, count(*) filter (where a.need_seat) as seat, count(*) filter (where a.level = 'rookie') as rookies,
      (select json_object_agg(h.hub, h.n) from (select b.hub, count(*) as n from public.ride_asks b
         where b.city = a.city and b.sport = a.sport and b.day = a.day and b.told_at is null and b.need_seat and b.hub is not null group by b.hub) h) as hubs
    from public.ride_asks a
    where a.city = p_city and a.sport = p_sport and a.told_at is null and a.day >= public.hi8_today(p_city) and a.day <= public.hi8_today(p_city) + 13
    group by a.city, a.sport, a.day
  ) d;
$$;

-- does crew c fit ask a? (level, room, a seat if they need one)
create or replace function public.hi8_ask_fits(a public.ride_asks, c public.crews) returns boolean
language sql stable security definer set search_path = public as $$
  select c.city = a.city and c.sport = a.sport and c.day = a.day and c.status = 'on'
    and case c.levels when 'rookie' then a.level = 'rookie' when 'regular' then a.level <> 'rookie' else true end
    and (select count(*) from public.crew_members m where m.crew_id = c.id) < c.max_riders
    and not exists (select 1 from public.crew_members m where m.crew_id = c.id and lower(m.email) = a.email)
    and (not a.need_seat or (
      (select coalesce(sum(m.seats), 0) from public.crew_members m where m.crew_id = c.id and m.getting = 'drive')
      - (select count(*) from public.crew_members m where m.crew_id = c.id and m.getting = 'seat')) > 0);
$$;

-- the worker, every 10 minutes: tell each rider who's looking about the crew that fits best, once per day asked
create or replace function public.hi8_ask_match() returns int
language plpgsql security definer set search_path = public as $$
declare a public.ride_asks; c public.crews; n int := 0; spn text; seats int; hubn text; url text; body text;
begin
  for a in select * from public.ride_asks where told_at is null and day >= public.hi8_today(city) order by created_at loop
    -- already in a crew that day: nothing to tell
    select x.* into c from public.crews x join public.crew_members m on m.crew_id = x.id
      where x.sport = a.sport and x.day = a.day and x.status = 'on' and lower(m.email) = a.email limit 1;
    if found then update public.ride_asks set crew_id = c.id, told_at = now() where id = a.id; continue; end if;
    -- the best fit: leaves from their pick-up point, then the most riders, then the earliest
    select x.* into c from public.crews x
      where public.hi8_ask_fits(a, x) and (x.day > public.hi8_today(x.city) or x.start_time > (now() at time zone coalesce((select tz from public.cities where slug = x.city), 'Europe/Amsterdam'))::time)
      order by (a.hub is not null and x.meet_hub = a.hub) desc, (select count(*) from public.crew_members m where m.crew_id = x.id) desc, x.start_time
      limit 1;
    continue when not found;
    update public.ride_asks set crew_id = c.id, told_at = now() where id = a.id;
    spn := coalesce((select name from public.spots where slug = c.spot), c.spot);
    seats := greatest(0, (select coalesce(sum(m.seats), 0) from public.crew_members m where m.crew_id = c.id and m.getting = 'drive')
                        - (select count(*) from public.crew_members m where m.crew_id = c.id and m.getting = 'seat'));
    hubn := (select initcap(lower(name)) from public.hubs where slug = c.meet_hub and city = c.city);
    url := public.hi8_crew_url(c);
    body := public.hi8_name(c.host_email, c.city) || '''s crew · ' || to_char(c.start_time, 'HH24:MI')
      || case when seats > 0 and hubn is not null then ' · ' || seats || ' seat' || case when seats = 1 then '' else 's' end || ' from ' || hubn else '' end
      || '. Tap to hop on.';
    if not public.hi8_push(a.email, 'A crew for ' || to_char(c.day, 'FMDay') || ': ' || spn, body, url, 'ask:' || a.id, 'ask:' || c.code) then
      perform public.hi8_mail(a.email, 'ask', 'A crew for ' || to_char(c.day, 'FMDay') || ' at ' || spn,
        'You said you''re looking for ' || trim(to_char(c.day, 'FMDay DD Mon')) || '. This crew fits: ' || body
        || E'\n\n' || url || E'\n\nNot looking any more? Change it on the site, under Me.', c.id, 'ask:' || a.id);
    end if;
    n := n + 1;
  end loop;
  delete from public.ride_asks where day < public.hi8_today(city);   -- gone the day after (privacy page)
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Erasing a rider also removes what they were looking for (the rest as in 0019)
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_erase_social(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(p_email));
begin
  delete from public.squad_members where lower(email) = em;
  delete from public.squads s where not exists (select 1 from public.squad_members m where m.squad_id = s.id);
  update public.squads set created_by = 'erased' where lower(created_by) = em;
  delete from public.spot_watch where email = em;
  delete from public.wind_alerts where email = em;
  delete from public.push_subs where email = em;
  delete from public.push_queue where email = em;
  delete from public.alert_sent where email = em;
  delete from public.ride_asks where email = em;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Who may call what
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.hi8_mates(uuid) from public;
revoke execute on function public.hi8_ask(uuid, text, text, date[], boolean, text, text) from public;
revoke execute on function public.hi8_my_asks(uuid) from public;
revoke execute on function public.hi8_asks(text, text) from public;
revoke execute on function public.hi8_ask_fits(public.ride_asks, public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_ask_match() from public, anon, authenticated;
revoke execute on function public.hi8_erase_social(text) from public, anon, authenticated;
grant execute on function public.hi8_mates(uuid) to anon, authenticated;
grant execute on function public.hi8_ask(uuid, text, text, date[], boolean, text, text) to anon, authenticated;
grant execute on function public.hi8_my_asks(uuid) to anon, authenticated;
grant execute on function public.hi8_asks(text, text) to anon, authenticated;
grant execute on function public.hi8_ask_match() to service_role;

notify pgrst, 'reload schema';
