-- Hi8ctane 0005: the Barcelona pilot (2.8).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001, 0002, 0003 and 0004. Safe to run again.
--
-- What it adds:
--   * settings you can change without touching code (public.app_settings):
--       open_posting   true: anyone with a founding plate starts a crew (rookie crews stay with approved captains)
--       pilot_city     "barcelona": the city hi8ctane.com opens on
--       live_sports    ["kite","mtb","mx"];  soon_sports ["wing","surf","sup"] show as "coming soon"
--     Back to captains only:   update public.app_settings set value = 'false' where key = 'open_posting';
--   * start a crew and sign up in one go (hi8_quick_start), with a warning when the same crew already exists
--   * check in at the spot and post a live report ("on, 9 m"); the live map reads them (hi8_live)
--   * alerts: an email when someone posts a crew for your sport, with a one-click stop link
--   * Bizum for drivers, shown only to the riders in their own car
--   * Barcelona: kite, MTB and MX spots (Delta de l'Ebre, Sant Llorenç del Munt, three MX tracks), a
--     Zona Universitària hub, and a place name for directions on every spot
--   * the links in every email open the new app (hi8ctane.com/?c=CODE)

-- ---------------------------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  public      boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
insert into public.app_settings (key, value) values
  ('open_posting', 'true'),
  ('pilot_city',   '"barcelona"'),
  ('live_sports',  '["kite", "mtb", "mx"]'),
  ('soon_sports',  '["wing", "surf", "sup"]')
on conflict (key) do nothing;

create or replace function public.hi8_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key;
$$;

-- hi8_settings: what the website needs to know (open posting, the pilot city, which sports are live)
create or replace function public.hi8_settings() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(key, value), '{}'::json) from public.app_settings where public;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Barcelona: spots and hubs for kite, MTB and MX
-- ---------------------------------------------------------------------------------------------
-- maps = what to search for in Google Maps or Apple Maps to drive there
alter table public.spots add column if not exists maps text check (maps is null or char_length(maps) <= 120);

insert into public.hubs (city, slug, name, sub, lat, lon, sort) values
  ('barcelona', 'sants',    'SANTS',       'SANTS STATION · SOUTH + WEST', 41.3793, 2.1400, 1),
  ('barcelona', 'sagrera',  'LA SAGRERA',  'SANT ANDREU · NORTH',          41.4220, 2.1890, 2),
  ('barcelona', 'zona-uni', 'ZONA UNI',    'ZONA UNIVERSITÀRIA · WEST',    41.3848, 2.1124, 3),
  ('barcelona', 'gracia',   'GRÀCIA',      'PASSEIG DE GRÀCIA · CENTRE',   41.3926, 2.1648, 4)
on conflict (city, slug) do update set name = excluded.name, sub = excluded.sub, lat = excluded.lat, lon = excluded.lon, sort = excluded.sort;

-- face = where the beach looks out to; good_from..good_to = wind directions (clockwise) that work there.
-- A lagoon (lake) works in any direction. Trails and tracks have neither.
insert into public.spots (slug, city, name, lat, lon, sports, face, good_from, good_to, lake, note, sort, maps) values
  ('castelldefels',      'barcelona', 'Castelldefels',          41.268, 1.985, '{kite,wing}', 160,  60, 250, false,
   'Bathing season (about June to September): kite only in the marked zones. Keep clear of swimmers. N-NW is offshore: stay out.', 1, 'Platja de Castelldefels'),
  ('sant-pere-pescador', 'barcelona', 'Sant Pere Pescador',     42.190, 3.110, '{kite,wing}',  95, 340, 200, false,
   'Kite only in the marked zones. Tramuntana (N) is strong and gusty. Beach access through the campsites can cost a fee.', 2, 'Platja de Sant Pere Pescador'),
  ('trabucador',         'barcelona', 'Trabucador',             40.620, 0.733, '{kite,wing}', null, null, null, true,
   'Flat, shallow lagoon for every level. Power lines run along the beach: launch well away from them.', 3, 'Platja del Trabucador'),
  ('riumar',             'barcelona', 'Riumar',                 40.730, 0.866, '{kite,wing}',  50, 290, 140, false,
   'Mestral (NW) is side-shore and gusty. Shallow water, small waves. Give the windsurfers room.', 4, 'Platja de Riumar'),
  ('collserola',         'barcelona', 'Collserola',             41.418, 2.115, '{mtb}',       null, null, null, false,
   'Trails off the Carretera de les Aigües. Walkers have priority.', 6, 'Carretera de les Aigües, Barcelona'),
  ('garraf-park',        'barcelona', 'Garraf park',            41.290, 1.870, '{mtb}',       null, null, null, false,
   'Rocky, technical trails and little shade: bring water.', 7, 'Parc del Garraf'),
  ('sant-llorenc',       'barcelona', 'Sant Llorenç del Munt',  41.625, 2.020, '{mtb}',       null, null, null, false,
   'Natural park: ride the marked tracks only. Most loops start from Matadepera.', 8, 'Matadepera'),
  ('roccos-ranch',       'barcelona', 'Rocco''s Ranch',         41.570, 2.261, '{mx}',        null, null, null, false,
   'Motocross, TT and flat track at the Circuit de Barcelona-Catalunya. Check open days at roccosranch.es.', 9, 'Rocco''s Ranch, Montmeló'),
  ('vallgorguina-mx',    'barcelona', 'ParcMotor Vallgorguina', 41.640, 2.505, '{mx}',        null, null, null, false,
   'C-61 km 15.7. Hard-pack track, 16 jumps, kids track. Bring ID and licence, or buy day insurance there.', 10, 'ParcMotor Vallgorguina'),
  ('bellpuig-mx',        'barcelona', 'Bellpuig',               41.617, 1.019, '{mx}',        null, null, null, false,
   'World Championship track, about 1 h 30 from Barcelona. Open days vary: check before you drive.', 11, 'Circuit de Motocròs de Bellpuig')
