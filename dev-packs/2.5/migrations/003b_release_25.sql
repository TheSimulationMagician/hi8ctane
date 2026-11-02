-- Hi8ctane 2.5 · migration part 2 of 2 (run after 003a_sports_cities.sql).
-- Six sports (MX tracks with opening days), two cities, the ride split on this week's fuel price by car class,
-- crew vibes, car tapes, kudos, the passport and the Hi8 Pass. Rules in plain words: CHANGES.md and RIDES.md.

-- ── Spots: city and opening days ─────────────────────────────────────────────────────────────
alter table spots
  add column city text not null default 'ams' check (city in ('ams','bcn')),
  add column open_days int[] check (open_days <@ array[1,2,3,4,5,6,7]),   -- ISO weekdays it is open; null = always (beaches, trails)
  add column open_note text check (char_length(open_note) <= 60);

-- ── The split: this week's fuel price × the car's class ──────────────────────────────────────
create type car_class as enum ('small','medium','van','van_trailer','ev');
create table fuel_prices (
  week_start date primary key check (extract(isodow from week_start) = 1),          -- Mondays
  euro95_eur_l numeric(5,3) not null check (euro95_eur_l between 1 and 4),
  kwh_eur numeric(5,3) not null default 0.35 check (kwh_eur between 0.05 and 1.5),  -- home charging
  source text not null default 'EU Weekly Oil Bulletin (NL, Euro-super 95, incl. taxes)',
  created_at timestamptz not null default now()
);
-- litres (kWh for electric) per 100 km
create function car_use_per_100km(p car_class) returns numeric language sql immutable as $$
  select case p when 'small' then 5.5 when 'medium' then 6.5 when 'van' then 8.5 when 'van_trailer' then 10.5 else 17 end $$;
-- € per km for a class on a day: the latest weekly price published on or before that day (else the newest one).
-- null while fuel_prices is empty: cars then keep the rate they were offered with (2.4 behaviour).
create function rate_per_km(p car_class, p_day date default current_date) returns numeric language sql stable as $$
  select round(car_use_per_100km(p) / 100 * case when p = 'ev' then f.kwh_eur else f.euro95_eur_l end, 5)
  from fuel_prices f order by (f.week_start <= p_day) desc, f.week_start desc limit 1 $$;

alter table profiles add column car_class car_class;          -- set in onboarding ("your car"); null = doesn't drive

drop view car_seats;                                          -- recreated below (it reads fuel_eur_per_km)
alter table cars drop constraint cars_fuel_eur_per_km_check;
alter table cars alter column fuel_eur_per_km type numeric(7,5);
alter table cars
  add constraint cars_fuel_eur_per_km_check check (fuel_eur_per_km between 0 and 0.4),
  add column car_class car_class not null default 'medium',
  add column tape text check (tape in ('tunes','sing','quiet','podcast')),
  add column tape_label text check (char_length(tape_label) <= 24);

-- The rate follows the class and the week's price until the shares are frozen at the cut-off, then stays.
create function planb.cars_set_rate() returns trigger language plpgsql as $$
declare d date;
begin
  if tg_op = 'UPDATE' and old.shares_frozen_at is not null then
    new.fuel_eur_per_km := old.fuel_eur_per_km; new.car_class := old.car_class; return new;
  end if;
  if tg_op = 'INSERT' then
    new.car_class := coalesce((select car_class from profiles where id = new.driver_id), new.car_class);
  end if;
  select (starts_at at time zone 'Europe/Amsterdam')::date into d from crews where id = new.crew_id;
  new.fuel_eur_per_km := coalesce(rate_per_km(new.car_class, coalesce(d, current_date)), new.fuel_eur_per_km);
  return new;
end $$;
create trigger cars_rate before insert or update on cars for each row execute function planb.cars_set_rate();

create view car_seats with (security_invoker = true) as
  select c.id as car_id, c.crew_id, c.driver_id, c.leaves_at, c.pickup_point, c.seats, c.board_slots, c.max_wait_min, c.status,
         planb.free_seats(c.id) as free_seats,
         round(c.round_trip_km * c.fuel_eur_per_km + c.parking_eur, 2) as trip_cost_eur,
         (select max(s.share_eur) from split_shares(c.id) s where not s.is_driver) as each_eur,
         c.car_class, c.fuel_eur_per_km, c.tape, c.tape_label
  from cars c;
revoke all on car_seats from anon;

