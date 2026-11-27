-- Hi8ctane 0030: riders confirm the conditions at the spot, and "open to new riders".
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0029. Safe to run again. No data is removed or rewritten.
--
--   1. On-spot reports anyone can read. A rider AT the spot says how it really is: ON / MEH / OFF, the wind against
--      the forecast (lighter, as forecast, stronger), gusty or steady, the water (flat, chop, waves) or the ground
--      (dry, tacky, muddy, wet), how busy it is, the kite they're on. "At the spot" is checked one of two ways:
--        * checkin:  they're in a crew at this spot today and checked in (as the crew reports since 0005), or
--        * location: they shared their location once and it is within 2 km of the spot. The coordinates are only
--                    compared, never stored.
--      Nobody else can file one. Saying it again within 20 minutes replaces your last one (no stuffing).
--      hi8_conditions(city) gives the site the last 3 hours per spot: how many riders, how many say ON/MEH/OFF,
--      the most common wind/gusts/water/ground/crowd answer, the kites, the reporters' levels, the freshest report.
--      Numbers only: no names, no emails, no positions.
--   2. Open to new riders (rider side, opt-in): with "I'm up for a ride" a rider can say crews they didn't keep may
--      count them. A crew's proposal then says "+ 2 new riders at your level are free". Default: off, as before.
--      Crew side: a captain can close a crew to new riders; the "I'm looking" matcher then only tells people from
--      the crew they kept. Default: open, as before. The crew stays on the site either way.

-- 1. on-spot reports ----------------------------------------------------------------------------------------------
alter table public.spot_reports add column if not exists wind  text check (wind  is null or wind  in ('lighter', 'as_forecast', 'stronger'));
alter table public.spot_reports add column if not exists gusts text check (gusts is null or gusts in ('steady', 'gusty'));
alter table public.spot_reports add column if not exists water text check (water is null or water in ('flat', 'chop', 'waves'));
alter table public.spot_reports add column if not exists crowd text check (crowd is null or crowd in ('quiet', 'busy', 'packed'));
alter table public.spot_reports add column if not exists level text check (level is null or level in ('rookie', 'regular', 'ripper'));
alter table public.spot_reports add column if not exists how   text not null default 'checkin' check (how in ('checkin', 'location'));