on conflict (slug) do update set city = excluded.city, name = excluded.name, lat = excluded.lat, lon = excluded.lon, sports = excluded.sports,
  face = excluded.face, good_from = excluded.good_from, good_to = excluded.good_to, lake = excluded.lake, note = excluded.note,
  sort = excluded.sort, maps = excluded.maps, active = true;
update public.spots set sort = 20 + sort where slug in ('masnou', 'barceloneta', 'garraf') and sort < 20;
update public.spots set maps = coalesce(maps, name) where maps is null;

-- hi8_places (from 0003) + directions
create or replace function public.hi8_places() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'cities', (select coalesce(json_agg(json_build_object('slug', slug, 'name', name, 'country', country, 'status', status, 'tz', tz) order by status, slug), '[]'::json) from public.cities),
    'hubs',   (select coalesce(json_agg(json_build_object('city', city, 'slug', slug, 'name', name, 'sub', sub, 'lat', lat, 'lon', lon) order by city, sort), '[]'::json) from public.hubs),
    'spots',  (select coalesce(json_agg(json_build_object('slug', slug, 'city', city, 'name', name, 'lat', lat, 'lon', lon, 'sports', sports,
                 'face', face, 'good_from', good_from, 'good_to', good_to, 'lake', lake, 'note', note, 'maps', maps) order by city, sort), '[]'::json)
               from public.spots where active));
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Check-ins, live reports, Bizum, alerts: tables
-- ---------------------------------------------------------------------------------------------
alter table public.crew_members add column if not exists here_at timestamptz;   -- checked in at the spot
alter table public.crew_members add column if not exists gone_at timestamptz;   -- left the spot
alter table public.crew_members add column if not exists bizum text check (bizum is null or bizum ~ '^\+[0-9]{8,15}$');
alter table public.crew_messages drop constraint if exists crew_messages_kind_check;
alter table public.crew_messages add constraint crew_messages_kind_check check (kind in ('msg', 'join', 'leave', 'off', 'edit', 'here', 'report'));

create table if not exists public.spot_reports (
  id       bigint generated always as identity primary key,
  crew_id  uuid references public.crews (id) on delete set null,
  spot     text not null references public.spots (slug),
  sport    text not null,
  email    text,
  at       timestamptz not null default now(),
  verdict  text not null check (verdict in ('on', 'meh', 'off')),
  kite     numeric(3,1) check (kite is null or kite between 3 and 21),
  ground   text check (ground is null or ground in ('dry', 'tacky', 'muddy', 'wet')),
  note     text check (note is null or char_length(note) <= 140)
);
create index if not exists spot_reports_spot_at on public.spot_reports (spot, at desc);

create table if not exists public.crew_alerts (
  email       text not null,
  city        text not null references public.cities (slug),
  sport       text not null check (sport in ('kite', 'wing', 'surf', 'sup', 'mtb', 'mx')),
  token       uuid not null default gen_random_uuid() unique,
  created_at  timestamptz not null default now(),
  primary key (email, city, sport)
);

alter table public.spot_reports enable row level security;
alter table public.crew_alerts  enable row level security;
revoke all on public.spot_reports, public.crew_alerts from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_city_now(p_city text) returns timestamp
language sql stable security definer set search_path = public as $$
  select now() at time zone coalesce((select tz from public.cities where slug = p_city), 'Europe/Madrid');
$$;

-- checked in and still there (today, in the crew's city)
create or replace function public.hi8_is_here(m public.crew_members, c public.crews) returns boolean
language sql stable security definer set search_path = public as $$
  select m.here_at is not null and (m.gone_at is null or m.gone_at < m.here_at)
     and (m.here_at at time zone coalesce((select tz from public.cities where slug = c.city), 'Europe/Madrid'))::date = c.day;
$$;

-- one crew as anyone may see it (from 0003) + who's at the spot now, and whether it's happening now
create or replace function public.hi8_crew_card(c public.crews) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', c.code, 'city', c.city, 'sport', c.sport, 'spot', c.spot, 'spot_name', s.name,
    'day', c.day, 'start', to_char(c.start_time, 'HH24:MI'), 'end', to_char(c.end_time, 'HH24:MI'),
    'levels', c.levels, 'max', c.max_riders, 'status', c.status, 'off_reason', c.off_reason,
    'meet_hub', c.meet_hub, 'meet_time', to_char(c.meet_time, 'HH24:MI'),
    'host', public.hi8_name(c.host_email, c.city), 'host_plate', public.hi8_plate(c.host_email, c.city),
    'going', (select count(*) from public.crew_members m where m.crew_id = c.id),
    'rookies', (select count(*) from public.crew_members m where m.crew_id = c.id and m.level = 'rookie'),
    'drivers', (select count(*) from public.crew_members m where m.crew_id = c.id and m.getting = 'drive'),
    'seats_free', greatest(0, (select coalesce(sum(m.seats), 0) from public.crew_members m where m.crew_id = c.id and m.getting = 'drive')
                              - (select count(*) from public.crew_members m where m.crew_id = c.id and m.getting = 'seat' and m.car_with is not null)),
    'need_seat', (select count(*) from public.crew_members m where m.crew_id = c.id and m.getting = 'seat' and m.car_with is null),
    'initials', coalesce((select jsonb_agg(upper(left(public.hi8_name(m.email, c.city), 2)) order by m.joined_at)
                          from public.crew_members m where m.crew_id = c.id), '[]'::jsonb),
    'here', (select count(*) from public.crew_members m where m.crew_id = c.id and public.hi8_is_here(m, c)),
    'live', c.status = 'on' and public.hi8_city_now(c.city) between (c.day + c.start_time) - interval '1 hour'
            and case when c.end_time is null then (c.day + c.start_time) + interval '5 hours' else (c.day + c.end_time) + interval '1 hour' end,
    'created', c.created_at,
    'past', public.hi8_crew_past(c))
  from public.spots s where s.slug = c.spot;