-- Drivers set their car's class and tape (before the cut-off freeze).
create function set_car(p_car uuid, p_class car_class default null, p_tape text default null, p_tape_label text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare c cars;
begin
  select * into c from cars where id = p_car;
  if not found or c.driver_id is distinct from auth.uid() then raise exception 'not_your_car'; end if;
  update cars set car_class = coalesce(p_class, car_class), tape = coalesce(p_tape, tape), tape_label = coalesce(p_tape_label, tape_label)
  where id = p_car returning fuel_eur_per_km into c.fuel_eur_per_km;
  return c.fuel_eur_per_km;
end $$;

-- ── Crews: vibes (up to 2) ───────────────────────────────────────────────────────────────────
alter table crews add column vibes text[] not null default '{}'
  check (vibes <@ array['chill','send','rookie','coffee','sunset','tunes'] and cardinality(vibes) <= 2);
grant update (vibes) on crews to authenticated;

-- ── Kudos instead of ratings ─────────────────────────────────────────────────────────────────
create type kudo_kind as enum ('safe_driver','good_tunes','great_tips','always_on_time','good_vibes');
create table kudos (
  crew_id uuid not null references crews on delete cascade,
  from_id uuid not null references profiles on delete cascade,
  to_id uuid not null references profiles on delete cascade,
  kind kudo_kind not null,
  created_at timestamptz not null default now(),
  primary key (crew_id, from_id, to_id),
  check (from_id <> to_id)
);
create index on kudos (to_id);
create view kudo_counts with (security_invoker = true) as
  select to_id as profile_id, kind, count(*)::int as n from kudos group by 1, 2;

-- One kudo per pair per session, only between riders who were there (checked in), once it has started.
create function give_kudo(p_crew uuid, p_to uuid, p_kind kudo_kind) returns void
language plpgsql security definer set search_path = public as $$
declare v crews;
begin
  if auth.uid() is null then raise exception 'sign_in_needed'; end if;
  if p_to = auth.uid() then raise exception 'not_yourself'; end if;
  select * into v from crews where id = p_crew;
  if not found or planb.now() < v.starts_at then raise exception 'not_yet'; end if;
  if (select count(*) from crew_members where crew_id = p_crew and profile_id in (auth.uid(), p_to)
        and (booking in ('here','done') and checked_in_at is not null)) < 2 then raise exception 'not_in_this_session'; end if;
  insert into kudos (crew_id, from_id, to_id, kind) values (p_crew, auth.uid(), p_to, p_kind)
  on conflict (crew_id, from_id, to_id) do update set kind = excluded.kind, created_at = now();
end $$;

-- ── The passport: one stamp per spot you checked in at ───────────────────────────────────────
create view passport with (security_invoker = true) as
  select m.profile_id, c.spot_id, s.slug, s.name as spot, s.city, c.sport,
         min(c.starts_at) as first_at, count(*)::int as sessions
  from crew_members m join crews c on c.id = m.crew_id join spots s on s.id = c.spot_id
  where m.checked_in_at is not null and m.booking in ('here','done')
  group by 1, 2, 3, 4, 5, 6;

-- ── The Hi8 Pass (€39 a year; rides stay free with no cut) ───────────────────────────────────
create table pass_members (
  profile_id uuid primary key references profiles on delete cascade,
  city text not null check (city in ('ams','bcn')),
  founding boolean not null default false,               -- first 100 per city
  price_eur numeric(5,2) not null default 39 check (price_eur between 0 and 200),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null default now() + interval '1 year',
  refunded_at timestamptz,                               -- money back: fewer than 3 crews in the first 60 days
  payment_ref text unique
);
create function founding_passes_left(p_city text) returns int language sql stable security definer set search_path = public as $$
  select greatest(0, 100 - (select count(*) from pass_members where city = p_city and founding and refunded_at is null))::int $$;
create view pass_refund_due as                            -- admin / service role only
  select p.profile_id, p.started_at,
         (select count(*) from crew_members m join crews c on c.id = m.crew_id
          where m.profile_id = p.profile_id and m.checked_in_at is not null
            and c.starts_at between p.started_at and p.started_at + interval '60 days')::int as crews_60d
  from pass_members p
  where p.refunded_at is null and planb.now() >= p.started_at + interval '60 days';

create or replace function planb.suggest_call(p_crew uuid, out call text, out reason text) language plpgsql stable as $$
declare v crews; s spots; n int; usable int; w numeric; rain24 numeric; rain_now numeric; local_t text;
begin
  select * into v from crews where id = p_crew;
  select * into s from spots where id = v.spot_id;
  local_t := to_char(v.starts_at at time zone 'Europe/Amsterdam', 'HH24:MI');
  if v.sport = 'mtb' then
    select sum(rain_mm), count(*) into rain24, n from forecast_hours
    where spot_id = v.spot_id and valid_at > v.starts_at - interval '24 hours' and valid_at <= v.starts_at + interval '2 hours';
    if n = 0 then call := null; reason := 'no forecast'; return; end if;
    if coalesce(rain24, 0) <= 5 then call := 'go'; reason := 'Dry trails: ' || coalesce(rain24, 0) || ' mm in 24 h';
    else call := 'off'; reason := 'Muddy: ' || rain24 || ' mm of rain in 24 h'; end if;
    return;
  end if;
  if v.sport = 'mx' then
    -- tracks: closed days first, then rain. Rain in the 24 h before makes the track tacky (best grip);
    -- 3 mm or more during the session turns it to mud.
    if s.open_days is not null
       and not (extract(isodow from v.starts_at at time zone 'Europe/Amsterdam')::int = any (s.open_days)) then
      call := 'off'; reason := 'Track closed that day' || coalesce(' (' || s.open_note || ')', ''); return;
    end if;
    select sum(rain_mm) filter (where valid_at < v.starts_at), sum(rain_mm) filter (where valid_at >= v.starts_at), count(*)
    into rain24, rain_now, n from forecast_hours
    where spot_id = v.spot_id and valid_at > v.starts_at - interval '24 hours' and valid_at < v.starts_at + interval '3 hours';
    if n = 0 then call := null; reason := 'no forecast'; return; end if;
    if coalesce(rain_now, 0) >= 3 then call := 'off'; reason := 'Mud: ' || rain_now || ' mm during the session';
    elsif coalesce(rain24, 0) between 0.5 and 10 then call := 'go'; reason := 'Tacky track: ' || rain24 || ' mm yesterday, dried in';
    else call := 'go'; reason := 'Dry track at ' || local_t; end if;
    return;
  end if;
  select count(*),
         count(*) filter (where case v.sport
            when 'kite' then f.wind_kts between 15 and 30 and coalesce(f.gust_kts, f.wind_kts) < f.wind_kts + 10
                             and (s.good_dir_from is null or f.dir_deg between s.good_dir_from and s.good_dir_to)
            when 'wing' then f.wind_kts between 14 and 25 and coalesce(f.gust_kts, f.wind_kts) < f.wind_kts + 10
                             and (s.good_dir_from is null or f.dir_deg between s.good_dir_from and s.good_dir_to)
            when 'surf' then coalesce(f.wave_m, 0) >= 1.0 and f.wind_kts <= 14
            when 'sup'  then f.wind_kts <= 8
            else false end),
         round(avg(f.wind_kts))
  into n, usable, w
  from forecast_hours f
  where f.spot_id = v.spot_id and f.valid_at >= v.starts_at and f.valid_at < v.starts_at + interval '3 hours'
    and f.model = (select model from forecast_hours where spot_id = v.spot_id order by fetched_at desc limit 1);
  if n = 0 then call := null; reason := 'no forecast'; return; end if;
  if usable >= 2 then call := 'go'; reason := w || ' kt at ' || local_t;
  else call := 'off'; reason := case v.sport when 'kite' then w || ' kt at ' || local_t || ': kites need 15-30'
                                             when 'wing' then w || ' kt at ' || local_t || ': wings need 14-25'
                                             when 'surf' then 'Too small or blown out at ' || local_t
                                             else w || ' kt at ' || local_t || ': too windy for SUP' end;
  end if;
end $$;

create or replace function start_crew(p_sport sport, p_spot int, p_starts_at timestamptz, p_ride ride_kind default 'meet',
                           p_level skill default 'getting_there', p_notes text default null,
                           p_cancel_hours int default 2, p_max_wait_min int default 10,
                           p_waitlist_on boolean default true, p_merge_if_alone boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_needed'; end if;
  if p_starts_at <= planb.now() then raise exception 'in_the_past'; end if;
  if not exists (select 1 from spots where id = p_spot and p_sport = any (sports)) then raise exception 'sport_not_at_spot'; end if;
  if exists (select 1 from spots where id = p_spot and open_days is not null
             and not (extract(isodow from p_starts_at at time zone 'Europe/Amsterdam')::int = any (open_days))) then
    raise exception 'track_closed';
  end if;
  insert into crews (host_id, sport, spot_id, starts_at, level, notes, cancel_hours, max_wait_min, waitlist_on, merge_if_alone, created_at)
  values (auth.uid(), p_sport, p_spot, p_starts_at, p_level, p_notes, p_cancel_hours, p_max_wait_min, p_waitlist_on, p_merge_if_alone, planb.now())
  returning id into v_id;
  insert into crew_members (crew_id, profile_id, ride, joined_at) values (v_id, auth.uid(), p_ride, planb.now());
  return v_id;
end $$;

-- ── Security ─────────────────────────────────────────────────────────────────────────────────
alter table fuel_prices enable row level security;
alter table kudos enable row level security;
alter table pass_members enable row level security;
create policy "read fuel prices" on fuel_prices for select using (true);
create policy "read kudos" on kudos for select to authenticated using (true);
create policy "own pass" on pass_members for select using (auth.uid() = profile_id);
revoke insert, update, delete on fuel_prices, kudos, pass_members from anon, authenticated;   -- prices: weekly job; pass: payment webhook
revoke all on kudos, kudo_counts, passport, pass_members, pass_refund_due from anon;
revoke all on pass_refund_due from authenticated;
revoke execute on function set_car(uuid, car_class, text, text), give_kudo(uuid, uuid, kudo_kind) from anon;
revoke execute on function planb.cars_set_rate() from public;
