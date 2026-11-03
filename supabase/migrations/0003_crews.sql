-- Hi8ctane 0003: real crews (2.7.2).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 and 0002. Safe to run again.
--
-- What it adds:
--   * spots and pickup hubs per city (edit them in Table Editor: the website reads them from here)
--   * approved captains: tick signups.captain_approved for a rider in a city (Table Editor), or run
--       select public.approve_captain('their@email.com', 'amsterdam');
--     Only approved captains can start crews; anyone signed up can join one.
--   * crews, who's in each one (level, how they get there, seats), and each crew's chat
--   * the hi8_* functions the website calls, same rules as 0002: tables stay locked, the browser
--     key only acts for its own rider, no emails ever leave the database.

-- ---------------------------------------------------------------------------------------------
-- 1. Cities, hubs, spots
-- ---------------------------------------------------------------------------------------------
alter table public.cities add column if not exists tz text not null default 'Europe/Amsterdam';
update public.cities set tz = 'Europe/Madrid'  where slug in ('barcelona', 'tarifa');
update public.cities set tz = 'Europe/Lisbon'  where slug = 'lisbon';
update public.cities set tz = 'Europe/Berlin'  where slug = 'berlin';

-- riders can ask for a city that isn't on the list yet ("Other city" on the city page)
create table if not exists public.city_requests (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  city        text not null check (char_length(city) between 2 and 60),
  country     text check (country is null or char_length(country) <= 60),
  captain     boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists city_requests_email_city on public.city_requests (lower(email), lower(city));

create table if not exists public.hubs (
  city   text not null references public.cities (slug),
  slug   text not null check (slug ~ '^[a-z0-9-]{2,20}$'),
  name   text not null,
  sub    text,
  lat    double precision not null,
  lon    double precision not null,
  sort   int not null default 0,
  primary key (city, slug)
);
insert into public.hubs (city, slug, name, sub, lat, lon, sort) values
  ('amsterdam', 'west',    'SLOTERDIJK', 'AMSTERDAM WEST',    52.3889, 4.8378, 1),
  ('amsterdam', 'cs',      'CENTRAAL',   'THE CENTRE',        52.3791, 4.9003, 2),
  ('amsterdam', 'zuid',    'A''DAM ZUID', 'ZUID + AMSTELVEEN', 52.3389, 4.8730, 3),
  ('amsterdam', 'hlm',     'HAARLEM',    'HAARLEM STATION',   52.3874, 4.6383, 4),
  ('barcelona', 'sants',   'SANTS',      'SANTS STATION',     41.3793, 2.1400, 1),
  ('barcelona', 'gracia',  'GRÀCIA',     'PASSEIG DE GRÀCIA', 41.3926, 2.1648, 2),
  ('barcelona', 'sagrera', 'LA SAGRERA', 'SANT ANDREU',       41.4220, 2.1890, 3)
on conflict (city, slug) do nothing;

-- face = the compass direction the beach looks out to; good_from..good_to = wind directions ("from",
-- clockwise) that blow on or along the beach: safe for kite and wing. Lakes and trails have neither.
-- Coordinates are for the forecast, not for meeting: captains write the exact meeting point per crew.
create table if not exists public.spots (
  slug       text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  city       text not null references public.cities (slug),
  name       text not null,
  lat        double precision not null,
  lon        double precision not null,
  sports     text[] not null check (sports <@ array['kite', 'wing', 'surf', 'sup', 'mtb', 'mx']::text[] and cardinality(sports) > 0),
  face       int check (face is null or face between 0 and 359),
  good_from  int check (good_from is null or good_from between 0 and 359),
  good_to    int check (good_to is null or good_to between 0 and 359),
  lake       boolean not null default false,
  note       text check (note is null or char_length(note) <= 160),
  active     boolean not null default true,
  sort       int not null default 0
);
insert into public.spots (slug, city, name, lat, lon, sports, face, good_from, good_to, lake, note, sort) values
  ('wijk-aan-zee',      'amsterdam', 'Wijk aan Zee',       52.496,  4.582, '{kite,wing,surf}', 280, 200, 320, false, null, 1),
  ('ijmuiden',          'amsterdam', 'IJmuiden',           52.460,  4.555, '{kite,wing,sup}',  275, 200, 340, false, null, 2),
  ('zandvoort',         'amsterdam', 'Zandvoort',          52.373,  4.523, '{surf,kite}',      285, 200, 330, false, null, 3),
  ('sloterplas',        'amsterdam', 'Sloterplas',         52.365,  4.810, '{sup}',            null, null, null, true, null, 4),
  ('schoorl',           'amsterdam', 'Schoorl dunes',      52.701,  4.687, '{mtb}',            null, null, null, false, null, 5),
  ('amsterdamse-bos',   'amsterdam', 'Amsterdamse Bos',    52.330,  4.840, '{mtb}',            null, null, null, false, null, 6),
  ('lelystad-mx',       'amsterdam', 'Lelystad MX',        52.490,  5.510, '{mx}',             null, null, null, false, 'Check the track''s opening days before you go', 7),
  ('castelldefels',     'barcelona', 'Castelldefels',      41.268,  1.985, '{kite,wing}',      170, 90, 250, false, 'Kite is banned in bathing zones 1 June to 30 September', 1),
  ('sant-pere-pescador','barcelona', 'Sant Pere Pescador', 42.190,  3.110, '{kite,wing}',      100, 350, 190, false, null, 2),
  ('masnou',            'barcelona', 'Masnou',             41.476,  2.318, '{surf}',           150, 60, 220, false, null, 3),
  ('barceloneta',       'barcelona', 'Barceloneta',        41.378,  2.193, '{sup,surf}',       140, 60, 220, false, null, 4),
  ('garraf',            'barcelona', 'Garraf',             41.250,  1.900, '{sup}',            200, 120, 280, false, null, 5),
  ('collserola',        'barcelona', 'Collserola',         41.418,  2.115, '{mtb}',            null, null, null, false, null, 6),
  ('garraf-park',       'barcelona', 'Garraf park',        41.290,  1.870, '{mtb}',            null, null, null, false, null, 7),
  ('carcavelos',        'lisbon',    'Carcavelos',         38.678, -9.335, '{surf}',           200, 120, 280, false, null, 1),
  ('guincho',           'lisbon',    'Guincho',            38.730, -9.473, '{kite,surf}',      270, 300, 30,  false, null, 2),
  ('costa-da-caparica', 'lisbon',    'Costa da Caparica',  38.640, -9.240, '{surf}',           260, 180, 340, false, null, 3),
  ('lagoa-albufeira',   'lisbon',    'Lagoa de Albufeira', 38.510, -9.170, '{wing,sup}',       null, null, null, true, null, 4),
  ('sintra',            'lisbon',    'Sintra',             38.790, -9.390, '{mtb}',            null, null, null, false, null, 5),
  ('los-lances',        'tarifa',    'Los Lances',         36.030, -5.630, '{kite}',           200, 60, 300, false, null, 1),
  ('valdevaqueros',     'tarifa',    'Valdevaqueros',      36.070, -5.680, '{kite,wing}',      200, 60, 300, false, null, 2),
  ('el-palmar',         'tarifa',    'El Palmar',          36.240, -6.070, '{surf}',           250, 170, 330, false, null, 3),
  ('alcornocales',      'tarifa',    'Alcornocales',       36.400, -5.600, '{mtb}',            null, null, null, false, null, 4),
  ('muggelsee',         'berlin',    'Müggelsee',          52.440, 13.650, '{wing,sup}',       null, null, null, true, null, 1),
  ('wannsee',           'berlin',    'Wannsee',            52.430, 13.170, '{sup}',            null, null, null, true, null, 2),
  ('grunewald',         'berlin',    'Grunewald',          52.480, 13.250, '{mtb}',            null, null, null, false, null, 3),
  ('teufelsberg',       'berlin',    'Teufelsberg',        52.497, 13.241, '{mtb}',            null, null, null, false, null, 4)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 2. Captains, crews, members, chat
-- ---------------------------------------------------------------------------------------------
alter table public.signups add column if not exists captain_approved boolean not null default false;

create table if not exists public.crews (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  city        text not null references public.cities (slug),
  sport       text not null check (sport in ('kite', 'wing', 'surf', 'sup', 'mtb', 'mx')),
  spot        text not null references public.spots (slug),
  day         date not null,
  start_time  time not null,
  end_time    time,
  levels      text not null default 'all' check (levels in ('rookie', 'all', 'regular')),
  max_riders  int not null default 8 check (max_riders between 2 and 16),
  meet_hub    text,
  meet_time   time,
  meet_note   text check (meet_note is null or char_length(meet_note) <= 140),
  note        text check (note is null or char_length(note) <= 280),
  host_email  text not null,
  status      text not null default 'on' check (status in ('on', 'off')),
  off_reason  text check (off_reason is null or char_length(off_reason) <= 140),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists crews_city_day on public.crews (city, day);

create table if not exists public.crew_members (
  member_id  uuid not null default gen_random_uuid() unique,
  crew_id    uuid not null references public.crews (id) on delete cascade,
  email      text not null,
  level      text not null check (level in ('rookie', 'regular', 'ripper')),
  getting    text not null default 'own' check (getting in ('seat', 'drive', 'own')),
  seats      int not null default 0 check (seats between 0 and 7),
  car_with   uuid,                   -- the driver's member_id, for riders who need a seat
  joined_at  timestamptz not null default now(),
  primary key (crew_id, email)
);
create index if not exists crew_members_email on public.crew_members (lower(email));

create table if not exists public.crew_messages (
  id          bigint generated always as identity primary key,
  crew_id     uuid not null references public.crews (id) on delete cascade,
  email       text,                  -- null for the crew's own notices (joined, left, called off)
  kind        text not null default 'msg' check (kind in ('msg', 'join', 'leave', 'off', 'edit')),
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists crew_messages_crew on public.crew_messages (crew_id, id);

alter table public.city_requests enable row level security;
alter table public.hubs          enable row level security;
alter table public.spots         enable row level security;
alter table public.crews         enable row level security;
alter table public.crew_members  enable row level security;
alter table public.crew_messages enable row level security;
revoke all on public.city_requests, public.hubs, public.spots, public.crews, public.crew_members, public.crew_messages from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Helpers (not callable from the website)
-- ---------------------------------------------------------------------------------------------

-- the name other riders see: the rider name, or "Rider #12" from their plate
create or replace function public.hi8_name(p_email text, p_city text default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select first_name from public.signups where lower(email) = lower(p_email) and first_name is not null
     order by (city = p_city) desc nulls last, created_at limit 1),
    'Rider #' || coalesce((select plate::text from public.signups where lower(email) = lower(p_email) and plate is not null
                           order by (city = p_city) desc nulls last, created_at limit 1), '?'));
$$;

create or replace function public.hi8_plate(p_email text, p_city text) returns int
language sql stable security definer set search_path = public as $$
  select plate from public.signups where lower(email) = lower(p_email) and plate is not null
  order by (city = p_city) desc, created_at limit 1;
$$;

-- today in a city's own time zone
create or replace function public.hi8_today(p_city text) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select tz from public.cities where slug = p_city), 'Europe/Amsterdam'))::date;
$$;

