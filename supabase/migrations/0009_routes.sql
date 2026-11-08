-- Hi8ctane 0009: smart pick-ups (2.11).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0008. Safe to run again.
--
-- Each rider in a crew can say roughly where they start (to about 1 km: a neighbourhood, never an address).
-- From that, Hi8ctane:
--   * puts a rider who needs a seat in the car that goes least out of its way for them (hi8_set_from),
--   * picks, for every rider, the pick-up point (station or town start) that's best for both: a short trip
--     for the rider, a small detour for the driver,
--   * orders the stops along the way, with times, and a Google Maps route through them (hi8_car_plan).
-- Only pick-up names and times are shown. Nobody sees where anyone else starts.

alter table public.crew_members add column if not exists from_lat double precision;
alter table public.crew_members add column if not exists from_lon double precision;

-- driving minutes for a distance as the crow flies (the same rule as the app: roads 25% longer, town then road)
create or replace function public.hi8_drive_min(p_km double precision) returns int
language sql immutable as $$
  select greatest(5, round(10 + least(p_km * 1.25, 20) / 55 * 60 + greatest(0, p_km * 1.25 - 20) / 100 * 60))::int;
$$;

-- where a member sets off from: their own start, else the crew's pick-up, else the spot
create or replace function public.hi8_member_point(m public.crew_members, c public.crews, out lat double precision, out lon double precision)
language plpgsql stable security definer set search_path = public as $$
begin
  if m.from_lat is not null then lat := m.from_lat; lon := m.from_lon; return; end if;
  select h.lat, h.lon into lat, lon from public.hubs h where h.city = c.city and h.slug = c.meet_hub;
  if lat is null then select s.lat, s.lon into lat, lon from public.spots s where s.slug = c.spot; end if;
end $$;

-- how far out of the driver's way a stop at (h) is, in km: driver -> h -> spot, minus driver -> spot
create or replace function public.hi8_detour(d_lat double precision, d_lon double precision, h_lat double precision, h_lon double precision, s_lat double precision, s_lon double precision) returns double precision
language sql immutable as $$
  select public.hi8_km(d_lat, d_lon, h_lat, h_lon) + public.hi8_km(h_lat, h_lon, s_lat, s_lon) - public.hi8_km(d_lat, d_lon, s_lat, s_lon);
$$;

