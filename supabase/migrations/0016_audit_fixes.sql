-- 0016 (2.15, written as 0013): fixes from the UX & conversion audit of 15 Nov 2026.
--
--   1. Test crews never show in public: crews.is_test, left out of hi8_crews, hi8_live and the hub counts.
--      The "Frankie again" test crews (and any crew whose host email ends in +test@…) are flagged now.
--   2. The Hi8 Pass: €16.99 a month, €9.99 a month for founding riders (locked). The 15% Hi8 fee stays for
--      life; Pass members pay 10% instead of having it waived. During the pilot (fee_live false) no fee is charged.
--   3. pass_interest: "Count me in" on the Pass while it isn't on sale yet, so we can see who wants it.
--
-- Safe to run more than once. Needs 0001 to 0012.

-- ---------------------------------------------------------------------------------------------
-- 1. test crews
alter table public.crews add column if not exists is_test boolean not null default false;

update public.crews set is_test = true
 where not is_test and (public.hi8_name(host_email, city) ilike 'frankie again%' or lower(host_email) like '%+test@%');

create or replace function public.hi8_crews(p_city text default null) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(public.hi8_crew_card(c) order by c.day, c.start_time), '[]'::json)
  from public.crews c
  where (p_city is null or c.city = p_city) and not c.is_test
    and c.day between public.hi8_today(c.city) and public.hi8_today(c.city) + 13;
$$;

create or replace function public.hi8_live(p_city text default null) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'at', now(),
    'crews', (select coalesce(json_agg(public.hi8_crew_card(c) order by c.day, c.start_time), '[]'::json) from public.crews c
              where (p_city is null or c.city = p_city) and c.status = 'on' and not c.is_test
                and c.day between public.hi8_today(c.city) and public.hi8_today(c.city) + 2),
    'reports', (select coalesce(json_agg(json_build_object('spot', r.spot, 'sport', r.sport, 'at', r.at, 'verdict', r.verdict,
                  'kite', r.kite, 'ground', r.ground) order by r.at desc), '[]'::json)
                from public.spot_reports r join public.spots s on s.slug = r.spot
                where (p_city is null or s.city = p_city) and r.at > now() - interval '6 hours'));
$$;

-- the crews leaving from each starting point, without test crews
create or replace function public.hi8_places() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'cities', (select coalesce(json_agg(json_build_object('slug', slug, 'name', name, 'country', country, 'status', status, 'tz', tz, 'region', region) order by status, slug), '[]'::json) from public.cities),
    'hubs',   (select coalesce(json_agg(json_build_object('city', h.city, 'slug', h.slug, 'name', h.name, 'sub', h.sub, 'lat', h.lat, 'lon', h.lon, 'kind', h.kind,
                 'crews', (select count(*) from public.crews c where c.city = h.city and c.meet_hub = h.slug and c.status = 'on' and not c.is_test and c.day >= public.hi8_today(c.city)))
                 order by h.city, h.sort, h.name), '[]'::json)
               from public.hubs h
               where h.kind = 'hub' or exists (select 1 from public.crews c where c.city = h.city and c.meet_hub = h.slug and not c.is_test and c.day >= public.hi8_today(c.city) - 120)),
    'spots',  (select coalesce(json_agg(json_build_object('slug', slug, 'city', city, 'name', name, 'lat', lat, 'lon', lon, 'sports', sports,
                 'face', face, 'good_from', good_from, 'good_to', good_to, 'lake', lake, 'note', note, 'maps', maps) order by city, sort), '[]'::json)
               from public.spots where active));
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. the Pass and the member fee
insert into public.app_settings (key, value) values
  ('pass_month_cents', '1699'),
  ('pass_founding_cents', '999'),
  ('member_fee_pct', '10'),
  ('pass_founding_open', 'true')
on conflict (key) do update set value = excluded.value
  where public.app_settings.key in ('pass_month_cents', 'pass_founding_cents', 'member_fee_pct');