-- a crew is past once its day is over (in its city's time zone)
create or replace function public.hi8_crew_past(c public.crews) returns boolean
language sql stable security definer set search_path = public as $$
  select c.day < public.hi8_today(c.city);
$$;

-- one crew as anyone may see it: no emails, initials only, no meeting note
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
    'past', public.hi8_crew_past(c))
  from public.spots s where s.slug = c.spot;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. What the website calls
-- ---------------------------------------------------------------------------------------------

-- hi8_places: cities, hubs and spots, for the forecast and the start-a-crew form
create or replace function public.hi8_places() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'cities', (select coalesce(json_agg(json_build_object('slug', slug, 'name', name, 'country', country, 'status', status, 'tz', tz) order by status, slug), '[]'::json) from public.cities),
    'hubs',   (select coalesce(json_agg(json_build_object('city', city, 'slug', slug, 'name', name, 'sub', sub, 'lat', lat, 'lon', lon) order by city, sort), '[]'::json) from public.hubs),
    'spots',  (select coalesce(json_agg(json_build_object('slug', slug, 'city', city, 'name', name, 'lat', lat, 'lon', lon, 'sports', sports,
                 'face', face, 'good_from', good_from, 'good_to', good_to, 'lake', lake, 'note', note) order by city, sort), '[]'::json)
               from public.spots where active));