$$;

-- "Kite · Castelldefels · Sat 15 Nov, 11:00" (from 0004, unchanged)
-- the crew's page in the new app
create or replace function public.hi8_crew_url(c public.crews) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com') || '/?c=' || c.code;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. What the website calls (new and changed)
-- ---------------------------------------------------------------------------------------------

-- hi8_crew (from 0004) + check-ins, live reports, and Bizum for the riders in that driver's car
create or replace function public.hi8_crew(p_code text, p_key uuid default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  c    public.crews;
  em   text;
  mine public.crew_members;
  out  jsonb;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023', hint = 'This crew link doesn''t exist.'; end if;
  out := public.hi8_crew_card(c) || jsonb_build_object('note', c.note,
    'maps', (select maps from public.spots where slug = c.spot),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('at', r.at, 'verdict', r.verdict, 'kite', r.kite, 'ground', r.ground) order by r.at desc), '[]'::jsonb)
                from public.spot_reports r where r.crew_id = c.id));
  if p_key is not null then
    em := public.hi8_email(p_key);
    select * into mine from public.crew_members where crew_id = c.id and lower(email) = em;
    out := out || jsonb_build_object('host_is_me', lower(c.host_email) = em, 'captain', public.hi8_is_captain(em));
    if mine.crew_id is not null then
      out := out || jsonb_build_object(
        'me', jsonb_build_object('member_id', mine.member_id, 'level', mine.level, 'getting', mine.getting, 'seats', mine.seats, 'car_with', mine.car_with,
                                 'trip_cost', mine.trip_cost, 'pay_link', mine.pay_link, 'bizum', mine.bizum, 'paid', mine.paid_at is not null,
                                 'here', public.hi8_is_here(mine, c)),
        'meet_note', c.meet_note,
        'members', (select coalesce(jsonb_agg(jsonb_build_object(
            'member_id', m.member_id, 'name', public.hi8_name(m.email, c.city), 'plate', public.hi8_plate(m.email, c.city),
            'level', m.level, 'getting', m.getting, 'seats', m.seats, 'car_with', m.car_with,
            'host', lower(m.email) = lower(c.host_email), 'me', lower(m.email) = em,
            'trip_cost', m.trip_cost, 'pay_link', m.pay_link, 'paid', m.paid_at is not null,
            'bizum', case when m.member_id = mine.car_with or m.member_id = mine.member_id then m.bizum end,
            'here', public.hi8_is_here(m, c),
            'share', case when m.getting = 'drive' and m.trip_cost is not null then
                       round(m.trip_cost / (1 + (select count(*) from public.crew_members p where p.crew_id = c.id and p.car_with = m.member_id)), 2) end
          ) order by m.joined_at), '[]'::jsonb)
          from public.crew_members m where m.crew_id = c.id),
        'reports', (select coalesce(jsonb_agg(jsonb_build_object('at', r.at, 'verdict', r.verdict, 'kite', r.kite, 'ground', r.ground,
                       'note', r.note, 'name', case when r.email is null then null else public.hi8_name(r.email, c.city) end) order by r.at desc), '[]'::jsonb)
                    from public.spot_reports r where r.crew_id = c.id),
        'messages', (select count(*) from public.crew_messages x where x.crew_id = c.id));
    end if;
  end if;
  return out::json;
end $$;

-- hi8_start_crew (from 0004): anyone with a plate when open_posting is on; rookie crews only by approved
-- captains; warns when the same crew is already up (same sport, spot and day, starting within 2 hours)
drop function if exists public.hi8_start_crew(uuid, text, text, date, text, text, text, int, text, text, text, text, text, text, int);
create or replace function public.hi8_start_crew(
  p_key uuid, p_sport text, p_spot text, p_day date, p_start text, p_end text default null,
  p_levels text default null, p_max int default 8, p_meet_hub text default null, p_meet_time text default null,
  p_meet_note text default null, p_note text default null,
  p_level text default 'regular', p_getting text default 'own', p_seats int default 0, p_force boolean default false
) returns json
language plpgsql security definer set search_path = public as $$
declare
  em   text := public.hi8_email(p_key);
  s    public.spots;
  c    public.crews;
  dup  public.crews;
  st   time;
  en   time;
  mt   time;
  me   public.signups;
  cap  boolean;
  lv   text;
