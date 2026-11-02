-- Hi8ctane 2.4 · Supabase schema (Postgres 15+). Run once in the SQL editor of a FRESH project.
-- Already running 2.2? Don't run this file: run migrations/002_plan_b.sql instead (it is the second half of this file).
-- Guests who join from a crew link use Supabase anonymous sign-in (auth.signInAnonymously):
-- they get a real auth.uid(), a profile with is_guest = true, and later link Google/email to keep everything.
create extension if not exists "pgcrypto";

create type sport as enum ('kite','wing','surf','sup','mtb');
create type skill as enum ('new','getting_there','confident');
create type ride_kind as enum ('need','drive','meet');
create type home_base as enum ('amsterdam','haarlem_ijmuiden','alkmaar_schoorl','leiden','other');
create type crew_status as enum ('planned','on','off','done');
create type member_state as enum ('in','here','late','left');

create sequence founding_seq start 1;

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  rider_name text not null check (char_length(rider_name) between 2 and 20),
  home_base home_base not null default 'amsterdam',
  ride_pref ride_kind not null default 'need',
  founding_no int not null default nextval('founding_seq'),
  karma int not null default 0,
  is_adult boolean not null default false,  -- 18+ confirmed at sign-up
  is_guest boolean not null default true,   -- false once Google/email is linked
  created_at timestamptz not null default now()
);

-- WhatsApp number: private. Only the rider, and riders in a crew with them, can read it (via crew_contacts()).
create table contacts (
  profile_id uuid primary key references profiles on delete cascade,
  whatsapp text not null check (whatsapp ~ '^\+[0-9 ]{8,18}$')
);

create table profile_sports (
  profile_id uuid references profiles on delete cascade,
  sport sport not null,
  level skill not null default 'new',
  primary key (profile_id, sport)
);

create table spots (
  id serial primary key,
  slug text unique not null,
  name text not null,
  lat double precision not null,
  lon double precision not null,
  sports sport[] not null,
  good_dir_from int,      -- wind FROM, degrees, inclusive arc (kite/wing)
  good_dir_to int,
  meeting_point text,
  parking text
);

create table forecast_hours (
  spot_id int references spots on delete cascade,
  valid_at timestamptz not null,
  model text not null default 'knmi_seamless',
  wind_kts numeric(4,1), gust_kts numeric(4,1), dir_deg int,
  wave_m numeric(3,1), wave_period_s numeric(3,1), water_c numeric(3,1),
  rain_mm numeric(4,1), temp_c numeric(3,1),
  fetched_at timestamptz not null default now(),
  primary key (spot_id, valid_at, model)
);

create table tides (
  spot_id int references spots on delete cascade,
  at timestamptz not null,
  kind text not null check (kind in ('high','low')),
  height_m numeric(3,2),
  primary key (spot_id, at)
);

create table windows (
  id bigserial primary key,
  spot_id int references spots on delete cascade,
  sport sport not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  score numeric(4,2) not null,
  confidence text not null check (confidence in ('confident','likely','early_call')),
  computed_at timestamptz not null default now()
);
create index on windows (starts_at);

create table crews (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles on delete cascade,
  sport sport not null,
  spot_id int not null references spots,
  starts_at timestamptz not null,
  level skill not null default 'getting_there',
  rookies_ok boolean not null default false,
  status crew_status not null default 'planned',
  notes text check (char_length(notes) <= 280),
  max_riders int check (max_riders between 2 and 30),
  created_at timestamptz not null default now()
);
create index on crews (starts_at);

create table crew_members (
  crew_id uuid references crews on delete cascade,
  profile_id uuid references profiles on delete cascade,
  ride ride_kind not null,
  seats_offered int not null default 0 check (seats_offered between 0 and 8),
  pickup_town home_base,
  state member_state not null default 'in',
  joined_at timestamptz not null default now(),
  primary key (crew_id, profile_id)
);

create table messages (
  id bigserial primary key,
  crew_id uuid not null references crews on delete cascade,
  profile_id uuid references profiles on delete set null,
  body text not null check (char_length(body) <= 1000),
  kind text not null default 'text' check (kind in ('text','quick','system')),
  created_at timestamptz not null default now()
);
create index on messages (crew_id, created_at);

create table watches (
  id bigserial primary key,
  profile_id uuid not null references profiles on delete cascade,
  spot_id int not null references spots,
  sport sport not null,
  min_kts int, max_kts int,
  days text[] default '{sat,sun}',
  rookie_only boolean not null default false,
  active boolean not null default true
);

create table rider_reports (
  id bigserial primary key,
  spot_id int not null references spots,
  profile_id uuid not null references profiles on delete cascade,
  vs_forecast text check (vs_forecast in ('weaker','as_forecast','stronger')),
  crowd text check (crowd in ('quiet','ok','busy')),
  created_at timestamptz not null default now()
);

create table waitlist (
  id bigserial primary key,
  email text not null,
  feature text not null check (feature in ('market','rent_learn')),
  created_at timestamptz not null default now(),
  unique (email, feature)
);