create or replace function public.hi8_spot_report(
  p_key uuid, p_spot text, p_verdict text, p_sport text default null,
  p_wind text default null, p_gusts text default null, p_water text default null, p_ground text default null, p_crowd text default null,
  p_kite numeric default null, p_level text default null, p_lat double precision default null, p_lon double precision default null, p_note text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  em  text := public.hi8_email(p_key);
  s   public.spots;
  sp  text;
  c   public.crews;
  m   public.crew_members;
  hw  text;
  lv  text := nullif(p_level, '');
  kt  numeric := case when p_kite is null then null else round(p_kite * 2) / 2 end;
  nt  text := nullif(left(regexp_replace(trim(coalesce(p_note, '')), '[[:cntrl:]]', '', 'g'), 140), '');
  old bigint;
begin
  perform public.hi8_limit('spotrep', p_key::text, 8, interval '1 hour');
  select * into s from public.spots where slug = p_spot and active;
  if not found then raise exception 'no_spot' using errcode = '22023'; end if;
  sp := coalesce(nullif(p_sport, ''), s.sports[1]);
  if not (sp = any (s.sports)) then raise exception 'bad_sport' using errcode = '22023'; end if;
  if p_verdict not in ('on', 'meh', 'off') then raise exception 'bad_verdict' using errcode = '22023'; end if;
  if lv is not null and lv not in ('rookie', 'regular', 'ripper') then raise exception 'bad_level' using errcode = '22023'; end if;
  if sp in ('kite', 'wing') then
    if p_ground is not null then raise exception 'bad_ground' using errcode = '22023'; end if;
    if kt is not null and (kt < 3 or kt > 21) then raise exception 'bad_kite' using errcode = '22023'; end if;
  else
    if p_wind is not null or p_gusts is not null or p_water is not null or kt is not null then raise exception 'bad_field' using errcode = '22023'; end if;
  end if;
  -- at the spot? first: checked in with a crew here today
  select x.* into c from public.crews x join public.crew_members y on y.crew_id = x.id
    where x.spot = s.slug and x.status = 'on' and x.day = public.hi8_today(x.city) and lower(y.email) = em limit 1;
  if c.id is not null then
    select * into m from public.crew_members where crew_id = c.id and lower(email) = em;
    if public.hi8_is_here(m, c) then hw := 'checkin'; lv := coalesce(lv, m.level); end if;
  end if;
  -- or: a location shared once, within 2 km (compared here, never kept)
  if hw is null and p_lat is not null and p_lon is not null and p_lat between -90 and 90 and p_lon between -180 and 180
     and public.hi8_km(p_lat, p_lon, s.lat, s.lon) <= 2.0 then hw := 'location'; end if;
  if hw is null then
    raise exception 'not_at_spot' using errcode = '42501', hint = 'Check in with your crew, or share your location at the spot.';
  end if;
  -- said it again within 20 minutes: replace the last one
  select id into old from public.spot_reports where spot = s.slug and lower(email) = em and at > now() - interval '20 minutes' order by at desc limit 1;
  if old is not null then
    update public.spot_reports set at = now(), sport = sp, verdict = p_verdict, wind = p_wind, gusts = p_gusts, water = p_water, ground = p_ground,
      crowd = p_crowd, kite = kt, level = lv, how = hw, note = nt where id = old;
  else
    insert into public.spot_reports (crew_id, spot, sport, email, verdict, kite, ground, note, wind, gusts, water, crowd, level, how)
    values (case when hw = 'checkin' then c.id end, s.slug, sp, em, p_verdict, kt, p_ground, nt, p_wind, p_gusts, p_water, p_crowd, lv, hw);
  end if;
  return public.hi8_conditions(s.city, s.slug);
end $$;

-- the last 3 hours per spot, numbers only
create or replace function public.hi8_conditions(p_city text, p_spot text default null) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.last desc), '[]'::json) from (
    select r.spot, r.sport, count(*) as n, max(r.at) as last,
      count(*) filter (where r.verdict = 'on') as "on", count(*) filter (where r.verdict = 'meh') as meh, count(*) filter (where r.verdict = 'off') as off,
      count(*) filter (where r.how = 'checkin') as checkin, count(*) filter (where r.how = 'location') as located,
      mode() within group (order by r.wind)   filter (where r.wind is not null)   as wind,
      count(r.wind) as wind_n, count(*) filter (where r.wind = (select mode() within group (order by q.wind) from public.spot_reports q where q.spot = r.spot and q.sport = r.sport and q.at > now() - interval '3 hours' and q.wind is not null)) as wind_same,
      mode() within group (order by r.gusts)  filter (where r.gusts is not null)  as gusts,
      mode() within group (order by r.water)  filter (where r.water is not null)  as water,
      mode() within group (order by r.ground) filter (where r.ground is not null) as ground,
      mode() within group (order by r.crowd)  filter (where r.crowd is not null)  as crowd,
      (select json_agg(distinct q.kite order by q.kite) from public.spot_reports q where q.spot = r.spot and q.sport = r.sport and q.at > now() - interval '3 hours' and q.kite is not null) as kites,
      json_build_object('rookie', count(*) filter (where r.level = 'rookie'), 'regular', count(*) filter (where r.level = 'regular'), 'ripper', count(*) filter (where r.level = 'ripper')) as levels,
      (select json_build_object('at', q.at, 'verdict', q.verdict, 'wind', q.wind, 'gusts', q.gusts, 'water', q.water, 'ground', q.ground, 'crowd', q.crowd, 'kite', q.kite, 'level', q.level, 'how', q.how)
         from public.spot_reports q where q.spot = r.spot and q.sport = r.sport and q.at > now() - interval '3 hours' order by q.at desc limit 1) as latest
    from public.spot_reports r join public.spots s on s.slug = r.spot
    where s.city = p_city and (p_spot is null or r.spot = p_spot) and r.at > now() - interval '3 hours'
    group by r.spot, r.sport
  ) x;
$$;

-- 2. open to new riders ------------------------------------------------------------------------------------------
alter table public.ride_asks add column if not exists open_new boolean not null default false;
alter table public.crews add column if not exists open_new boolean not null default true;

-- "I'm up for a ride", with the new p_open: null keeps what the rider had for that sport
drop function if exists public.hi8_ask(uuid, text, text, date[], boolean, text, text);
create or replace function public.hi8_ask(p_key uuid, p_city text, p_sport text, p_days date[], p_seat boolean default false,
  p_hub text default null, p_level text default 'regular', p_open boolean default null) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); t date := public.hi8_today(p_city); d date; hb text := nullif(trim(coalesce(p_hub, '')), '');
  op boolean := coalesce(p_open, (select a.open_new from public.ride_asks a where a.email = em and a.sport = p_sport order by a.created_at desc limit 1), false);