-- hi8_set_from: "I start from around here". A rider who needs a seat (and hasn't paid it yet) moves to the car
-- that goes least out of its way for them, if that's another car with room.
create or replace function public.hi8_set_from(p_key uuid, p_code text, p_lat double precision, p_lon double precision) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; m public.crew_members; sp public.spots; best uuid; bestc double precision := 1e9; d record; dp record; cost double precision;
begin
  select * into c from public.crews where code = upper(p_code);
  if c.id is null then raise exception 'no_crew' using errcode = '22023'; end if;
  select * into m from public.crew_members where crew_id = c.id and lower(email) = em;
  if m.member_id is null then raise exception 'not_in_crew' using errcode = '22023'; end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then raise exception 'bad_place' using errcode = '22023'; end if;
  select * into sp from public.spots where slug = c.spot;
  if public.hi8_km(p_lat, p_lon, sp.lat, sp.lon) > 200 then raise exception 'too_far' using errcode = '22023', hint = 'That''s too far from the spot.'; end if;
  update public.crew_members set from_lat = round(p_lat::numeric, 2), from_lon = round(p_lon::numeric, 2) where member_id = m.member_id returning * into m;
  if m.getting = 'seat' and m.paid_at is null then
    for d in select x.*, x.seats - (select count(*) from public.crew_members y where y.crew_id = c.id and y.car_with = x.member_id and y.member_id <> m.member_id) as room
             from public.crew_members x where x.crew_id = c.id and x.getting = 'drive' loop
      if d.room <= 0 then continue; end if;
      select * into dp from public.hi8_member_point((select x from public.crew_members x where x.member_id = d.member_id), c);
      -- the rider's trip to the nearest pick-up is the same for every car: what differs is the driver's detour
      -- plus a little for how far the driver starts from the rider: when two cars pass by alike, the nearer one wins
      cost := public.hi8_detour(dp.lat, dp.lon, m.from_lat, m.from_lon, sp.lat, sp.lon) + 0.3 * public.hi8_km(dp.lat, dp.lon, m.from_lat, m.from_lon)
              - case when d.member_id = m.car_with then 0.5 else 0 end;
      if cost < bestc then bestc := cost; best := d.member_id; end if;
    end loop;
    if best is not null and best is distinct from m.car_with then
      update public.crew_members set car_with = best where member_id = m.member_id;
    end if;
  end if;
  return public.hi8_car_plan(c.code, p_key);
end $$;

-- hi8_car_plan: for each car in the crew, where it stops, in order, at what time, and the km it saves
create or replace function public.hi8_car_plan(p_code text, p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  em text := public.hi8_email(p_key); c public.crews; sp public.spots; d public.crew_members; r public.crew_members;
  dp record; rp record; h record; besth record; bestc double precision; cost double precision;
  cars jsonb := '[]'::jsonb; stops jsonb; legs double precision; solo double precision; t int; arrive int; prev_lat double precision; prev_lon double precision;
  st jsonb; i int; wp text; total_saved double precision := 0; shift int;
begin
  select * into c from public.crews where code = upper(p_code);
  if c.id is null then raise exception 'no_crew' using errcode = '22023'; end if;
  if not exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) then raise exception 'not_in_crew' using errcode = '22023'; end if;
  select * into sp from public.spots where slug = c.spot;
  arrive := extract(hour from c.start_time)::int * 60 + extract(minute from c.start_time)::int - 10;
  for d in select * from public.crew_members where crew_id = c.id and getting = 'drive' order by joined_at loop
    select * into dp from public.hi8_member_point(d, c);
    stops := '[]'::jsonb;
    solo := public.hi8_km(dp.lat, dp.lon, sp.lat, sp.lon);
    for r in select * from public.crew_members where crew_id = c.id and car_with = d.member_id order by joined_at loop
      select * into rp from public.hi8_member_point(r, c);
      solo := solo + public.hi8_km(rp.lat, rp.lon, sp.lat, sp.lon);
      -- the best pick-up for this rider: their trip there counts 1.5x the driver's detour
      bestc := 1e9;
      for h in select hb.slug, hb.name, hb.lat, hb.lon from public.hubs hb where hb.city = c.city
               and (hb.kind = 'hub' or hb.slug = c.meet_hub or exists (select 1 from public.crews z where z.city = hb.city and z.meet_hub = hb.slug)) loop
        cost := 1.5 * public.hi8_km(rp.lat, rp.lon, h.lat, h.lon) + public.hi8_detour(dp.lat, dp.lon, h.lat, h.lon, sp.lat, sp.lon);
        if cost < bestc then bestc := cost; besth := h; end if;
      end loop;
      if besth.slug is null then continue; end if;
      if exists (select 1 from jsonb_array_elements(stops) e where e->>'slug' = besth.slug) then
        stops := (select jsonb_agg(case when e->>'slug' = besth.slug then jsonb_set(e, '{riders}', (e->'riders') || to_jsonb(public.hi8_name(r.email, c.city))) else e end) from jsonb_array_elements(stops) e);
      else
        stops := stops || jsonb_build_array(jsonb_build_object('slug', besth.slug, 'name', besth.name, 'lat', besth.lat, 'lon', besth.lon,
          'riders', jsonb_build_array(public.hi8_name(r.email, c.city)), 'from_driver', public.hi8_km(dp.lat, dp.lon, besth.lat, besth.lon)));
      end if;
    end loop;
    -- stops in the order the driver reaches them (nearest first), then times worked back from arriving 10 min early
    stops := coalesce((select jsonb_agg(e order by (e->>'from_driver')::double precision) from jsonb_array_elements(stops) e), '[]'::jsonb);
    legs := 0; prev_lat := dp.lat; prev_lon := dp.lon;
    for i in 0 .. jsonb_array_length(stops) - 1 loop
      legs := legs + public.hi8_km(prev_lat, prev_lon, (stops->i->>'lat')::double precision, (stops->i->>'lon')::double precision);
      prev_lat := (stops->i->>'lat')::double precision; prev_lon := (stops->i->>'lon')::double precision;
    end loop;
    legs := legs + public.hi8_km(prev_lat, prev_lon, sp.lat, sp.lon);
    t := arrive; prev_lat := sp.lat; prev_lon := sp.lon;
    for i in reverse jsonb_array_length(stops) - 1 .. 0 loop
      t := t - public.hi8_drive_min(public.hi8_km((stops->i->>'lat')::double precision, (stops->i->>'lon')::double precision, prev_lat, prev_lon)) - 5;
      stops := jsonb_set(stops, array[i::text, 'm'], to_jsonb(t));
      prev_lat := (stops->i->>'lat')::double precision; prev_lon := (stops->i->>'lon')::double precision;
    end loop;
    -- the captain's meeting time at the crew's pick-up wins: the other stops move with it
    shift := coalesce((select extract(hour from c.meet_time)::int * 60 + extract(minute from c.meet_time)::int - (e->>'m')::int
                       from jsonb_array_elements(stops) e where e->>'slug' = c.meet_hub and c.meet_time is not null limit 1), 0);
    stops := coalesce((select jsonb_agg(jsonb_set(e, '{at}', to_jsonb(lpad((greatest((e->>'m')::int + shift, 300) / 60)::text, 2, '0') || ':' || lpad((greatest((e->>'m')::int + shift, 300) % 60)::text, 2, '0'))) - 'm' order by n)
                       from jsonb_array_elements(stops) with ordinality as x(e, n)), '[]'::jsonb);
    wp := (select string_agg(round((e->>'lat')::numeric, 4) || ',' || round((e->>'lon')::numeric, 4), '|' order by n) from jsonb_array_elements(stops) with ordinality as x(e, n));
    total_saved := total_saved + greatest(0, (solo - legs) * 1.3 * 2);
    cars := cars || jsonb_build_array(jsonb_build_object(
      'driver', public.hi8_name(d.email, c.city), 'driver_id', d.member_id, 'me_driving', lower(d.email) = em,
      'stops', (select coalesce(jsonb_agg(e - 'lat' - 'lon' - 'from_driver' - 'slug' || jsonb_build_object('slug', e->>'slug')), '[]'::jsonb) from jsonb_array_elements(stops) e),
      'route_km', round((legs * 1.3)::numeric, 0), 'saved_km', round(greatest(0, (solo - legs) * 1.3 * 2)::numeric, 0),
      'maps', 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' || round(sp.lat::numeric, 4) || ',' || round(sp.lon::numeric, 4) || coalesce('&waypoints=' || replace(wp, '|', '%7C'), '')));
  end loop;
  return json_build_object('cars', cars, 'saved_km', round(total_saved::numeric, 0),
    'needs_seat', (select count(*) from public.crew_members where crew_id = c.id and getting = 'seat' and car_with is null));
end $$;

revoke execute on function public.hi8_drive_min(double precision) from public, anon, authenticated;
revoke execute on function public.hi8_member_point(public.crew_members, public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_detour(double precision, double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.hi8_set_from(uuid, text, double precision, double precision) from public;
revoke execute on function public.hi8_car_plan(text, uuid) from public;
grant execute on function public.hi8_set_from(uuid, text, double precision, double precision) to anon, authenticated;
grant execute on function public.hi8_car_plan(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