-- the Pass is monthly only: no yearly price
delete from public.app_settings where key = 'pass_year_cents';
-- Close the founding price later (riders who subscribed keep theirs: Stripe keeps a subscription's price):
--   update public.app_settings set value = 'false' where key = 'pass_founding_open';

-- what the Stripe checkout reads about a rider: now with the founding price
create or replace function public.hi8_key_owner(p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  return json_build_object('email', em, 'balance_cents', public.hi8_balance(em), 'live', public.hi8_payments_live(),
    'max_cents', public.hi8_int('wallet_max_cents', 10000), 'topups', (select value from public.app_settings where key = 'topup_cents'),
    'pass', public.hi8_has_pass(em), 'pass_month_cents', public.hi8_int('pass_month_cents', 1699),
    'pass_founding_cents', public.hi8_int('pass_founding_cents', 999),
    'pass_founding_open', coalesce((select value = 'true'::jsonb from public.app_settings where key = 'pass_founding_open'), false),
    'stripe_cus', (select stripe_cus from public.passes where email = em),
    'stripe_acct', (select stripe_acct from public.payout_accounts where email = em), 'payout_ready', coalesce((select ready from public.payout_accounts where email = em), false));
end $$;

-- what a rider's seat costs now: the share of the driver's car, plus the Hi8 fee (10% with the Pass, 15% without)
create or replace function public.hi8_seat_price(p_crew uuid, p_email text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.crew_members; d public.crew_members; n int; share int; fee int := 0; waived text := null; pct numeric; member boolean;
begin
  select * into m from public.crew_members where crew_id = p_crew and lower(email) = lower(p_email);
  if m.member_id is null or m.car_with is null then return null; end if;
  select * into d from public.crew_members where crew_id = p_crew and member_id = m.car_with;
  if d.member_id is null or d.trip_cost is null then return null; end if;
  select count(*) into n from public.crew_members where crew_id = p_crew and car_with = d.member_id;
  share := round(d.trip_cost * 100 / (n + 1));
  member := public.hi8_has_pass(p_email);
  pct := case when member then coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'member_fee_pct'), 10)
              else coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'ride_fee_pct'), 15) end;
  if coalesce((select value = 'true'::jsonb from public.app_settings where key = 'fee_live'), false) then
    fee := greatest(round(share * pct / 100), public.hi8_int('fee_min_cents', 49));
  else waived := 'pilot';
  end if;
  return jsonb_build_object('share_cents', share, 'fee_cents', fee, 'total_cents', share + fee, 'waived', waived, 'fee_pct', pct, 'member', member, 'driver', d.email);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Pass interest while it isn't on sale: an email (or the signed-in rider), where it came from
create table if not exists public.pass_interest (
  email      text primary key,
  city       text,
  sport      text,
  source     text check (source in ('landing', 'crew', 'me', 'other')),
  created_at timestamptz not null default now()
);
alter table public.pass_interest enable row level security;
revoke all on public.pass_interest from anon, authenticated;

create or replace function public.hi8_pass_interest(p_email text default null, p_key uuid default null, p_city text default null, p_sport text default null, p_source text default 'other')
returns json language plpgsql security definer set search_path = public as $$
declare em text;
begin
  em := case when p_key is not null then public.hi8_email(p_key) else lower(trim(coalesce(p_email, ''))) end;
  if em is null or em !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'bad_email' using errcode = '22023'; end if;
  perform public.hi8_limit('pass', em, 5, interval '1 hour');
  insert into public.pass_interest (email, city, sport, source)
    values (em, left(p_city, 40), left(p_sport, 20), case when p_source in ('landing', 'crew', 'me') then p_source else 'other' end)
  on conflict (email) do update set city = coalesce(excluded.city, pass_interest.city), sport = coalesce(excluded.sport, pass_interest.sport);
  return json_build_object('ok', true, 'count', (select count(*) from public.pass_interest));
end $$;

revoke execute on function public.hi8_pass_interest(text, uuid, text, text, text) from public;
grant execute on function public.hi8_pass_interest(text, uuid, text, text, text) to anon, authenticated;

-- Who wants the Pass: select email, city, source, created_at from public.pass_interest order by created_at desc;
-- Flag another test crew:  update public.crews set is_test = true where code = 'ABC123';
