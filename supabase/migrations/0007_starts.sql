-- Hi8ctane 0007: crews start where riders live (2.9.1).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0006. Safe to run again.
--
-- No more cities opening at 25 riders. A region (the Netherlands, Catalonia) has its spots; the starting
-- points are wherever riders live. The first rider who starts a crew from Haarlem, Utrecht or Badalona
-- adds that place (hi8_add_start), and from then on it's on the list for everyone near it. Places nobody
-- has started a crew from stay hidden.
--
-- Also: the MX day at Martorelles is €180 all in (bike, gear, track, insurance and fuel).

-- ---------------------------------------------------------------------------------------------
-- 1. Regions and starting points
-- ---------------------------------------------------------------------------------------------
alter table public.cities add column if not exists region text check (region is null or char_length(region) <= 40);
update public.cities set region = 'Netherlands' where slug = 'amsterdam' and region is null;
update public.cities set region = 'Catalonia'   where slug = 'barcelona' and region is null;

alter table public.hubs add column if not exists kind text not null default 'hub' check (kind in ('hub', 'town'));
alter table public.hubs add column if not exists created_at timestamptz not null default now();

create or replace function public.hi8_km(a_lat double precision, a_lon double precision, b_lat double precision, b_lon double precision) returns double precision
language sql immutable as $$
  select 2 * 6371 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lon - a_lon) / 2), 2)));
$$;

-- hi8_add_start: a place a crew leaves from (a station, a town square). Within 1.5 km of one that's already
-- there, that one is used. It must be within 160 km of one of the region's spots. Coordinates are kept to
-- about 100 m: it's a meeting point, never someone's address.
create or replace function public.hi8_add_start(p_city text, p_name text, p_lat double precision, p_lon double precision) returns json
language plpgsql security definer set search_path = public as $$
declare
  nm   text := upper(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
  la   double precision := round(p_lat::numeric, 3);
  lo   double precision := round(p_lon::numeric, 3);
  h    public.hubs;
  base text; sl text; n int := 1; near double precision;
begin
  perform public.hi8_limit('start_point', coalesce(public.hi8_client(), 'none'), 10, interval '1 hour');
  if not exists (select 1 from public.cities where slug = p_city and status = 'open') then
    raise exception 'unknown_city' using errcode = '22023', hint = 'That region isn''t open.';
  end if;
  if char_length(nm) < 2 or char_length(nm) > 32 or nm !~ '^[[:alnum:] ''·.,()/&-]+$' then
    raise exception 'bad_name' using errcode = '22023', hint = 'Name the place: a town or a station, up to 32 letters.';
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'bad_place' using errcode = '22023', hint = 'That place has no location.';
  end if;
  select min(public.hi8_km(la, lo, s.lat, s.lon)) into near from public.spots s where s.city = p_city and s.active;
  if near is null or near > 160 then
    raise exception 'too_far' using errcode = '22023', hint = 'That''s too far from this region''s spots.';
  end if;
  select * into h from public.hubs where city = p_city and public.hi8_km(la, lo, lat, lon) < 1.5
  order by public.hi8_km(la, lo, lat, lon) limit 1;
  if h.slug is not null then
    return json_build_object('city', h.city, 'slug', h.slug, 'name', h.name, 'sub', h.sub, 'lat', h.lat, 'lon', h.lon, 'kind', h.kind, 'existing', true);
  end if;
  base := left(trim(both '-' from regexp_replace(translate(lower(nm), 'àáâäãèéêëìíîïòóôöõùúûüçñ·''', 'aaaaaeeeeiiiiooooouuuucn--'), '[^a-z0-9]+', '-', 'g')), 17);
  if char_length(base) < 2 then base := 'start'; end if;
  sl := 't-' || base;
  while exists (select 1 from public.hubs where city = p_city and slug = sl) loop
    n := n + 1; sl := 't-' || left(base, 14) || '-' || n;
  end loop;
  insert into public.hubs (city, slug, name, sub, lat, lon, sort, kind)
  values (p_city, sl, nm, 'STARTED BY RIDERS', la, lo, 100, 'town') returning * into h;
  return json_build_object('city', h.city, 'slug', h.slug, 'name', h.name, 'sub', h.sub, 'lat', h.lat, 'lon', h.lon, 'kind', h.kind, 'existing', false);
end $$;

-- hi8_places (from 0005) + regions, and for every starting point: its kind and the crews leaving from it.
-- A place riders added shows once a crew has left (or will leave) from it.
create or replace function public.hi8_places() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'cities', (select coalesce(json_agg(json_build_object('slug', slug, 'name', name, 'country', country, 'status', status, 'tz', tz, 'region', region) order by status, slug), '[]'::json) from public.cities),
    'hubs',   (select coalesce(json_agg(json_build_object('city', h.city, 'slug', h.slug, 'name', h.name, 'sub', h.sub, 'lat', h.lat, 'lon', h.lon, 'kind', h.kind,
                 'crews', (select count(*) from public.crews c where c.city = h.city and c.meet_hub = h.slug and c.status = 'on' and c.day >= public.hi8_today(c.city)))
                 order by h.city, h.sort, h.name), '[]'::json)
               from public.hubs h
               where h.kind = 'hub' or exists (select 1 from public.crews c where c.city = h.city and c.meet_hub = h.slug and c.day >= public.hi8_today(c.city) - 120)),
    'spots',  (select coalesce(json_agg(json_build_object('slug', slug, 'city', city, 'name', name, 'lat', lat, 'lon', lon, 'sports', sports,
                 'face', face, 'good_from', good_from, 'good_to', good_to, 'lake', lake, 'note', note, 'maps', maps) order by city, sort), '[]'::json)
               from public.spots where active));
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. The MX day at Martorelles: €180 all in
-- ---------------------------------------------------------------------------------------------
update public.plans set
  title = 'MX day, all in',
  blurb = 'Never ridden a motocross bike, or yours is in pieces? A full day on the Martorelles track, 20 minutes from Barcelona, with everything sorted. Bring a mate or join others going the same day: the car costs less shared.',
  price_from = 180,
  price_note = '€180 a rider for the full day, all in: bike, gear, track, insurance and fuel.',
  includes = '{"Bike + gear","Track + insurance","Fuel"}',
  updated_at = now()
where slug = 'mx-day-martorelles';

-- ---------------------------------------------------------------------------------------------
-- 3. Who may call what
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.hi8_km(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.hi8_add_start(text, text, double precision, double precision) from public;
revoke execute on function public.hi8_places() from public;
grant execute on function public.hi8_add_start(text, text, double precision, double precision) to anon, authenticated;
grant execute on function public.hi8_places() to anon, authenticated;

-- Where crews leave from, from the SQL editor:
--   select h.city, h.name, h.kind, count(c.*) as crews from public.hubs h left join public.crews c on c.city = h.city and c.meet_hub = h.slug group by 1, 2, 3 order by 4 desc;
-- Take a starting point down: delete from public.hubs where kind = 'town' and slug = 't-…';  (only if no crew uses it)

notify pgrst, 'reload schema';