$$;

-- hi8_crews: the crews coming up (today and the next 13 days), as anyone may see them
create or replace function public.hi8_crews(p_city text default null) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(public.hi8_crew_card(c) order by c.day, c.start_time), '[]'::json)
  from public.crews c
  where (p_city is null or c.city = p_city)
    and c.day between public.hi8_today(c.city) and public.hi8_today(c.city) + 13;
$$;

-- hi8_crew: one crew. Members of the crew also see who's in by name, the cars and the meeting note.
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
  out := public.hi8_crew_card(c) || jsonb_build_object('note', c.note);
  if p_key is not null then
    em := public.hi8_email(p_key);
    select * into mine from public.crew_members where crew_id = c.id and lower(email) = em;
    out := out || jsonb_build_object('host_is_me', lower(c.host_email) = em,
      'captain', exists (select 1 from public.signups where lower(email) = em and city = c.city and captain_approved));
    if mine.crew_id is not null then
      out := out || jsonb_build_object(
        'me', jsonb_build_object('member_id', mine.member_id, 'level', mine.level, 'getting', mine.getting, 'seats', mine.seats, 'car_with', mine.car_with),
        'meet_note', c.meet_note,
        'members', (select coalesce(jsonb_agg(jsonb_build_object(
            'member_id', m.member_id, 'name', public.hi8_name(m.email, c.city), 'plate', public.hi8_plate(m.email, c.city),
            'level', m.level, 'getting', m.getting, 'seats', m.seats, 'car_with', m.car_with,
            'host', lower(m.email) = lower(c.host_email), 'me', lower(m.email) = em) order by m.joined_at), '[]'::jsonb)
          from public.crew_members m where m.crew_id = c.id),
        'messages', (select count(*) from public.crew_messages x where x.crew_id = c.id));
    end if;
  end if;
  return out::json;