create table push_subscriptions (
  profile_id uuid references profiles on delete cascade,
  endpoint text primary key,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

-- Seats left = seats offered by drivers minus riders who need a ride
create view crew_seats with (security_invoker = true) as
  select crew_id,
         coalesce(sum(seats_offered) filter (where ride = 'drive' and state <> 'left'), 0)
       - count(*) filter (where ride = 'need' and state <> 'left') as seats_left,
         count(*) filter (where state <> 'left') as riders
  from crew_members group by crew_id;

-- Public profile fields only (never email)
create view public_profiles with (security_invoker = true) as
  select id, rider_name, founding_no, karma, (founding_no <= 100) as founding_crew from profiles;
revoke all on crew_seats, public_profiles from anon;

-- Row-level security
alter table profiles enable row level security;
alter table profile_sports enable row level security;
alter table spots enable row level security;
alter table forecast_hours enable row level security;
alter table tides enable row level security;
alter table windows enable row level security;
alter table crews enable row level security;
alter table crew_members enable row level security;
alter table messages enable row level security;
alter table watches enable row level security;
alter table rider_reports enable row level security;
alter table waitlist enable row level security;
alter table push_subscriptions enable row level security;
alter table contacts enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "read profiles" on profiles for select to authenticated using (true);
create policy "own sports" on profile_sports for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "read sports" on profile_sports for select to authenticated using (true);

create policy "read spots" on spots for select using (true);
create policy "read forecast" on forecast_hours for select using (true);
create policy "read tides" on tides for select using (true);
create policy "read windows" on windows for select using (true);
-- forecast_hours / tides / windows / spots are written by the service role (cron), which bypasses RLS

create policy "read crews" on crews for select to authenticated using (true);
create policy "create crew" on crews for insert to authenticated with check (auth.uid() = host_id);
create policy "host edits crew" on crews for update using (auth.uid() = host_id);
create policy "host deletes crew" on crews for delete using (auth.uid() = host_id);

create policy "read members" on crew_members for select to authenticated using (true);
create policy "join crew" on crew_members for insert to authenticated with check (auth.uid() = profile_id);
create policy "update own membership" on crew_members for update using (auth.uid() = profile_id);
create policy "leave crew" on crew_members for delete using (auth.uid() = profile_id);

create policy "members read chat" on messages for select using (
  exists (select 1 from crew_members m where m.crew_id = messages.crew_id and m.profile_id = auth.uid()));
create policy "members write chat" on messages for insert with check (
  auth.uid() = profile_id and exists (select 1 from crew_members m where m.crew_id = messages.crew_id and m.profile_id = auth.uid()));

create policy "own watches" on watches for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "read reports" on rider_reports for select to authenticated using (true);
create policy "write own report" on rider_reports for insert to authenticated with check (auth.uid() = profile_id);
create policy "join waitlist" on waitlist for insert to anon, authenticated with check (true);
create policy "own push" on push_subscriptions for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

create policy "own contact" on contacts for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- Crew-mates' WhatsApp numbers, only for crews the caller is in
create function crew_contacts(p_crew uuid)
returns table (profile_id uuid, rider_name text, whatsapp text)
language sql stable security definer set search_path = public as $$
  select p.id, p.rider_name, c.whatsapp
  from crew_members m
  join profiles p on p.id = m.profile_id
  left join contacts c on c.profile_id = p.id
  where m.crew_id = p_crew and m.state <> 'left'
    and exists (select 1 from crew_members me where me.crew_id = p_crew and me.profile_id = auth.uid() and me.state <> 'left');
$$;
revoke all on function crew_contacts(uuid) from anon;

-- Realtime for chat and who's in
alter publication supabase_realtime add table messages, crew_members, crews;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 2.4 · Plan B (identical to migrations/002_plan_b.sql)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Hi8ctane 2.4 · Plan B migration. Run once, after the 2.2 schema (schema.sql already includes it for fresh projects).
-- Adds: cars with seats, the waitlist, running late, check-in, no-shows, the go/no-go call, merges,
-- the cost split with a cut-off freeze, reliability points and a notifications outbox.
-- Rules in plain words: PLAN-B.md. Every state change goes through the functions below (RPC),
-- so riders can't edit their own state, points or share from the browser.

create schema if not exists planb;              -- internal helpers, not exposed through the API
revoke all on schema planb from public;

create type booking_state as enum ('in','late','here','cancelled','waitlist','no_show','done','called_off');
create type car_status as enum ('open','cancelled','done');

-- ── Crew rules ───────────────────────────────────────────────────────────────────────────────
alter table crews
  add column cancel_hours int not null default 2 check (cancel_hours between 1 and 3),
  add column max_wait_min int not null default 10 check (max_wait_min in (5, 10, 15)),
  add column waitlist_on boolean not null default true,
  add column merge_if_alone boolean not null default true,
  add column call_at timestamptz,               -- set by trigger from starts_at
  add column cutoff_at timestamptz,             -- free cancel until this moment
  add column call text check (call in ('go','off')),
  add column called_at timestamptz,
  add column called_by uuid references profiles on delete set null,   -- null = called by the system
  add column call_reason text check (char_length(call_reason) <= 140),
  add column merged_into uuid references crews on delete set null,
  add column done_at timestamptz;

-- Clock. Production: now(). A test database can switch on a fake clock (hi8.now) to replay a day;
-- only the database owner can flip planb.settings, so clients can never move time.
create table planb.settings (test_clock boolean not null default false);
insert into planb.settings values (false);
create function planb.now() returns timestamptz language sql stable as $$
  select case when (select test_clock from planb.settings limit 1)
              then coalesce(nullif(current_setting('hi8.now', true), '')::timestamptz, now()) else now() end $$;

-- The call is 3 h before the start and free cancel ends cancel_hours before it (default 2 h).
-- Sessions that start before 10:00 (Amsterdam time) get both the evening before: call 20:00, cut-off 21:00.
create function plan_b_times(p_start timestamptz, p_cancel_hours int default 2,
                             out call_at timestamptz, out cutoff_at timestamptz)
language sql stable as $$
  select case when extract(hour from p_start at time zone 'Europe/Amsterdam') < 10
              then ((((p_start at time zone 'Europe/Amsterdam')::date - 1) + time '20:00') at time zone 'Europe/Amsterdam')
              else p_start - interval '3 hours' end,
         case when extract(hour from p_start at time zone 'Europe/Amsterdam') < 10
              then ((((p_start at time zone 'Europe/Amsterdam')::date - 1) + time '21:00') at time zone 'Europe/Amsterdam')
              else p_start - make_interval(hours => p_cancel_hours) end
$$;

create function planb.crews_set_times() returns trigger language plpgsql as $$
begin
  select t.call_at, t.cutoff_at into new.call_at, new.cutoff_at from plan_b_times(new.starts_at, new.cancel_hours) t;
  return new;
end $$;
create trigger crews_times before insert or update of starts_at, cancel_hours on crews
  for each row execute function planb.crews_set_times();
update crews set cancel_hours = cancel_hours;    -- fill call_at / cutoff_at on existing rows

-- ── Cars and seats ───────────────────────────────────────────────────────────────────────────
create table cars (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references crews on delete cascade,
  driver_id uuid not null references profiles on delete cascade,
  leaves_at timestamptz not null,
  pickup_point text not null check (char_length(pickup_point) <= 80),
  pickup_lat double precision, pickup_lon double precision,
  seats int not null check (seats between 1 and 8),             -- seats for riders, driver not counted
  board_slots int not null default 0 check (board_slots between 0 and 12),
  max_wait_min int not null default 10 check (max_wait_min in (5, 10, 15)),
  round_trip_km numeric(5,1) not null check (round_trip_km > 0 and round_trip_km <= 600),
  fuel_eur_per_km numeric(4,3) not null default 0.13 check (fuel_eur_per_km between 0 and 0.25),
  parking_eur numeric(6,2) not null default 0 check (parking_eur between 0 and 60),
  status car_status not null default 'open',
  shares_frozen_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (crew_id, driver_id)
);
create index on cars (crew_id);

-- ── Bookings: Plan B state on the crew membership ────────────────────────────────────────────
alter table crew_members
  add column car_id uuid references cars on delete set null,   -- riders: the car they sit in; drivers: their own car
  add column booking booking_state not null default 'in',      -- replaces 2.2 "state" (kept for old reads)
  add column late_min int check (late_min between 1 and 90),
  add column eta_at timestamptz,
  add column checked_in_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancel_free boolean,                 -- true = before the cut-off, or the seat was refilled
  add column waitlisted_at timestamptz,           -- waitlist order
  add column promoted_at timestamptz,
  add column no_show_at timestamptz,
  add column no_show_by uuid references profiles on delete set null,
  add column must_confirm boolean not null default false,   -- 2+ no-shows in 60 days: confirm before the call
  add column confirmed_at timestamptz,
  add column one_way boolean not null default false,        -- rides back another way: half the fuel share
  add column share_eur numeric(6,2),              -- frozen at the cut-off; what this rider owes the driver
  add column paid_at timestamptz;                 -- day one: the driver ticks "paid" (no money in the app)
create index on crew_members (crew_id, booking);
create index on crew_members (car_id);

-- Keep the 2.2 "state" column readable for old code.
create function planb.sync_state() returns trigger language plpgsql as $$
begin
  new.state := case new.booking when 'here' then 'here'::member_state when 'late' then 'late'::member_state
                                when 'in' then 'in'::member_state when 'done' then 'here'::member_state
                                else 'left'::member_state end;
  return new;
end $$;
create trigger crew_members_state before insert or update of booking on crew_members
  for each row execute function planb.sync_state();

-- ── Reliability points ───────────────────────────────────────────────────────────────────────
create table reliability_events (
  id bigserial primary key,
  profile_id uuid not null references profiles on delete cascade,
  crew_id uuid references crews on delete set null,
  kind text not null check (kind in ('showed_up','no_show','late_cancel','driver_dropped_late','drove')),
  points int not null,
  created_at timestamptz not null default now(),
  unique (profile_id, crew_id, kind)
);
create view reliability with (security_invoker = true) as
  select p.id as profile_id,
         coalesce(sum(e.points), 0)::int as points,
         count(e.id) filter (where e.kind = 'showed_up')::int as shows,
         count(e.id) filter (where e.kind = 'no_show')::int as no_shows,
         count(e.id) filter (where e.kind = 'no_show' and e.created_at > now() - interval '60 days')::int as no_shows_60d
  from profiles p left join reliability_events e on e.profile_id = p.id
  group by p.id;

-- ── Shares still owed for a seat someone left after the cut-off (cleared when the seat is refilled) ──
create table seat_debts (
  id bigserial primary key,
  crew_id uuid not null references crews on delete cascade,
  car_id uuid not null references cars on delete cascade,
  profile_id uuid not null references profiles on delete cascade,      -- who owes
  amount_eur numeric(6,2) not null check (amount_eur > 0),
  reason text not null check (reason in ('late_cancel','switched')),
  refilled_by uuid references profiles on delete set null,             -- someone took the seat: nothing owed
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index on seat_debts (car_id) where refilled_by is null;

-- ── Notifications outbox (a worker sends push / email; chat lines go straight into messages) ──
create table notifications (
  id bigserial primary key,
  profile_id uuid not null references profiles on delete cascade,
  crew_id uuid references crews on delete cascade,
  kind text not null check (kind in ('late','cancelled','promoted','seat_refilled','call_go','call_off','call_needed',
        'driver_dropped','moved_car','no_show','cutoff_soon','pickup_soon','confirm_needed','merged','pay_after','alone')),
  payload jsonb not null default '{}',
  send_after timestamptz not null default now(),
  dedupe_key text unique,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (sent_at, send_after);

-- ── Internal helpers ─────────────────────────────────────────────────────────────────────────
create function planb.active(b booking_state) returns boolean language sql immutable as
  $$ select b in ('in','late','here') $$;

create function planb.notify(p_profile uuid, p_crew uuid, p_kind text, p_payload jsonb default '{}',
                             p_after timestamptz default null, p_dedupe text default null)
returns void language sql as $$
  insert into notifications (profile_id, crew_id, kind, payload, send_after, dedupe_key)
  values (p_profile, p_crew, p_kind, coalesce(p_payload, '{}'), coalesce(p_after, planb.now()), p_dedupe)
  on conflict (dedupe_key) do nothing;
$$;

create function planb.chat(p_crew uuid, p_body text) returns void language sql as $$
  insert into messages (crew_id, profile_id, body, kind) values (p_crew, null, left(p_body, 1000), 'system');
$$;

create function planb.name(p uuid) returns text language sql stable as
  $$ select rider_name from profiles where id = p $$;

create function planb.free_seats(p_car uuid) returns int language sql stable as $$
  select c.seats - (select count(*) from crew_members m
                    where m.car_id = c.id and m.ride = 'need' and planb.active(m.booking))::int
  from cars c where c.id = p_car;
$$;

-- Split per car: fuel (round trip) by weight (one-way riders weigh 0.5) + parking equally,
-- riders rounded down to the cent, the driver covers the rounding. The total never exceeds the trip cost.
create function split_shares(p_car uuid)
returns table (profile_id uuid, is_driver boolean, share_eur numeric)
language sql stable security definer set search_path = public as $$
  with car as (select * from cars where id = p_car),
  ppl as (
    select c.driver_id as pid, true as drv, 1.0::numeric as w from car c
    union all
    select m.profile_id, false, case when m.one_way then 0.5 else 1.0 end
    from crew_members m join car c on m.car_id = c.id
    where m.ride = 'need' and planb.active(m.booking)),
  tot as (select c.round_trip_km * c.fuel_eur_per_km as fuel, c.parking_eur as parking,
                 (select sum(w) from ppl) as sw, (select count(*) from ppl) as n from car c),
  raw as (select p.pid, p.drv, floor((t.fuel * p.w / t.sw + t.parking / t.n) * 100) / 100 as amt from ppl p, tot t)
  select r.pid, r.drv,
         case when r.drv then (select round(fuel + parking, 2) from tot) - (select coalesce(sum(amt), 0) from raw where not drv)
              else r.amt end
  from raw r;
$$;

-- Freeze the split for one car (at the cut-off, or when the car leaves if that is earlier).
create function planb.freeze_car(p_car uuid) returns void language plpgsql as $$
begin
  update crew_members m set share_eur = s.share_eur
  from split_shares(p_car) s
  where m.car_id = p_car and m.profile_id = s.profile_id and not s.is_driver;
  update cars set shares_frozen_at = planb.now() where id = p_car;
end $$;

-- A rider takes a seat in a car. After the freeze: take over a late-cancel share if there is one
-- (the canceller is then off the hook), otherwise everyone's share goes down.
create function planb.seat_rider(p_crew uuid, p_profile uuid, p_car uuid) returns void language plpgsql as $$
declare v_frozen timestamptz; v_debt seat_debts;
begin
  select shares_frozen_at into v_frozen from cars where id = p_car;
  update crew_members set car_id = p_car, booking = 'in', late_min = null, eta_at = null, share_eur = null
  where crew_id = p_crew and profile_id = p_profile;
  if v_frozen is null then return; end if;
  select * into v_debt from seat_debts
  where car_id = p_car and refilled_by is null and paid_at is null and profile_id <> p_profile
  order by created_at limit 1;
  if found then
    update seat_debts set refilled_by = p_profile where id = v_debt.id;
    update crew_members set share_eur = v_debt.amount_eur where crew_id = p_crew and profile_id = p_profile;
    update crew_members set cancel_free = true
    where crew_id = v_debt.crew_id and profile_id = v_debt.profile_id and booking = 'cancelled';
  else
    update crew_members m set share_eur = case when m.share_eur is null then s.share_eur else least(m.share_eur, s.share_eur) end
    from split_shares(p_car) s
    where m.car_id = p_car and m.profile_id = s.profile_id and not s.is_driver;
  end if;
end $$;

-- First rider on the waitlist gets a free seat in this car, automatically.
create function planb.promote(p_crew uuid, p_car uuid) returns uuid language plpgsql as $$
declare v_crew crews; v_car cars; v_next crew_members;
begin
  select * into v_crew from crews where id = p_crew;
  select * into v_car from cars where id = p_car;
  if not v_crew.waitlist_on or v_car.status <> 'open' or planb.now() >= v_car.leaves_at
     or planb.free_seats(p_car) < 1 then return null; end if;
  select * into v_next from crew_members
  where crew_id = p_crew and booking = 'waitlist' and ride = 'need'
  order by waitlisted_at, joined_at limit 1;
  if not found then return null; end if;
  perform planb.seat_rider(p_crew, v_next.profile_id, p_car);
  update crew_members set promoted_at = planb.now() where crew_id = p_crew and profile_id = v_next.profile_id;
  perform planb.notify(v_next.profile_id, p_crew, 'promoted',
    jsonb_build_object('car', p_car, 'driver', planb.name(v_car.driver_id), 'leaves_at', v_car.leaves_at, 'pickup', v_car.pickup_point));
  perform planb.notify(v_car.driver_id, p_crew, 'seat_refilled', jsonb_build_object('rider', planb.name(v_next.profile_id)));
  perform planb.chat(p_crew, planb.name(v_next.profile_id) || ' takes the free seat in ' || planb.name(v_car.driver_id) || '''s car.');
  return v_next.profile_id;
end $$;

-- Places displaced riders (driver dropped out): another car with a free seat, else the front of the waitlist.
create function planb.reseat_or_wait(p_crew uuid, p_profile uuid, p_from timestamptz) returns uuid language plpgsql as $$
declare v_car uuid;
begin
  select c.id into v_car from cars c
  where c.crew_id = p_crew and c.status = 'open' and c.leaves_at > planb.now() and planb.free_seats(c.id) > 0
  order by abs(extract(epoch from c.leaves_at - p_from)) limit 1;
  if v_car is not null then
    perform planb.seat_rider(p_crew, p_profile, v_car);
    return v_car;
  end if;
  update crew_members set booking = 'waitlist', car_id = null, share_eur = null, waitlisted_at = joined_at
  where crew_id = p_crew and profile_id = p_profile;
  return null;
end $$;

create function planb.member(p_crew uuid, p_profile uuid) returns crew_members language sql stable as
  $$ select * from crew_members where crew_id = p_crew and profile_id = p_profile $$;

-- ── The call ─────────────────────────────────────────────────────────────────────────────────
-- System suggestion from the cached forecast for the first 3 hours of the session:
-- GO when at least 2 of those hours are usable for the sport (same thresholds as the forecast engine).
create function planb.suggest_call(p_crew uuid, out call text, out reason text) language plpgsql stable as $$
declare v crews; s spots; n int; usable int; w numeric; rain24 numeric; local_t text;
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

create function planb.make_call(p_crew uuid, p_call text, p_reason text, p_by uuid) returns void language plpgsql as $$
declare v crews; r record;
begin
  select * into v from crews where id = p_crew for update;
  if v.status in ('done') or v.merged_into is not null then raise exception 'crew_closed'; end if;
  if exists (select 1 from cars where crew_id = p_crew and status = 'open' and leaves_at <= planb.now()) and p_call = 'off' then
    raise exception 'cars_already_left';
  end if;
  update crews set call = p_call, called_at = planb.now(), called_by = p_by, call_reason = left(p_reason, 140),
                   status = case when p_call = 'go' then 'on'::crew_status else 'off'::crew_status end
  where id = p_crew;
  if p_call = 'off' then
    update crew_members set booking = 'called_off', share_eur = null
    where crew_id = p_crew and (planb.active(booking) or booking = 'waitlist');
    update cars set status = 'cancelled', cancelled_at = planb.now() where crew_id = p_crew and status = 'open';
    perform planb.chat(p_crew, 'Called off: ' || coalesce(p_reason, '') || '. Nobody drives, nobody pays.');
  else
    -- a host can flip an OFF back to GO before anyone leaves
    update crew_members set booking = 'in' where crew_id = p_crew and booking = 'called_off';
    update cars set status = 'open', cancelled_at = null where crew_id = p_crew and status = 'cancelled' and cancelled_at >= v.called_at;
    perform planb.chat(p_crew, 'IT''S ON: ' || coalesce(p_reason, '') || '.');
  end if;
  for r in select profile_id from crew_members where crew_id = p_crew and (planb.active(booking) or booking in ('waitlist','called_off')) loop
    perform planb.notify(r.profile_id, p_crew, case when p_call = 'go' then 'call_go' else 'call_off' end,
                         jsonb_build_object('reason', p_reason), null, 'call:' || p_crew || ':' || r.profile_id || ':' || p_call || ':' || extract(epoch from planb.now())::bigint);
  end loop;
end $$;

-- Crews that a lonely crew can merge into: same sport and day, start within 90 min, spots within 15 km.
create function merge_candidates(p_crew uuid)
returns table (crew_id uuid, spot text, starts_at timestamptz, riders int, km numeric)
language sql stable security definer set search_path = public as $$
  with me as (select c.*, s.lat, s.lon from crews c join spots s on s.id = c.spot_id where c.id = p_crew)
  select c.id, s.name, c.starts_at,
         (select count(*) from crew_members m where m.crew_id = c.id and planb.active(m.booking))::int,
         round((6371 * 2 * asin(sqrt(power(sin(radians(s.lat - me.lat) / 2), 2)
               + cos(radians(me.lat)) * cos(radians(s.lat)) * power(sin(radians(s.lon - me.lon) / 2), 2))))::numeric, 1) as km
  from me join crews c on c.id <> me.id and c.sport = me.sport and c.status in ('planned','on') and c.merged_into is null
       and (c.starts_at at time zone 'Europe/Amsterdam')::date = (me.starts_at at time zone 'Europe/Amsterdam')::date
       and abs(extract(epoch from c.starts_at - me.starts_at)) <= 90 * 60
  join spots s on s.id = c.spot_id
  where 6371 * 2 * asin(sqrt(power(sin(radians(s.lat - me.lat) / 2), 2)
               + cos(radians(me.lat)) * cos(radians(s.lat)) * power(sin(radians(s.lon - me.lon) / 2), 2))) <= 15
  order by abs(extract(epoch from c.starts_at - me.starts_at)), km;
$$;

create function planb.merge(p_from uuid, p_into uuid, p_by uuid) returns void language plpgsql as $$
declare r record; v_into crews;
begin
  select * into v_into from crews where id = p_into;
  for r in select * from crew_members where crew_id = p_from and (planb.active(booking) or booking = 'waitlist') loop
    if not exists (select 1 from crew_members where crew_id = p_into and profile_id = r.profile_id) then
      insert into crew_members (crew_id, profile_id, ride, seats_offered, pickup_town, booking, joined_at, waitlisted_at, one_way)
      values (p_into, r.profile_id, r.ride, r.seats_offered, r.pickup_town, r.booking, r.joined_at, r.waitlisted_at, r.one_way);
    end if;
    perform planb.notify(r.profile_id, p_into, 'merged', jsonb_build_object('from', p_from, 'into', p_into, 'starts_at', v_into.starts_at));
  end loop;
  update cars set crew_id = p_into where crew_id = p_from and status = 'open'
    and not exists (select 1 from cars c2 where c2.crew_id = p_into and c2.driver_id = cars.driver_id);
  update crew_members m set car_id = c.id from cars c
  where m.crew_id = p_into and c.crew_id = p_into and c.driver_id = m.profile_id and m.car_id is null;
  update crew_members set booking = 'called_off' where crew_id = p_from and (planb.active(booking) or booking = 'waitlist');
  update crews set status = 'off', call = 'off', called_at = planb.now(), called_by = p_by,
                   call_reason = 'merged', merged_into = p_into where id = p_from;
  perform planb.chat(p_into, 'Crews merged: riders from another crew joined this one.');
end $$;

-- ── RPCs for the app (supabase.rpc('<name>', {...})) ─────────────────────────────────────────
create function start_crew(p_sport sport, p_spot int, p_starts_at timestamptz, p_ride ride_kind default 'meet',
                           p_level skill default 'getting_there', p_notes text default null,
                           p_cancel_hours int default 2, p_max_wait_min int default 10,
                           p_waitlist_on boolean default true, p_merge_if_alone boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_needed'; end if;
  if p_starts_at <= planb.now() then raise exception 'in_the_past'; end if;
  insert into crews (host_id, sport, spot_id, starts_at, level, notes, cancel_hours, max_wait_min, waitlist_on, merge_if_alone, created_at)
  values (auth.uid(), p_sport, p_spot, p_starts_at, p_level, p_notes, p_cancel_hours, p_max_wait_min, p_waitlist_on, p_merge_if_alone, planb.now())
  returning id into v_id;
  insert into crew_members (crew_id, profile_id, ride, joined_at) values (v_id, auth.uid(), p_ride, planb.now());
  return v_id;
end $$;

-- Join (or re-join). Riders who need a seat get one if a car has room, else go on the waitlist.
create function join_crew(p_crew uuid, p_ride ride_kind, p_car uuid default null, p_pickup home_base default null,
                          p_one_way boolean default false)
returns booking_state language plpgsql security definer set search_path = public as $$
declare v crews; me crew_members; v_car uuid; v_state booking_state; v_ns int; n_active int;
begin
  if auth.uid() is null then raise exception 'sign_in_needed'; end if;
  select * into v from crews where id = p_crew;
  if not found then raise exception 'no_crew'; end if;
  if v.status in ('off','done') or v.merged_into is not null or planb.now() >= v.starts_at then raise exception 'crew_closed'; end if;
  me := planb.member(p_crew, auth.uid());
  if me.profile_id is not null and (planb.active(me.booking) or me.booking = 'waitlist') then raise exception 'already_in'; end if;
  select no_shows_60d into v_ns from reliability where profile_id = auth.uid();
  select count(*) into n_active from crew_members where crew_id = p_crew and planb.active(booking);
  v_state := 'in';
  if v.max_riders is not null and n_active >= v.max_riders then v_state := 'waitlist'; end if;
  if v_state = 'in' and p_ride = 'need' then
    if p_car is not null and exists (select 1 from cars where id = p_car and crew_id = p_crew and status = 'open'
                                     and leaves_at > planb.now()) and planb.free_seats(p_car) > 0 then
      v_car := p_car;
    else
      select c.id into v_car from cars c
      where c.crew_id = p_crew and c.status = 'open' and c.leaves_at > planb.now() and planb.free_seats(c.id) > 0
      order by c.leaves_at limit 1;
    end if;
    if v_car is null then v_state := 'waitlist'; end if;
  end if;
  if v_state = 'waitlist' and not v.waitlist_on then raise exception 'full'; end if;
  insert into crew_members (crew_id, profile_id, ride, pickup_town, booking, one_way, must_confirm, waitlisted_at, joined_at)
  values (p_crew, auth.uid(), p_ride, p_pickup, case when v_state = 'waitlist' then 'waitlist'::booking_state else 'in'::booking_state end,
          p_one_way, coalesce(v_ns, 0) >= 2, case when v_state = 'waitlist' then planb.now() end, planb.now())
  on conflict (crew_id, profile_id) do update set
    ride = excluded.ride, pickup_town = excluded.pickup_town, booking = excluded.booking, one_way = excluded.one_way,
    must_confirm = excluded.must_confirm, waitlisted_at = excluded.waitlisted_at, joined_at = planb.now(),
    car_id = null, late_min = null, eta_at = null, checked_in_at = null, cancelled_at = null, cancel_free = null,
    no_show_at = null, no_show_by = null, share_eur = null, confirmed_at = null, paid_at = null;
  if v_car is not null then
    perform planb.seat_rider(p_crew, auth.uid(), v_car);
    perform planb.chat(p_crew, planb.name(auth.uid()) || ' is in: seat in ' || planb.name((select driver_id from cars where id = v_car)) || '''s car.');
  else
    perform planb.chat(p_crew, planb.name(auth.uid()) || case when v_state = 'waitlist' then ' is on the waitlist.' else ' is in.' end);
  end if;
  if coalesce(v_ns, 0) >= 2 then
    perform planb.notify(auth.uid(), p_crew, 'confirm_needed', '{}', v.call_at - interval '2 hours', 'confirm:' || p_crew || ':' || auth.uid());
  end if;
  return (planb.member(p_crew, auth.uid())).booking;
end $$;

create function offer_car(p_crew uuid, p_leaves_at timestamptz, p_pickup_point text, p_seats int, p_round_trip_km numeric,
                          p_parking_eur numeric default 0, p_board_slots int default 0, p_max_wait_min int default null,
                          p_fuel_eur_per_km numeric default 0.13)
returns uuid language plpgsql security definer set search_path = public as $$
declare v crews; v_car uuid; me crew_members;
begin
  if auth.uid() is null then raise exception 'sign_in_needed'; end if;
  select * into v from crews where id = p_crew;
  if not found or v.status in ('off','done') or v.merged_into is not null then raise exception 'crew_closed'; end if;
  if p_leaves_at <= planb.now() or p_leaves_at >= v.starts_at then raise exception 'bad_time'; end if;
  me := planb.member(p_crew, auth.uid());
  if me.profile_id is null or not planb.active(me.booking) then
    insert into crew_members (crew_id, profile_id, ride, booking, joined_at) values (p_crew, auth.uid(), 'drive', 'in', planb.now())
    on conflict (crew_id, profile_id) do update set ride = 'drive', booking = 'in', cancelled_at = null, cancel_free = null;
  end if;
  insert into cars (crew_id, driver_id, leaves_at, pickup_point, seats, board_slots, max_wait_min, round_trip_km, parking_eur, fuel_eur_per_km)
  values (p_crew, auth.uid(), p_leaves_at, p_pickup_point, p_seats, p_board_slots, coalesce(p_max_wait_min, v.max_wait_min),
          p_round_trip_km, p_parking_eur, p_fuel_eur_per_km)
  on conflict (crew_id, driver_id) do update set leaves_at = excluded.leaves_at, pickup_point = excluded.pickup_point,
     seats = excluded.seats, board_slots = excluded.board_slots, max_wait_min = excluded.max_wait_min,
     round_trip_km = excluded.round_trip_km, parking_eur = excluded.parking_eur, fuel_eur_per_km = excluded.fuel_eur_per_km,
     status = 'open', cancelled_at = null
  returning id into v_car;
  update crew_members set ride = 'drive', car_id = v_car, seats_offered = p_seats where crew_id = p_crew and profile_id = auth.uid();
  while planb.promote(p_crew, v_car) is not null loop end loop;    -- seat the waitlist
  return v_car;
end $$;

-- Running late: within the driver's max wait the car waits; beyond it the app offers other cars.
create function running_late(p_crew uuid, p_minutes int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me crew_members; c cars; v_alt jsonb;
begin
  me := planb.member(p_crew, auth.uid());
  if me.profile_id is null or not planb.active(me.booking) then raise exception 'not_in'; end if;
  if p_minutes < 1 or p_minutes > 90 then raise exception 'bad_minutes'; end if;
  if me.car_id is null or me.ride <> 'need' then        -- own way or the driver: tell the crew
    update crew_members set booking = 'late', late_min = p_minutes,
      eta_at = (select starts_at from crews where id = p_crew) + make_interval(mins => p_minutes)
    where crew_id = p_crew and profile_id = auth.uid();
    perform planb.chat(p_crew, planb.name(auth.uid()) || ' is running ' || p_minutes || ' min late.');
    return jsonb_build_object('state', 'late');
  end if;
  select * into c from cars where id = me.car_id;
  if p_minutes <= c.max_wait_min then
    update crew_members set booking = 'late', late_min = p_minutes, eta_at = c.leaves_at + make_interval(mins => p_minutes)
    where crew_id = p_crew and profile_id = auth.uid();
    perform planb.notify(c.driver_id, p_crew, 'late', jsonb_build_object('rider', planb.name(auth.uid()), 'minutes', p_minutes,
                         'wait_until', c.leaves_at + make_interval(mins => p_minutes)));
    perform planb.chat(p_crew, planb.name(auth.uid()) || ' is running ' || p_minutes || ' min late. '
                       || planb.name(c.driver_id) || ' waits till '
                       || to_char((c.leaves_at + make_interval(mins => p_minutes)) at time zone 'Europe/Amsterdam', 'HH24:MI') || '.');
    return jsonb_build_object('state', 'covered', 'wait_until', c.leaves_at + make_interval(mins => p_minutes));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('car', a.id, 'driver', planb.name(a.driver_id), 'leaves_at', a.leaves_at,
                                               'pickup', a.pickup_point) order by a.leaves_at), '[]')
  into v_alt from cars a
  where a.crew_id = p_crew and a.id <> c.id and a.status = 'open' and a.leaves_at > planb.now() and planb.free_seats(a.id) > 0;
  return jsonb_build_object('state', 'too_late', 'max_wait_min', c.max_wait_min, 'alternatives', v_alt);
end $$;

create function switch_car(p_crew uuid, p_car uuid)
returns booking_state language plpgsql security definer set search_path = public as $$
declare me crew_members; v_old uuid;
begin
  me := planb.member(p_crew, auth.uid());
  if me.profile_id is null or not planb.active(me.booking) or me.ride <> 'need' then raise exception 'not_in'; end if;
  if me.car_id = p_car then return me.booking; end if;
  if not exists (select 1 from cars where id = p_car and crew_id = p_crew and status = 'open' and leaves_at > planb.now())
     or planb.free_seats(p_car) < 1 then raise exception 'no_seat'; end if;
  v_old := me.car_id;
  if v_old is not null and coalesce(me.share_eur, 0) > 0
     and (select shares_frozen_at from cars where id = v_old) is not null then
    -- after the freeze the old seat follows the cancel rule: its share counts unless someone takes the seat
    insert into seat_debts (crew_id, car_id, profile_id, amount_eur, reason) values (p_crew, v_old, auth.uid(), me.share_eur, 'switched');
  end if;
  perform planb.seat_rider(p_crew, auth.uid(), p_car);
  if v_old is not null then
    perform planb.notify((select driver_id from cars where id = v_old), p_crew, 'cancelled',
                         jsonb_build_object('rider', planb.name(auth.uid()), 'switched', true));
    perform planb.promote(p_crew, v_old);
  end if;
  return 'in';
end $$;

-- Check in at the meeting point (from 30 min before pickup or start). A driver can check in a rider they picked up.
create function check_in(p_crew uuid, p_rider uuid default null)
returns booking_state language plpgsql security definer set search_path = public as $$
declare who uuid := coalesce(p_rider, auth.uid()); m crew_members; v crews; v_from timestamptz;
begin
  m := planb.member(p_crew, who);
  select * into v from crews where id = p_crew;
  if m.profile_id is null or not planb.active(m.booking) then raise exception 'not_in'; end if;
  if p_rider is not null and p_rider <> auth.uid()
     and not exists (select 1 from cars where id = m.car_id and driver_id = auth.uid()) then raise exception 'not_your_rider'; end if;
  v_from := coalesce((select leaves_at from cars where id = m.car_id), v.starts_at) - interval '30 minutes';
  if planb.now() < v_from or planb.now() > v.starts_at + interval '3 hours' then raise exception 'not_now'; end if;
  update crew_members set booking = 'here', checked_in_at = planb.now() where crew_id = p_crew and profile_id = who;
  return 'here';
end $$;

create function undo_check_in(p_crew uuid) returns booking_state language plpgsql security definer set search_path = public as $$
begin
  update crew_members set booking = 'in', checked_in_at = null
  where crew_id = p_crew and profile_id = auth.uid() and booking = 'here';
  if not found then raise exception 'not_checked_in'; end if;
  return 'in';
end $$;

-- Can't go. Free until the cut-off; after it the share counts unless the seat is refilled.
create function cancel_booking(p_crew uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me crew_members; v crews; v_cut timestamptz; v_free boolean; v_car cars;
begin
  me := planb.member(p_crew, auth.uid());
  if me.profile_id is null or not planb.active(me.booking) then raise exception 'not_in'; end if;
  if me.ride = 'drive' then return driver_cant_drive(p_crew); end if;
  select * into v from crews where id = p_crew;
  select * into v_car from cars where id = me.car_id;
  v_cut := least(v.cutoff_at, coalesce(v_car.leaves_at, v.cutoff_at));
  v_free := planb.now() < v_cut or coalesce(me.share_eur, 0) = 0;
  if not v_free then
    insert into seat_debts (crew_id, car_id, profile_id, amount_eur, reason) values (p_crew, v_car.id, auth.uid(), me.share_eur, 'late_cancel');
  end if;
  update crew_members set booking = 'cancelled', cancelled_at = planb.now(), cancel_free = v_free,
         share_eur = null, car_id = null, late_min = null, eta_at = null
  where crew_id = p_crew and profile_id = auth.uid();
  if v_car.id is not null then
    perform planb.notify(v_car.driver_id, p_crew, 'cancelled', jsonb_build_object('rider', planb.name(auth.uid()), 'free', v_free));
    perform planb.chat(p_crew, planb.name(auth.uid()) || ' can''t make it.');
    perform planb.promote(p_crew, v_car.id);
  end if;
  me := planb.member(p_crew, auth.uid());
  return jsonb_build_object('free', me.cancel_free,
    'owes_eur', coalesce((select sum(amount_eur) from seat_debts where crew_id = p_crew and profile_id = auth.uid() and refilled_by is null), 0));
end $$;

create function join_waitlist(p_crew uuid) returns booking_state language plpgsql security definer set search_path = public as $$
declare v crews; me crew_members;
begin
  select * into v from crews where id = p_crew;
  if not v.waitlist_on or v.status in ('off','done') then raise exception 'no_waitlist'; end if;
  me := planb.member(p_crew, auth.uid());
  if me.profile_id is not null and (planb.active(me.booking) or me.booking = 'waitlist') then raise exception 'already_in'; end if;
  insert into crew_members (crew_id, profile_id, ride, booking, waitlisted_at, joined_at) values (p_crew, auth.uid(), 'need', 'waitlist', planb.now(), planb.now())
  on conflict (crew_id, profile_id) do update set booking = 'waitlist', ride = 'need', waitlisted_at = planb.now(), car_id = null;
  return 'waitlist';
end $$;

create function leave_waitlist(p_crew uuid) returns booking_state language plpgsql security definer set search_path = public as $$
begin
  update crew_members set booking = 'cancelled', cancelled_at = planb.now(), cancel_free = true
  where crew_id = p_crew and profile_id = auth.uid() and booking = 'waitlist';
  if not found then raise exception 'not_waiting'; end if;
  return 'cancelled';
end $$;

-- Riders with 2+ no-shows in 60 days confirm before the call, or their seat goes to the waitlist.
create function confirm_seat(p_crew uuid) returns void language sql security definer set search_path = public as $$
  update crew_members set confirmed_at = planb.now()
  where crew_id = p_crew and profile_id = auth.uid() and must_confirm and planb.active(booking);
$$;

-- No-show: the driver, after waiting the max wait (or the rider's ETA if that is later and within the max).
create function mark_no_show(p_crew uuid, p_rider uuid) returns booking_state language plpgsql security definer set search_path = public as $$
declare m crew_members; c cars;
begin
  m := planb.member(p_crew, p_rider);
  if m.profile_id is null or m.booking not in ('in','late') then raise exception 'not_in'; end if;
  select * into c from cars where id = m.car_id;
  if c.id is null then
    if not exists (select 1 from crews where id = p_crew and host_id = auth.uid()) then raise exception 'not_allowed'; end if;
    if planb.now() < (select starts_at from crews where id = p_crew) + interval '30 minutes' then raise exception 'still_waiting'; end if;
  else
    if c.driver_id <> auth.uid() then raise exception 'not_allowed'; end if;
    if planb.now() < c.leaves_at + make_interval(mins => c.max_wait_min) then raise exception 'still_waiting'; end if;
  end if;
  update crew_members set booking = 'no_show', no_show_at = planb.now(), no_show_by = auth.uid()
  where crew_id = p_crew and profile_id = p_rider;
  insert into reliability_events (profile_id, crew_id, kind, points) values (p_rider, p_crew, 'no_show', -30)
  on conflict do nothing;
  perform planb.notify(p_rider, p_crew, 'no_show', jsonb_build_object('share_eur', m.share_eur, 'dispute_hours', 24));
  return 'no_show';
end $$;

-- Driver can't drive: car cancelled, riders moved to other cars or to the front of the waitlist. Nobody pays this driver.
create function driver_cant_drive(p_crew uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare c cars; v crews; r record; v_new uuid; moved int := 0; waiting int := 0;
begin
  select * into v from crews where id = p_crew;
  select * into c from cars where crew_id = p_crew and driver_id = auth.uid() and status = 'open';
  if not found then raise exception 'no_car'; end if;
  update cars set status = 'cancelled', cancelled_at = planb.now() where id = c.id;
  update crew_members set booking = 'cancelled', cancelled_at = planb.now(), cancel_free = true, car_id = null
  where crew_id = p_crew and profile_id = auth.uid();
  if planb.now() >= v.call_at then
    insert into reliability_events (profile_id, crew_id, kind, points) values (auth.uid(), p_crew, 'driver_dropped_late', -20)
    on conflict do nothing;
  end if;
  for r in select * from crew_members where car_id = c.id and ride = 'need' and planb.active(booking) order by joined_at loop
    update crew_members set car_id = null, share_eur = null where crew_id = p_crew and profile_id = r.profile_id;
    v_new := planb.reseat_or_wait(p_crew, r.profile_id, c.leaves_at);
    if v_new is not null then
      moved := moved + 1;
      perform planb.notify(r.profile_id, p_crew, 'moved_car', jsonb_build_object('car', v_new,
        'driver', planb.name((select driver_id from cars where id = v_new)),
        'leaves_at', (select leaves_at from cars where id = v_new),
        'share_eur', (select share_eur from split_shares(v_new) s where s.profile_id = r.profile_id)));
    else
      waiting := waiting + 1;
      perform planb.notify(r.profile_id, p_crew, 'driver_dropped', jsonb_build_object('waitlist', true));
    end if;
  end loop;
  perform planb.chat(p_crew, planb.name(auth.uid()) || ' can''t drive today. Riders moved: ' || moved || ', on the waitlist: ' || waiting || '.');
  return jsonb_build_object('moved', moved, 'waitlist', waiting);
end $$;

create function make_call(p_crew uuid, p_call text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from crews where id = p_crew and host_id = auth.uid()) then raise exception 'not_host'; end if;
  if p_call not in ('go','off') then raise exception 'bad_call'; end if;
  perform planb.make_call(p_crew, p_call, coalesce(p_reason, case when p_call = 'go' then 'Host says go' else 'Host called it off' end), auth.uid());
end $$;

create function merge_crew(p_from uuid, p_into uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from crews where id = p_from and host_id = auth.uid()) then raise exception 'not_host'; end if;
  if not exists (select 1 from merge_candidates(p_from) m where m.crew_id = p_into) then raise exception 'not_a_match'; end if;
  perform planb.merge(p_from, p_into, auth.uid());
end $$;

-- Day one: money is settled outside the app; the driver ticks who paid.
create function mark_paid(p_crew uuid, p_rider uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update crew_members m set paid_at = planb.now()
  from cars c where m.crew_id = p_crew and m.profile_id = p_rider and c.id = m.car_id and c.driver_id = auth.uid();
  update seat_debts d set paid_at = planb.now()
  from cars c where d.crew_id = p_crew and d.profile_id = p_rider and c.id = d.car_id and c.driver_id = auth.uid()
    and d.refilled_by is null;
end $$;

-- ── The clock: run every minute (Supabase Cron, see PLAN-B.md) ──────────────────────────────
create function plan_b_tick() returns jsonb language plpgsql security definer set search_path = public as $$
declare t timestamptz := planb.now(); r record; s record; v_into uuid; out jsonb := '{}'; n int;
begin
  -- 1. freeze each car's split at the cut-off (or when it leaves, if earlier)
  n := 0;
  for r in select c.id from cars c join crews v on v.id = c.crew_id
           where c.status = 'open' and c.shares_frozen_at is null and t >= least(v.cutoff_at, c.leaves_at) loop
    perform planb.freeze_car(r.id); n := n + 1;
  end loop;
  out := out || jsonb_build_object('frozen', n);
  -- 2. riders who had to confirm and didn't: seat released (free) before the call
  n := 0;
  for r in select m.* from crew_members m join crews v on v.id = m.crew_id
           where m.must_confirm and m.confirmed_at is null and planb.active(m.booking) and t >= v.call_at and v.call is null loop
    update crew_members set booking = 'cancelled', cancelled_at = t, cancel_free = true, share_eur = null
    where crew_id = r.crew_id and profile_id = r.profile_id;
    if r.car_id is not null then perform planb.promote(r.crew_id, r.car_id); end if;
    n := n + 1;
  end loop;
  out := out || jsonb_build_object('unconfirmed_released', n);
  -- 3. the call: merge lonely crews, otherwise the forecast decides (host can override until cars leave)
  n := 0;
  for r in select * from crews where status = 'planned' and call is null and merged_into is null and t >= call_at loop
    if r.merge_if_alone and (select count(*) from crew_members where crew_id = r.id and planb.active(booking)) <= 1 then
      select crew_id into v_into from merge_candidates(r.id) limit 1;
      if v_into is not null then perform planb.merge(r.id, v_into, null); n := n + 1; continue; end if;
      perform planb.notify(r.host_id, r.id, 'alone', '{}', null, 'alone:' || r.id);
    end if;
    select * into s from planb.suggest_call(r.id);
    if s.call is null then
      perform planb.notify(r.host_id, r.id, 'call_needed', '{}', null, 'call_needed:' || r.id);
    else
      perform planb.make_call(r.id, s.call, s.reason, null);
    end if;
    n := n + 1;
  end loop;
  out := out || jsonb_build_object('called', n);
  -- 4. reminders (once each)
  for r in select m.profile_id, m.crew_id, v.cutoff_at from crew_members m join crews v on v.id = m.crew_id
           where planb.active(m.booking) and m.ride = 'need' and v.status in ('planned','on')
             and t >= v.cutoff_at - interval '30 minutes' and t < v.cutoff_at loop
    perform planb.notify(r.profile_id, r.crew_id, 'cutoff_soon', jsonb_build_object('cutoff_at', r.cutoff_at), null, 'cutoff:' || r.crew_id || ':' || r.profile_id);
  end loop;
  for r in select m.profile_id, m.crew_id, c.leaves_at, c.pickup_point from crew_members m join cars c on c.id = m.car_id
           where planb.active(m.booking) and m.ride = 'need' and c.status = 'open'
             and t >= c.leaves_at - interval '45 minutes' and t < c.leaves_at loop
    perform planb.notify(r.profile_id, r.crew_id, 'pickup_soon', jsonb_build_object('leaves_at', r.leaves_at, 'pickup', r.pickup_point), null, 'pickup:' || r.crew_id || ':' || r.profile_id);
  end loop;
  -- 5. close sessions 4 h after the start: points, then "pay after"
  n := 0;
  for r in select * from crews where status in ('planned','on') and t >= starts_at + interval '4 hours' loop
    insert into reliability_events (profile_id, crew_id, kind, points)
      select profile_id, r.id, 'showed_up', 15 from crew_members where crew_id = r.id and booking = 'here'
    on conflict do nothing;
    insert into reliability_events (profile_id, crew_id, kind, points)
      select c.driver_id, r.id, 'drove', 10 from cars c
      where c.crew_id = r.id and c.status = 'open'
        and exists (select 1 from crew_members m where m.car_id = c.id and m.ride = 'need' and m.booking = 'here')
    on conflict do nothing;
    insert into reliability_events (profile_id, crew_id, kind, points)
      select distinct d.profile_id, r.id, 'late_cancel', -10 from seat_debts d
      where d.crew_id = r.id and d.reason = 'late_cancel' and d.refilled_by is null
    on conflict do nothing;
    for s in select x.profile_id, sum(x.amt) as amt, string_agg(distinct planb.name(x.driver_id), ', ') as drivers from (
               select m.profile_id, m.share_eur as amt, c.driver_id from crew_members m join cars c on c.id = m.car_id
               where m.crew_id = r.id and m.ride = 'need' and coalesce(m.share_eur, 0) > 0 and m.paid_at is null
                 and m.booking in ('here','in','late','no_show')
               union all
               select d.profile_id, d.amount_eur, c.driver_id from seat_debts d join cars c on c.id = d.car_id
               where d.crew_id = r.id and d.refilled_by is null and d.paid_at is null) x
             group by x.profile_id loop
      perform planb.notify(s.profile_id, r.id, 'pay_after', jsonb_build_object('share_eur', s.amt, 'to', s.drivers), null, 'pay:' || r.id || ':' || s.profile_id);
    end loop;
    update crew_members set booking = 'done' where crew_id = r.id and booking in ('in','late','here');
    update cars set status = 'done' where crew_id = r.id and status = 'open';
    update crews set status = 'done', done_at = t where id = r.id;
    n := n + 1;
  end loop;
  return out || jsonb_build_object('closed', n);
end $$;

-- ── Seats view (2.2 name kept), per-car view for the crew page ───────────────────────────────
create or replace view crew_seats with (security_invoker = true) as
  select v.id as crew_id,
         coalesce((select sum(planb.free_seats(c.id)) from cars c where c.crew_id = v.id and c.status = 'open'), 0)::bigint as seats_left,
         (select count(*) from crew_members m where m.crew_id = v.id and planb.active(m.booking)) as riders
  from crews v;

create view car_seats with (security_invoker = true) as
  select c.id as car_id, c.crew_id, c.driver_id, c.leaves_at, c.pickup_point, c.seats, c.board_slots, c.max_wait_min, c.status,
         planb.free_seats(c.id) as free_seats,
         round(c.round_trip_km * c.fuel_eur_per_km + c.parking_eur, 2) as trip_cost_eur,
         (select max(s.share_eur) from split_shares(c.id) s where not s.is_driver) as each_eur
  from cars c;

-- ── Security ─────────────────────────────────────────────────────────────────────────────────
alter table cars enable row level security;
alter table reliability_events enable row level security;
alter table notifications enable row level security;
alter table seat_debts enable row level security;
create policy "own or my car debts" on seat_debts for select using (
  auth.uid() = profile_id or exists (select 1 from cars c where c.id = seat_debts.car_id and c.driver_id = auth.uid()));
create policy "read cars" on cars for select to authenticated using (true);
create policy "own points" on reliability_events for select using (auth.uid() = profile_id);
create policy "own notifications" on notifications for select using (auth.uid() = profile_id);
create policy "mark read" on notifications for update using (auth.uid() = profile_id);

-- State changes only through the functions above.
revoke insert, update, delete on cars, reliability_events, notifications, seat_debts from anon, authenticated;
grant update (read_at) on notifications to authenticated;
revoke insert, update, delete on crew_members from anon, authenticated;
grant update (pickup_town, one_way) on crew_members to authenticated;
revoke update on crews from anon, authenticated;
grant update (level, rookies_ok, notes, max_riders, cancel_hours, max_wait_min, waitlist_on, merge_if_alone) on crews to authenticated;
revoke insert on crews from anon, authenticated;     -- crews are started with start_crew()
revoke all on crews, cars, crew_members, reliability_events, notifications, seat_debts, crew_seats, car_seats, reliability from anon;

revoke execute on function plan_b_tick() from public, anon, authenticated;
revoke execute on function split_shares(uuid) from anon;
revoke execute on function merge_candidates(uuid) from anon;
revoke execute on function start_crew(sport, int, timestamptz, ride_kind, skill, text, int, int, boolean, boolean),
  join_crew(uuid, ride_kind, uuid, home_base, boolean), offer_car(uuid, timestamptz, text, int, numeric, numeric, int, int, numeric),
  running_late(uuid, int), switch_car(uuid, uuid), check_in(uuid, uuid), undo_check_in(uuid), cancel_booking(uuid),
  join_waitlist(uuid), leave_waitlist(uuid), confirm_seat(uuid), mark_no_show(uuid, uuid), driver_cant_drive(uuid),
  make_call(uuid, text, text), merge_crew(uuid, uuid), mark_paid(uuid, uuid) from anon;
revoke execute on all functions in schema planb from public;
grant usage on schema planb to authenticated, service_role;   -- needed by views that call planb helpers
grant select on planb.settings to authenticated, service_role;
grant execute on function planb.active(booking_state), planb.free_seats(uuid), planb.now() to authenticated, service_role;

alter publication supabase_realtime add table cars;