begin
  perform public.hi8_limit('ask', p_key::text, 30, interval '10 minutes');
  if not exists (select 1 from public.spots where city = p_city and active and p_sport = any (sports)) then raise exception 'no_sport' using errcode = '22023'; end if;
  if coalesce(p_level, '') not in ('rookie', 'regular', 'ripper') then raise exception 'bad_level' using errcode = '22023'; end if;
  if hb is not null and not exists (select 1 from public.hubs where slug = hb and city = p_city) then hb := null; end if;
  if coalesce(array_length(p_days, 1), 0) > 14 then raise exception 'too_many_days' using errcode = '22023'; end if;
  delete from public.ride_asks where email = em and sport = p_sport and city = p_city and day >= t and not (day = any (coalesce(p_days, '{}')));
  foreach d in array coalesce(p_days, '{}') loop
    continue when d < t or d > t + 13;
    insert into public.ride_asks (email, city, sport, day, need_seat, hub, level, open_new) values (em, p_city, p_sport, d, coalesce(p_seat, false), case when p_seat then hb end, p_level, op)
    on conflict (email, sport, day) do update set city = excluded.city, need_seat = excluded.need_seat, hub = excluded.hub, level = excluded.level, open_new = excluded.open_new,
      crew_id = case when ride_asks.told_at is null then null else ride_asks.crew_id end;
  end loop;
  return public.hi8_my_asks(p_key);
end $$;

-- what I'm looking for, now with "open"
create or replace function public.hi8_my_asks(p_key uuid) returns json
language sql volatile security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('city', a.city, 'sport', a.sport, 'day', a.day, 'seat', a.need_seat, 'hub', a.hub, 'level', a.level, 'open', a.open_new,
           'crew', (select code from public.crews c where c.id = a.crew_id)) order by a.day, a.sport), '[]'::json)
  from public.ride_asks a
  where a.email = public.hi8_email(p_key) and a.day >= public.hi8_today(a.city);
$$;

-- the public counts per day, now with how many of them are open to new riders (and their levels)
create or replace function public.hi8_asks(p_city text, p_sport text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('day', d.day, 'n', d.n, 'seat', d.seat, 'rookies', d.rookies, 'hubs', d.hubs, 'open', d.open, 'open_levels', d.open_levels) order by d.day), '[]'::json)
  from (
    select a.day, count(*) as n, count(*) filter (where a.need_seat) as seat, count(*) filter (where a.level = 'rookie') as rookies,
      count(*) filter (where a.open_new) as open,
      json_build_object('rookie', count(*) filter (where a.open_new and a.level = 'rookie'), 'regular', count(*) filter (where a.open_new and a.level = 'regular'),
                        'ripper', count(*) filter (where a.open_new and a.level = 'ripper')) as open_levels,
      (select json_object_agg(h.hub, h.n) from (select b.hub, count(*) as n from public.ride_asks b
         where b.city = a.city and b.sport = a.sport and b.day = a.day and b.told_at is null and b.need_seat and b.hub is not null group by b.hub) h) as hubs
    from public.ride_asks a
    where a.city = p_city and a.sport = p_sport and a.told_at is null and a.day >= public.hi8_today(p_city) and a.day <= public.hi8_today(p_city) + 13
    group by a.city, a.sport, a.day
  ) d;
$$;

-- a crew closed to new riders only matches people from the crew it was proposed from
create or replace function public.hi8_ask_fits(a public.ride_asks, c public.crews) returns boolean
language sql stable security definer set search_path = public as $$
  select c.city = a.city and c.sport = a.sport and c.day = a.day and c.status = 'on'
    and case c.levels when 'rookie' then a.level = 'rookie' when 'regular' then a.level <> 'rookie' else true end
    and (c.open_new or (c.squad is not null and exists (select 1 from public.squad_members sm where sm.squad_id = c.squad and lower(sm.email) = a.email)))
    and (select count(*) from public.crew_members m where m.crew_id = c.id) < c.max_riders
    and not exists (select 1 from public.crew_members m where m.crew_id = c.id and lower(m.email) = a.email)
    and (not a.need_seat or (
      (select coalesce(sum(m.seats), 0) from public.crew_members m where m.crew_id = c.id and m.getting = 'drive')
      - (select count(*) from public.crew_members m where m.crew_id = c.id and m.getting = 'seat')) > 0);
$$;