end $$;

-- hi8_start_crew: an approved captain starts a crew (and is its first member)
create or replace function public.hi8_start_crew(
  p_key uuid, p_sport text, p_spot text, p_day date, p_start text, p_end text default null,
  p_levels text default 'all', p_max int default 8, p_meet_hub text default null, p_meet_time text default null,
  p_meet_note text default null, p_note text default null,
  p_level text default 'regular', p_getting text default 'own', p_seats int default 0
) returns json
language plpgsql security definer set search_path = public as $$
declare
  em  text := public.hi8_email(p_key);
  s   public.spots;
  c   public.crews;
  st  time;
  en  time;
  mt  time;
begin
  perform public.hi8_limit('start', p_key::text, 10, interval '1 day');
  select * into s from public.spots where slug = p_spot and active;
  if not found then raise exception 'unknown_spot' using errcode = '22023'; end if;
  if not exists (select 1 from public.signups where lower(email) = em and city = s.city and captain_approved) then
    raise exception 'not_captain' using errcode = '42501', hint = 'Only approved captains start crews for now.';
  end if;
  if not (p_sport = any (s.sports)) then raise exception 'wrong_sport_for_spot' using errcode = '22023'; end if;
  if p_day is null or p_day < public.hi8_today(s.city) or p_day > public.hi8_today(s.city) + 13 then
    raise exception 'bad_day' using errcode = '22023', hint = 'Pick a day in the next two weeks.';
  end if;
  begin
    st := p_start::time; en := nullif(p_end, '')::time; mt := nullif(p_meet_time, '')::time;
  exception when others then raise exception 'bad_time' using errcode = '22023';
  end;
  if st < '05:00' or st > '21:30' or (en is not null and en <= st) then raise exception 'bad_time' using errcode = '22023'; end if;
  if p_day = public.hi8_today(s.city) and st < (now() at time zone (select tz from public.cities where slug = s.city))::time then
    raise exception 'bad_time' using errcode = '22023', hint = 'That time has passed today.';
  end if;
  if p_meet_hub is not null and not exists (select 1 from public.hubs where city = s.city and slug = p_meet_hub) then
    raise exception 'unknown_hub' using errcode = '22023';
  end if;

  insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, meet_note, note, host_email)
  values (s.city, p_sport, s.slug, p_day, st, en, coalesce(p_levels, 'all'), coalesce(p_max, 8), p_meet_hub, mt,
          nullif(left(trim(coalesce(p_meet_note, '')), 140), ''), nullif(left(trim(coalesce(p_note, '')), 280), ''), em)
  returning * into c;
  insert into public.crew_members (crew_id, email, level, getting, seats)
  values (c.id, em, coalesce(p_level, 'regular'), coalesce(p_getting, 'own'), case when p_getting = 'drive' then greatest(0, least(7, coalesce(p_seats, 0))) else 0 end);
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_join_crew: join (or change your level / how you get there)
create or replace function public.hi8_join_crew(
  p_key uuid, p_code text, p_level text, p_getting text default 'own', p_seats int default 0, p_car_with uuid default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  em  text := public.hi8_email(p_key);
  c   public.crews;
  was boolean;
  drv public.crew_members;
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if c.status <> 'on' then raise exception 'crew_off' using errcode = '22023', hint = 'This crew was called off.'; end if;
  if public.hi8_crew_past(c) then raise exception 'crew_past' using errcode = '22023'; end if;
  if p_level not in ('rookie', 'regular', 'ripper') then raise exception 'bad_level' using errcode = '22023'; end if;
  if c.levels = 'regular' and p_level = 'rookie' then
    raise exception 'level' using errcode = '22023', hint = 'This crew is for regulars and up. Look for a rookie crew.';
  end if;
  if p_getting not in ('seat', 'drive', 'own') then raise exception 'bad_getting' using errcode = '22023'; end if;
  select exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) into was;
  if not was and (select count(*) from public.crew_members where crew_id = c.id) >= c.max_riders then
    raise exception 'crew_full' using errcode = '22023', hint = 'This crew is full.';
  end if;
  if not exists (select 1 from public.signups where lower(email) = em) then
    raise exception 'unknown_key' using errcode = '28000';
  end if;
  -- "any car": a seat in the car with the most room, if a driver has one free
  if p_getting = 'seat' and p_car_with is null then
    select d.member_id into p_car_with from public.crew_members d
    where d.crew_id = c.id and d.getting = 'drive' and lower(d.email) <> em
      and d.seats > (select count(*) from public.crew_members x where x.crew_id = c.id and x.car_with = d.member_id and lower(x.email) <> em)
    order by d.seats - (select count(*) from public.crew_members x where x.crew_id = c.id and x.car_with = d.member_id and lower(x.email) <> em) desc, d.joined_at
    limit 1;
  end if;
  if p_car_with is not null then
    select * into drv from public.crew_members where crew_id = c.id and member_id = p_car_with and getting = 'drive';
    if not found then raise exception 'no_such_car' using errcode = '22023'; end if;
    if lower(drv.email) = em then raise exception 'no_such_car' using errcode = '22023'; end if;
    if (select count(*) from public.crew_members where crew_id = c.id and car_with = p_car_with and lower(email) <> em) >= drv.seats then
      raise exception 'car_full' using errcode = '22023', hint = 'That car is full.';
    end if;
  end if;

  insert into public.crew_members (crew_id, email, level, getting, seats, car_with)
  values (c.id, em, p_level, p_getting, case when p_getting = 'drive' then greatest(0, least(7, coalesce(p_seats, 0))) else 0 end,
          case when p_getting = 'seat' then p_car_with end)
  on conflict (crew_id, email) do update set
    level = excluded.level, getting = excluded.getting, seats = excluded.seats, car_with = excluded.car_with;
  -- stopped driving: their passengers need a seat again
  if p_getting <> 'drive' then
    update public.crew_members set car_with = null
    where crew_id = c.id and car_with = (select member_id from public.crew_members where crew_id = c.id and lower(email) = em);
  end if;
  if not was then
    insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'join', public.hi8_name(em, c.city) || ' is in');
  end if;
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_leave_crew: leave a crew. When the host leaves, the crew is called off.
create or replace function public.hi8_leave_crew(p_key uuid, p_code text, p_reason text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  em  text := public.hi8_email(p_key);
  c   public.crews;
  mid uuid;
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if lower(c.host_email) = em then
    update public.crews set status = 'off', off_reason = coalesce(nullif(left(trim(coalesce(p_reason, '')), 140), ''), 'The captain called it off'), updated_at = now()
    where id = c.id;
    insert into public.crew_messages (crew_id, email, kind, body)
    values (c.id, null, 'off', 'Called off: ' || coalesce(nullif(left(trim(coalesce(p_reason, '')), 140), ''), 'the captain called it off'));
  else
    delete from public.crew_members where crew_id = c.id and lower(email) = em returning member_id into mid;
    if mid is not null then
      update public.crew_members set car_with = null where crew_id = c.id and car_with = mid;
      insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'leave', public.hi8_name(em, c.city) || ' left');
    end if;
  end if;
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_messages: a crew's chat, for its members (after = the last id you have)
create or replace function public.hi8_messages(p_key uuid, p_code text, p_after bigint default 0) returns json
language plpgsql security definer set search_path = public as $$
declare
  em text := public.hi8_email(p_key);
  c  public.crews;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if not exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) and lower(c.host_email) <> em then
    raise exception 'not_in_crew' using errcode = '42501', hint = 'Join the crew to see its chat.';
  end if;
  return (select coalesce(json_agg(json_build_object(
      'id', x.id, 'kind', x.kind, 'body', x.body, 'at', x.created_at,
      'name', case when x.email is null then null else public.hi8_name(x.email, c.city) end,
      'mine', x.email is not null and lower(x.email) = em) order by x.id), '[]'::json)
    from (select * from public.crew_messages where crew_id = c.id and id > coalesce(p_after, 0) order by id desc limit 200) x);