begin
  perform public.hi8_limit('start', p_key::text, 10, interval '1 day');
  select * into s from public.spots where slug = p_spot and active;
  if not found then raise exception 'unknown_spot' using errcode = '22023'; end if;
  cap := public.hi8_is_captain(em);
  lv := coalesce(nullif(p_levels, ''), case when cap then 'all' else 'regular' end);   -- captains' crews welcome every level
  if not cap and coalesce(public.hi8_setting('open_posting'), 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'not_captain' using errcode = '42501', hint = 'Only approved captains start crews for now.';
  end if;
  if lv not in ('rookie', 'all', 'regular') then raise exception 'bad_levels' using errcode = '22023'; end if;
  if not cap and lv <> 'regular' then
    raise exception 'captains_only' using errcode = '42501', hint = 'Crews with rookies are run by approved captains. Post it for riders who ride on their own.';
  end if;
  if not (p_sport = any (s.sports)) then raise exception 'wrong_sport_for_spot' using errcode = '22023'; end if;
  if not cap and not coalesce(public.hi8_setting('live_sports') ? p_sport, true) then
    raise exception 'sport_soon' using errcode = '22023', hint = 'That sport is coming soon.';
  end if;
  if p_day is null or p_day < public.hi8_today(s.city) or p_day > public.hi8_today(s.city) + 13 then
    raise exception 'bad_day' using errcode = '22023', hint = 'Pick a day in the next two weeks.';
  end if;
  begin
    st := p_start::time; en := nullif(p_end, '')::time; mt := nullif(p_meet_time, '')::time;
  exception when others then raise exception 'bad_time' using errcode = '22023';
  end;
  if st < '05:00' or st > '21:30' or (en is not null and en <= st) then raise exception 'bad_time' using errcode = '22023'; end if;
  if (p_day + st) < public.hi8_city_now(s.city) - interval '30 minutes' then
    raise exception 'bad_time' using errcode = '22023', hint = 'That time has passed today.';
  end if;
  if p_meet_hub is not null and not exists (select 1 from public.hubs where city = s.city and slug = p_meet_hub) then
    raise exception 'unknown_hub' using errcode = '22023';
  end if;
  if not coalesce(p_force, false) then
    select * into dup from public.crews d
    where d.city = s.city and d.sport = p_sport and d.spot = s.slug and d.day = p_day and d.status = 'on'
      and abs(extract(epoch from (d.start_time - st))) <= 2 * 3600
    order by abs(extract(epoch from (d.start_time - st))) limit 1;
    if found then
      raise exception 'duplicate' using errcode = '22023', detail = dup.code,
        hint = 'There''s already a crew for that: ' || public.hi8_crew_line(dup) || '. Join it, or post yours anyway.';
    end if;
  end if;
  if not exists (select 1 from public.signups where lower(email) = em and city = s.city) then
    select * into me from public.signups where lower(email) = em order by created_at limit 1;
    perform public.join_waitlist(p_city => s.city, p_first_name => me.first_name, p_email => em,
                                 p_sports => coalesce(me.sports, '{}'), p_levels => coalesce(me.levels, '{}'::jsonb), p_source => 'start');
  end if;

  insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, meet_note, note, host_email)
  values (s.city, p_sport, s.slug, p_day, st, en, lv, greatest(2, least(16, coalesce(p_max, 8))), p_meet_hub, mt,
          nullif(left(trim(coalesce(p_meet_note, '')), 140), ''), nullif(left(trim(coalesce(p_note, '')), 280), ''), em)
  returning * into c;
  insert into public.crew_members (crew_id, email, level, getting, seats)
  values (c.id, em, case when coalesce(p_level, 'regular') in ('rookie', 'regular', 'ripper') then coalesce(p_level, 'regular') else 'regular' end,
          case when p_getting in ('seat', 'drive', 'own') then p_getting else 'own' end,
          case when p_getting = 'drive' then greatest(0, least(7, coalesce(p_seats, 0))) else 0 end);
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_quick_start: someone with no account on this phone starts a crew: email, rider name and the crew, all at once
create or replace function public.hi8_quick_start(
  p_email text, p_name text, p_sport text, p_spot text, p_day date, p_start text, p_end text default null,
  p_levels text default null, p_max int default 8, p_meet_hub text default null, p_meet_time text default null,
  p_meet_note text default null, p_note text default null, p_level text default 'regular', p_getting text default 'own',
  p_seats int default 0, p_force boolean default false, p_source text default null, p_ref text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  s   public.spots;
  j   json;
  k   uuid;
  nm  text := nullif(regexp_replace(trim(coalesce(p_name, '')), '[[:cntrl:]]', '', 'g'), '');
begin
  select * into s from public.spots where slug = p_spot and active;
  if not found then raise exception 'unknown_spot' using errcode = '22023'; end if;
  if nm is null then raise exception 'name_required' using errcode = '22023', hint = 'Add a rider name: it''s what the crew sees.'; end if;
  j := public.hi8_join(p_email, s.city, coalesce(p_source, 'start'), p_ref);
  k := (j->>'key')::uuid;
  if not exists (select 1 from public.signups where lower(email) = lower(trim(p_email)) and first_name is not null) then
    perform public.hi8_profile(k, nm);
  end if;
  return (public.hi8_start_crew(k, p_sport, p_spot, p_day, p_start, p_end, p_levels, p_max, p_meet_hub, p_meet_time,
                                p_meet_note, p_note, p_level, p_getting, p_seats, p_force)::jsonb
          || jsonb_build_object('key', k, 'plate', j->'plate', 'city', j->'city', 'existing', j->'existing'))::json;
end $$;

-- hi8_checkin: "I'm at the spot" / "I've left", on the day of the crew
create or replace function public.hi8_checkin(p_key uuid, p_code text, p_here boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare
  em  text := public.hi8_email(p_key);
  c   public.crews;
  m   public.crew_members;
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  select * into m from public.crew_members where crew_id = c.id and lower(email) = em;
  if m.crew_id is null then raise exception 'not_in_crew' using errcode = '42501', hint = 'Join the crew first.'; end if;
  if c.status <> 'on' then raise exception 'crew_off' using errcode = '22023', hint = 'This crew was called off.'; end if;
  if c.day <> public.hi8_today(c.city) then raise exception 'not_today' using errcode = '22023', hint = 'Check in on the day of the crew.'; end if;
  if coalesce(p_here, true) then
    if not public.hi8_is_here(m, c) then
      update public.crew_members set here_at = now(), gone_at = null where crew_id = c.id and member_id = m.member_id;
      insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'here', public.hi8_name(em, c.city) || ' is at the spot');
    end if;
  elsif public.hi8_is_here(m, c) then
    update public.crew_members set gone_at = now() where crew_id = c.id and member_id = m.member_id;
    insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'here', public.hi8_name(em, c.city) || ' left the spot');
  end if;
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_report: how it is at the spot right now (on / meh / off, the kite they're on, the ground), on the crew's day
create or replace function public.hi8_report(
  p_key uuid, p_code text, p_verdict text, p_kite numeric default null, p_ground text default null, p_note text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  em  text := public.hi8_email(p_key);
  c   public.crews;
  m   public.crew_members;
  nt  text := nullif(left(regexp_replace(trim(coalesce(p_note, '')), '[[:cntrl:]]', '', 'g'), 140), '');
  kt  numeric := case when p_kite is null then null else round(p_kite * 2) / 2 end;
begin
  perform public.hi8_limit('report', p_key::text, 12, interval '1 hour');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  select * into m from public.crew_members where crew_id = c.id and lower(email) = em;
  if m.crew_id is null then raise exception 'not_in_crew' using errcode = '42501', hint = 'Join the crew first.'; end if;
  if c.day <> public.hi8_today(c.city) then raise exception 'not_today' using errcode = '22023', hint = 'Reports are for the day of the crew.'; end if;
  if p_verdict not in ('on', 'meh', 'off') then raise exception 'bad_verdict' using errcode = '22023'; end if;
  if kt is not null and (c.sport not in ('kite', 'wing') or kt < 3 or kt > 21) then raise exception 'bad_kite' using errcode = '22023'; end if;
  if p_ground is not null and (c.sport not in ('mtb', 'mx') or p_ground not in ('dry', 'tacky', 'muddy', 'wet')) then
    raise exception 'bad_ground' using errcode = '22023';
  end if;
  insert into public.spot_reports (crew_id, spot, sport, email, verdict, kite, ground, note)
  values (c.id, c.spot, c.sport, em, p_verdict, kt, p_ground, nt);
  if not public.hi8_is_here(m, c) then
    update public.crew_members set here_at = now(), gone_at = null where crew_id = c.id and member_id = m.member_id;
  end if;
  insert into public.crew_messages (crew_id, email, kind, body)
  values (c.id, null, 'report', public.hi8_name(em, c.city) || ' at the spot: ' || upper(p_verdict)
          || coalesce(' · ' || rtrim(rtrim(to_char(kt, 'FM990.0'), '0'), '.') || ' m', '') || coalesce(' · ' || p_ground, '') || coalesce(' · ' || nt, ''));
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_live: the live map. Crews today and the next two days (with who's at the spot) and the last 6 hours of
-- reports, without names.
create or replace function public.hi8_live(p_city text default null) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'at', now(),
    'crews', (select coalesce(json_agg(public.hi8_crew_card(c) order by c.day, c.start_time), '[]'::json) from public.crews c
              where (p_city is null or c.city = p_city) and c.status = 'on'
                and c.day between public.hi8_today(c.city) and public.hi8_today(c.city) + 2),
    'reports', (select coalesce(json_agg(json_build_object('spot', r.spot, 'sport', r.sport, 'at', r.at, 'verdict', r.verdict,
                  'kite', r.kite, 'ground', r.ground) order by r.at desc), '[]'::json)
                from public.spot_reports r join public.spots s on s.slug = r.spot
                where (p_city is null or s.city = p_city) and r.at > now() - interval '6 hours'));
$$;

-- hi8_settle (from 0004) + Bizum: a Spanish mobile number, shown only to the riders in that car
drop function if exists public.hi8_settle(uuid, text, numeric, text);
create or replace function public.hi8_settle(p_key uuid, p_code text, p_cost numeric, p_link text default null, p_bizum text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  em   text := public.hi8_email(p_key);
  c    public.crews;
  d    public.crew_members;
  lk   text := nullif(trim(coalesce(p_link, '')), '');
  bz   text := nullif(regexp_replace(coalesce(p_bizum, ''), '[[:space:].()-]', '', 'g'), '');
  n    int;
  sh   numeric;
  p    record;
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  select * into d from public.crew_members where crew_id = c.id and lower(email) = em;
  if d.crew_id is null or d.getting <> 'drive' then raise exception 'not_driver' using errcode = '42501', hint = 'Only drivers add what their car cost.'; end if;
  if p_cost is null or p_cost < 0 or p_cost > 500 then raise exception 'bad_cost' using errcode = '22023', hint = 'Between €0 and €500 for the car.'; end if;
  if lk is not null and lk !~* '^https://(tikkie\.me|(www\.)?revolut\.me|(www\.)?paypal\.me|bunq\.me|(www\.)?wise\.com|monzo\.me|betaalverzoek\.rabobank\.nl|(www\.)?ing\.nl)/[^[:space:]<>"]+$' then
    raise exception 'bad_link' using errcode = '22023', hint = 'Paste a Revolut, PayPal, Tikkie, bunq, Wise, Monzo, Rabobank or ING payment link.';
  end if;
  if bz is not null then
    if bz ~ '^0034' then bz := '+' || substr(bz, 3); end if;
    if bz ~ '^[67][0-9]{8}$' then bz := '+34' || bz; end if;
    if bz !~ '^\+34[67][0-9]{8}$' then
      raise exception 'bad_bizum' using errcode = '22023', hint = 'Bizum needs a Spanish mobile number, like 612 345 678.';
    end if;
  end if;
  update public.crew_members set trip_cost = round(p_cost, 2), pay_link = lk, bizum = bz where crew_id = c.id and member_id = d.member_id;
  select count(*) into n from public.crew_members where crew_id = c.id and car_with = d.member_id;
  sh := round(p_cost / (1 + n), 2);
  insert into public.crew_messages (crew_id, email, kind, body)
  values (c.id, null, 'edit', public.hi8_name(em, c.city) || '''s car: €' || to_char(p_cost, 'FM9990.00') || ', €' || to_char(sh, 'FM9990.00') || ' each'
          || case when lk is not null or bz is not null then '. How to pay is on the crew page.' else '.' end);
  for p in select m.email from public.crew_members m where m.crew_id = c.id and m.car_with = d.member_id and m.paid_at is null loop
    perform public.hi8_mail(p.email, 'pay', 'Pay ' || public.hi8_name(em, c.city) || ' €' || to_char(sh, 'FM9990.00') || ' for the ride',
      'Your share of ' || public.hi8_name(em, c.city) || '''s car (' || public.hi8_crew_line(c) || '): €' || to_char(sh, 'FM9990.00') || '.'
      || case when lk is not null then E'\n\nPay here: ' || lk when bz is not null then E'\n\nPay by Bizum: the number is on the crew page.' else E'\n\nSettle it with the driver.' end
      || E'\n\nTick "paid" on the crew page when it''s done: ' || public.hi8_crew_url(c), c.id,
      'pay:' || c.id || ':' || lower(p.email) || ':' || to_char(p_cost, 'FM9990.00'));
  end loop;
  return public.hi8_crew(c.code, p_key);
end $$;

-- alerts: "email me when someone posts a <sport> crew in <city>"
create or replace function public.hi8_alert_list(p_email text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'sport', sport) order by city, sport), '[]'::jsonb)
  from public.crew_alerts where email = lower(p_email);
$$;

create or replace function public.hi8_alert(p_key uuid, p_city text, p_sport text, p_on boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  if not exists (select 1 from public.cities where slug = p_city) then raise exception 'unknown_city' using errcode = '22023'; end if;
  if p_sport not in ('kite', 'wing', 'surf', 'sup', 'mtb', 'mx') then raise exception 'bad_sport' using errcode = '22023'; end if;
  if coalesce(p_on, true) then
    insert into public.crew_alerts (email, city, sport) values (em, p_city, p_sport) on conflict do nothing;
  else
    delete from public.crew_alerts where email = em and city = p_city and sport = p_sport;
  end if;
  return json_build_object('alerts', public.hi8_alert_list(em));
end $$;

-- hi8_alert_signup: someone with no account asks for alerts. Signs them up (with a founding plate) and switches it on.
create or replace function public.hi8_alert_signup(p_email text, p_city text, p_sport text, p_source text default null, p_ref text default null) returns json
language plpgsql security definer set search_path = public as $$
declare j json; k uuid;
begin
  if not exists (select 1 from public.cities where slug = p_city) then raise exception 'unknown_city' using errcode = '22023'; end if;
  j := public.hi8_join(p_email, p_city, coalesce(p_source, 'alert'), p_ref);
  k := (j->>'key')::uuid;
  return (j::jsonb || public.hi8_alert(k, p_city, p_sport, true)::jsonb)::json;
end $$;

-- hi8_unsubscribe: the stop link in an alert email
create or replace function public.hi8_unsubscribe(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare a public.crew_alerts;
begin
  perform public.hi8_limit('unsub', coalesce(public.hi8_client(), 'none'), 30, interval '10 minutes');
  delete from public.crew_alerts where token = p_token returning * into a;
  return json_build_object('ok', true, 'stopped', a.email is not null, 'sport', a.sport, 'city', a.city);
end $$;

-- hi8_me (from 0003) + alerts
create or replace function public.hi8_me(p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  em   text := public.hi8_email(p_key);
  home public.signups;
begin
  select * into home from public.signups s where lower(email) = em
  order by (select status from public.cities where slug = s.city) = 'open' desc, created_at limit 1;
  return json_build_object(
    'name', public.hi8_name(em, home.city), 'has_name', home.first_name is not null,
    'home', home.city, 'sports', home.sports, 'levels', home.levels, 'hub', home.hub,
    'max_min', home.max_min, 'getting_there', home.getting_there, 'verified', home.email_verified_at is not null,
    'email_hint', left(em, 1) || '•••@' || split_part(em, '@', 2),
    'cities', (select coalesce(json_agg(json_build_object('city', s.city, 'name', ci.name, 'status', ci.status, 'plate', s.plate,
                 'captain', s.captain, 'captain_approved', s.captain_approved) order by s.created_at), '[]'::json)
               from public.signups s join public.cities ci on ci.slug = s.city where lower(s.email) = em),
    'captain', public.hi8_is_captain(em),
    'alerts', public.hi8_alert_list(em),
    'rsvp', (select json_build_object('event', r.event, 'session', r.session, 'hub', r.hub, 'photo', r.photo_ok)
             from public.night_rsvps r where lower(r.email) = em order by r.created_at desc limit 1),
    'crews', (select coalesce(json_agg(public.hi8_crew_card(c) || jsonb_build_object('host_is_me', lower(c.host_email) = em) order by c.day desc, c.start_time desc), '[]'::json)
              from public.crews c join public.crew_members m on m.crew_id = c.id and lower(m.email) = em
              where c.day >= public.hi8_today(c.city) - 365));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Emails: new crews for your sport, and every link to the new app
-- ---------------------------------------------------------------------------------------------

-- when a crew is posted (at commit, so the captain is already in it): everyone with an alert for that
-- sport and city, at most 3 of these a day each
create or replace function public.hi8_on_new_crew() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c    public.crews;
  a    record;
  n    int;
  card jsonb;
  hub  text;
  site text := coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com');
begin
  select * into c from public.crews where id = new.id;
  if c.id is null or c.status <> 'on' then return null; end if;
  card := public.hi8_crew_card(c);
  select name into hub from public.hubs where city = c.city and slug = c.meet_hub;
  for a in select * from public.crew_alerts where city = c.city and sport = c.sport and email <> lower(c.host_email) loop
    select count(*) into n from public.outbox where to_email = a.email and kind = 'new_crew' and created_at > now() - interval '1 day';
    continue when n >= 3;
    perform public.hi8_mail(a.email, 'new_crew', 'New ' || c.sport || ' crew · ' || public.hi8_crew_line(c),
      (card->>'host') || ' posted a crew: ' || public.hi8_crew_line(c) || '.'
      || case when hub is not null then E'\nCars leave ' || initcap(hub) || coalesce(' at ' || to_char(c.meet_time, 'HH24:MI'), '') || '.' else '' end
      || case when (card->>'seats_free')::int > 0 then ' ' || (card->>'seats_free') || ' seat' || case when (card->>'seats_free')::int = 1 then '' else 's' end || ' free.' else '' end
      || coalesce(E'\n"' || c.note || '"', '')
      || E'\n\nSee the forecast and join in one tap: ' || public.hi8_crew_url(c)
      || E'\n\nStop these emails: ' || site || '/?stop=' || a.token,
      c.id, 'new:' || c.id || ':' || a.email);
  end loop;
  return null;
end $$;
drop trigger if exists hi8_new_crew_mail on public.crews;
create constraint trigger hi8_new_crew_mail after insert on public.crews deferrable initially deferred
  for each row execute function public.hi8_on_new_crew();

-- called off (from 0004): the link goes to the new app
create or replace function public.hi8_on_crew() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if old.status = 'on' and new.status = 'off' then
    for m in select email from public.crew_members where crew_id = new.id and lower(email) <> lower(new.host_email) loop
      perform public.hi8_mail(m.email, 'off', 'Called off · ' || public.hi8_crew_line(new),
        public.hi8_crew_line(new) || E' is called off.\n\nWhy: ' || coalesce(new.off_reason, 'the captain called it off')
        || E'\n\nOther crews coming up, or start your own: ' || coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com') || '/?city=' || new.city || '&sport=' || new.sport,
        new.id, 'off:' || new.id || ':' || lower(m.email));
    end loop;
  end if;
  return null;
end $$;

-- chat digest (from 0004): the link opens the crew's chat in the new app
create or replace function public.hi8_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.crews; m record;
begin
  if new.kind <> 'msg' or new.email is null then return null; end if;
  select * into c from public.crews where id = new.crew_id;
  for m in select email from public.crew_members where crew_id = new.crew_id and lower(email) <> lower(new.email) loop
    if not exists (select 1 from public.outbox o where o.kind = 'chat' and o.crew_id = new.crew_id and o.to_email = lower(m.email)
                   and o.created_at > now() - interval '2 hours') then
      perform public.hi8_mail(m.email, 'chat', public.hi8_name(new.email, c.city) || ' in the crew chat · ' || public.hi8_crew_line(c),
        public.hi8_name(new.email, c.city) || ': ' || new.body || E'\n\nReply in the chat: ' || public.hi8_crew_url(c) || '#chat', c.id, null);
    end if;
  end loop;
  return null;
end $$;

-- welcome (from 0004): riders start crews too now
create or replace function public.hi8_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.signups where lower(email) = lower(new.email) and id <> new.id) then return null; end if;
  perform public.hi8_mail(new.email, 'welcome',
    case when new.plate is not null then 'Your founding plate: #' || lpad(new.plate::text, 3, '0') || ' in ' || (select name from public.cities where slug = new.city)
         else 'You''re on the Hi8ctane list in ' || (select name from public.cities where slug = new.city) end,
    E'Welcome to Hi8ctane.\n\n'
    || case when new.plate is not null then 'You''re founding rider #' || new.plate || ' in ' || (select name from public.cities where slug = new.city) || E'. The plate is yours for good.\n\n' else '' end
    || E'Two things you can do any day:\n- Join a crew: pick one, say how you get there, ride.\n- Start a crew: pick a window from the forecast and a spot, share it to your group chats.\n\n'
    || 'The live map and the crews coming up: ' || coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com') || '/?city=' || new.city,
    null, 'welcome:' || lower(new.email));
  return null;
end $$;

-- erase_email (from 0004) + alerts and reports
create or replace function public.erase_email(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; em text := lower(trim(p_email));
begin
  update public.crews set status = 'off', off_reason = 'The captain left Hi8ctane', host_email = 'erased' where lower(host_email) = em;
  delete from public.crew_members where lower(email) = em; get diagnostics e = row_count;
  update public.crew_messages set email = null, kind = 'edit', body = '(message removed)' where lower(email) = em;
  update public.spot_reports set email = null, note = null where lower(email) = em;
  delete from public.crew_alerts where email = em; get diagnostics h = row_count;
  delete from public.city_requests where lower(email) = em; get diagnostics f = row_count;
  delete from public.signups where lower(email) = em; get diagnostics a = row_count;
  delete from public.night_rsvps where lower(email) = em; get diagnostics b = row_count;
  delete from public.rider_keys where lower(email) = em; get diagnostics c = row_count;
  delete from public.partner_leads where lower(contact) = em; get diagnostics d = row_count;
  delete from public.outbox where to_email = em; get diagnostics g = row_count;
  return json_build_object('signups_deleted', a, 'rsvps_deleted', b, 'keys_deleted', c, 'partner_leads_deleted', d,
                           'crew_memberships_deleted', e, 'city_requests_deleted', f, 'emails_deleted', g, 'alerts_deleted', h);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Who may call what
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.hi8_setting(text) from public, anon, authenticated;
revoke execute on function public.hi8_city_now(text) from public, anon, authenticated;
revoke execute on function public.hi8_is_here(public.crew_members, public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_crew_card(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_crew_url(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_alert_list(text) from public, anon, authenticated;
revoke execute on function public.hi8_on_new_crew() from public, anon, authenticated;
revoke execute on function public.hi8_on_crew() from public, anon, authenticated;
revoke execute on function public.hi8_on_message() from public, anon, authenticated;
revoke execute on function public.hi8_on_signup() from public, anon, authenticated;
revoke execute on function public.erase_email(text) from public, anon, authenticated;

revoke execute on function public.hi8_settings() from public;
revoke execute on function public.hi8_places() from public;
revoke execute on function public.hi8_crew(text, uuid) from public;
revoke execute on function public.hi8_start_crew(uuid, text, text, date, text, text, text, int, text, text, text, text, text, text, int, boolean) from public;
revoke execute on function public.hi8_quick_start(text, text, text, text, date, text, text, text, int, text, text, text, text, text, text, int, boolean, text, text) from public;
revoke execute on function public.hi8_checkin(uuid, text, boolean) from public;
revoke execute on function public.hi8_report(uuid, text, text, numeric, text, text) from public;
revoke execute on function public.hi8_live(text) from public;
revoke execute on function public.hi8_settle(uuid, text, numeric, text, text) from public;
revoke execute on function public.hi8_alert(uuid, text, text, boolean) from public;
revoke execute on function public.hi8_alert_signup(text, text, text, text, text) from public;
revoke execute on function public.hi8_unsubscribe(uuid) from public;
revoke execute on function public.hi8_me(uuid) from public;

grant execute on function public.hi8_settings() to anon, authenticated;
grant execute on function public.hi8_places() to anon, authenticated;
grant execute on function public.hi8_crew(text, uuid) to anon, authenticated;
grant execute on function public.hi8_start_crew(uuid, text, text, date, text, text, text, int, text, text, text, text, text, text, int, boolean) to anon, authenticated;
grant execute on function public.hi8_quick_start(text, text, text, text, date, text, text, text, int, text, text, text, text, text, text, int, boolean, text, text) to anon, authenticated;
grant execute on function public.hi8_checkin(uuid, text, boolean) to anon, authenticated;
grant execute on function public.hi8_report(uuid, text, text, numeric, text, text) to anon, authenticated;
grant execute on function public.hi8_live(text) to anon, authenticated;
grant execute on function public.hi8_settle(uuid, text, numeric, text, text) to anon, authenticated;
grant execute on function public.hi8_alert(uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.hi8_alert_signup(text, text, text, text, text) to anon, authenticated;
grant execute on function public.hi8_unsubscribe(uuid) to anon, authenticated;
grant execute on function public.hi8_me(uuid) to anon, authenticated;
grant execute on function public.erase_email(text) to service_role;

-- What's going on, from the SQL editor:
--   select * from public.app_settings;
--   select c.day, c.start_time, c.sport, c.spot, public.hi8_name(c.host_email) as host,
--          (select count(*) from public.crew_members m where m.crew_id = c.id) as going
--   from public.crews c where c.day >= current_date order by c.day, c.start_time;
--   select at, spot, verdict, kite, ground from public.spot_reports order by at desc limit 20;

-- the API picks up the new functions straight away
notify pgrst, 'reload schema';