-- the captain opens or closes a crew to new riders (p_open null: only says how it is)
create or replace function public.hi8_crew_open(p_key uuid, p_code text, p_open boolean) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews;
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if lower(c.host_email) <> em then raise exception 'not_captain' using errcode = '42501'; end if;
  if p_open is not null then update public.crews set open_new = p_open where id = c.id; end if;   -- null: just ask
  return json_build_object('code', c.code, 'open', coalesce(p_open, c.open_new));
end $$;

-- the proposal (0029) now also counts riders who are open to new crews, at a level the crew takes; numbers only
create or replace function public.hi8_squad_nudge(p_code text, p_day date, p_spot text, p_from int, p_to int, p_line text) returns int
language plpgsql security definer set search_path = public as $$
declare s public.squads; n int; nn int; url text; title text; body text; spn text;
begin
  select * into s from public.squads where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or (s.nudged_at is not null and s.nudged_at > now() - interval '20 hours') then return 0; end if;
  if p_day is null or p_day <= public.hi8_today(s.city) or p_day > public.hi8_today(s.city) + 5 then return 0; end if;
  if exists (select 1 from public.crews c where c.squad = s.id and c.status = 'on' and c.day = p_day) then return 0; end if;
  n := (select count(distinct lower(a.email)) from public.ride_asks a join public.squad_members m on m.squad_id = s.id and lower(m.email) = lower(a.email)
        where a.sport = s.sport and a.city = s.city and a.day = p_day);
  if n < 2 then return 0; end if;
  nn := (select count(distinct lower(a.email)) from public.ride_asks a
         where a.sport = s.sport and a.city = s.city and a.day = p_day and a.open_new and a.told_at is null
           and not exists (select 1 from public.squad_members m where m.squad_id = s.id and lower(m.email) = lower(a.email)));
  spn := coalesce((select name from public.spots where slug = p_spot), p_spot);
  url := coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com') || '/?propose=' || s.code || '&d=' || p_day || '&sp=' || p_spot
         || '&f=' || greatest(0, least(23, p_from)) || '&t=' || greatest(1, least(24, p_to));
  title := to_char(p_day, 'FMDay') || ' looks good · ' || s.name;
  body := spn || ' ' || lpad(p_from::text, 2, '0') || '–' || lpad(p_to::text, 2, '0') || ': ' || left(coalesce(p_line, ''), 100) || '. '
          || n || ' of ' || s.name || ' are up for it'
          || case when nn > 0 then ', plus ' || nn || ' new rider' || case when nn = 1 then '' else 's' end || ' open to a crew' else '' end
          || '. Propose it in one tap.';
  if not public.hi8_push(s.created_by, title, body, url, 'nudge:' || s.id || ':' || p_day, 'nudge:' || s.code) then
    perform public.hi8_mail(s.created_by, 'plan', title, body || E'\n\nNobody is in until they say so themselves.\n\n' || url, null, 'nudge:' || s.id || ':' || p_day);
  end if;
  update public.squads set nudged_at = now() where id = s.id;
  return 1;
end $$;

revoke execute on function public.hi8_spot_report(uuid, text, text, text, text, text, text, text, text, numeric, text, double precision, double precision, text) from public;
revoke execute on function public.hi8_conditions(text, text) from public;
revoke execute on function public.hi8_ask(uuid, text, text, date[], boolean, text, text, boolean) from public;
revoke execute on function public.hi8_crew_open(uuid, text, boolean) from public;
revoke execute on function public.hi8_squad_nudge(text, date, text, int, int, text) from public, anon, authenticated;
grant execute on function public.hi8_spot_report(uuid, text, text, text, text, text, text, text, text, numeric, text, double precision, double precision, text) to anon, authenticated;
grant execute on function public.hi8_conditions(text, text) to anon, authenticated;
grant execute on function public.hi8_ask(uuid, text, text, date[], boolean, text, text, boolean) to anon, authenticated;
grant execute on function public.hi8_crew_open(uuid, text, boolean) to anon, authenticated;
grant execute on function public.hi8_squad_nudge(text, date, text, int, int, text) to service_role;

-- check: should print t | t | t
select to_regprocedure('public.hi8_spot_report(uuid, text, text, text, text, text, text, text, text, numeric, text, double precision, double precision, text)') is not null
         and to_regprocedure('public.hi8_conditions(text, text)') is not null as reports,
       to_regprocedure('public.hi8_ask(uuid, text, text, date[], boolean, text, text, boolean)') is not null
         and to_regprocedure('public.hi8_ask(uuid, text, text, date[], boolean, text, text)') is null as asks,
       position('open_new' in pg_get_functiondef('public.hi8_ask_fits'::regproc)) > 0 as open;

notify pgrst, 'reload schema';