end $$;

-- hi8_send: post in a crew's chat
create or replace function public.hi8_send(p_key uuid, p_code text, p_body text) returns json
language plpgsql security definer set search_path = public as $$
declare
  em text := public.hi8_email(p_key);
  c  public.crews;
  b  text := left(regexp_replace(trim(coalesce(p_body, '')), '[\x01-\x09\x0b-\x1f\x7f]', '', 'g'), 500);
begin
  perform public.hi8_limit('chat', p_key::text, 30, interval '5 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if not exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) then
    raise exception 'not_in_crew' using errcode = '42501';
  end if;
  if char_length(b) = 0 then raise exception 'empty' using errcode = '22023'; end if;
  insert into public.crew_messages (crew_id, email, kind, body) values (c.id, em, 'msg', b);
  return public.hi8_messages(p_key, p_code, (select coalesce(max(id), 0) from public.crew_messages where crew_id = c.id) - 1);
end $$;

-- hi8_me: everything about this rider, for the Me and Home screens
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
    'cities', (select coalesce(json_agg(json_build_object('city', s.city, 'name', ci.name, 'status', ci.status, 'plate', s.plate,
                 'captain', s.captain, 'captain_approved', s.captain_approved) order by s.created_at), '[]'::json)
               from public.signups s join public.cities ci on ci.slug = s.city where lower(s.email) = em),
    'rsvp', (select json_build_object('event', r.event, 'session', r.session, 'hub', r.hub, 'photo', r.photo_ok)
             from public.night_rsvps r where lower(r.email) = em order by r.created_at desc limit 1),
    'crews', (select coalesce(json_agg(public.hi8_crew_card(c) || jsonb_build_object('host_is_me', lower(c.host_email) = em) order by c.day desc, c.start_time desc), '[]'::json)
              from public.crews c join public.crew_members m on m.crew_id = c.id and lower(m.email) = em
              where c.day >= public.hi8_today(c.city) - 365));
end $$;

-- hi8_city_request: "Other city" on the city page
create or replace function public.hi8_city_request(p_key uuid, p_city text, p_country text default null, p_captain boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  if char_length(trim(coalesce(p_city, ''))) < 2 then raise exception 'bad_city' using errcode = '22023'; end if;
  insert into public.city_requests (email, city, country, captain)
  values (em, left(trim(p_city), 60), nullif(left(trim(coalesce(p_country, '')), 60), ''), coalesce(p_captain, false))
  on conflict (lower(email), lower(city)) do update set captain = excluded.captain or city_requests.captain, country = coalesce(excluded.country, city_requests.country);
  return json_build_object('ok', true, 'asking', (select count(*) from public.city_requests where lower(city) = lower(trim(p_city))));
end $$;

-- hi8_counts (from 0002), now with riders per sport and the crews coming up
create or replace function public.hi8_city_counts(p_city text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'riders',        (select count(*) from public.signups s where s.city = c.slug),
    'captains',      (select count(*) from public.signups s where s.city = c.slug and s.captain),
    'captains_ok',   (select count(*) from public.signups s where s.city = c.slug and s.captain_approved),
    'riders_goal',   c.riders_goal,
    'captains_goal', c.captains_goal,
    'plates_left',   greatest(0, c.plates - (select count(*) from public.signups s where s.city = c.slug and s.plate is not null)),
    'next_plate',    (select case when coalesce(max(s.plate), 0) < c.plates then coalesce(max(s.plate), 0) + 1 end
                      from public.signups s where s.city = c.slug),
    'sports',        (select coalesce(jsonb_object_agg(x.sp, x.n), '{}'::jsonb)
                      from (select unnest(s.sports) sp, count(*) n from public.signups s where s.city = c.slug group by 1) x),
    'crews',         (select count(*) from public.crews k where k.city = c.slug and k.status = 'on'
                      and k.day between public.hi8_today(c.slug) and public.hi8_today(c.slug) + 6),
    'going_today',   (select count(*) from public.crew_members m join public.crews k on k.id = m.crew_id
                      where k.city = c.slug and k.status = 'on' and k.day = public.hi8_today(c.slug)),
    'status',        c.status,
    'name',          c.name)
  from public.cities c where c.slug = p_city;
$$;

-- approve_captain: run it yourself in the SQL editor (or tick captain_approved in Table Editor)
drop function if exists public.approve_captain(text, text, boolean);  -- 0004 changes its defaults
create or replace function public.approve_captain(p_email text, p_city text, p_ok boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.signups set captain_approved = coalesce(p_ok, true), captain = captain or coalesce(p_ok, true)
  where lower(email) = lower(trim(p_email)) and city = lower(trim(p_city));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_on_that_list' using errcode = 'P0002', hint = 'They need to sign up in that city first.'; end if;
  return json_build_object('ok', true, 'email', lower(trim(p_email)), 'city', lower(trim(p_city)), 'captain_approved', coalesce(p_ok, true));
end $$;

-- erase_email (from 0002), now also crews, memberships, messages and city requests
create or replace function public.erase_email(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; em text := lower(trim(p_email));
begin
  update public.crews set status = 'off', off_reason = 'The captain left Hi8ctane', host_email = 'erased' where lower(host_email) = em;
  delete from public.crew_members where lower(email) = em; get diagnostics e = row_count;
  update public.crew_messages set email = null, kind = 'edit', body = '(message removed)' where lower(email) = em;
  delete from public.city_requests where lower(email) = em; get diagnostics f = row_count;
  delete from public.signups where lower(email) = em; get diagnostics a = row_count;
  delete from public.night_rsvps where lower(email) = em; get diagnostics b = row_count;
  delete from public.rider_keys where lower(email) = em; get diagnostics c = row_count;
  delete from public.partner_leads where lower(contact) = em; get diagnostics d = row_count;
  return json_build_object('signups_deleted', a, 'rsvps_deleted', b, 'keys_deleted', c, 'partner_leads_deleted', d, 'crew_memberships_deleted', e, 'city_requests_deleted', f);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Who may call what
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.hi8_name(text, text) from public, anon, authenticated;
revoke execute on function public.hi8_plate(text, text) from public, anon, authenticated;
revoke execute on function public.hi8_today(text) from public, anon, authenticated;
revoke execute on function public.hi8_crew_past(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_crew_card(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_city_counts(text) from public, anon, authenticated;
revoke execute on function public.approve_captain(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.erase_email(text) from public, anon, authenticated;
revoke execute on function public.hi8_places() from public;
revoke execute on function public.hi8_crews(text) from public;
revoke execute on function public.hi8_crew(text, uuid) from public;
revoke execute on function public.hi8_start_crew(uuid, text, text, date, text, text, text, int, text, text, text, text, text, text, int) from public;
revoke execute on function public.hi8_join_crew(uuid, text, text, text, int, uuid) from public;
revoke execute on function public.hi8_leave_crew(uuid, text, text) from public;
revoke execute on function public.hi8_messages(uuid, text, bigint) from public;
revoke execute on function public.hi8_send(uuid, text, text) from public;
revoke execute on function public.hi8_me(uuid) from public;
revoke execute on function public.hi8_city_request(uuid, text, text, boolean) from public;

grant execute on function public.hi8_places() to anon, authenticated;
grant execute on function public.hi8_crews(text) to anon, authenticated;
grant execute on function public.hi8_crew(text, uuid) to anon, authenticated;
grant execute on function public.hi8_start_crew(uuid, text, text, date, text, text, text, int, text, text, text, text, text, text, int) to anon, authenticated;
grant execute on function public.hi8_join_crew(uuid, text, text, text, int, uuid) to anon, authenticated;
grant execute on function public.hi8_leave_crew(uuid, text, text) to anon, authenticated;
grant execute on function public.hi8_messages(uuid, text, bigint) to anon, authenticated;
grant execute on function public.hi8_send(uuid, text, text) to anon, authenticated;
grant execute on function public.hi8_me(uuid) to anon, authenticated;
grant execute on function public.hi8_city_request(uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.approve_captain(text, text, boolean) to service_role;
grant execute on function public.erase_email(text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Handy queries for the SQL editor
-- ---------------------------------------------------------------------------------------------
-- select public.approve_captain('you@example.com', 'amsterdam');          -- make someone a captain
-- select city, email, first_name, captain, captain_approved from public.signups where captain order by city;
-- select code, city, sport, spot, day, start_time, status from public.crews order by day desc;
-- select city, count(*) from public.city_requests group by city order by 2 desc;   -- "Other city" asks
