-- Hi8ctane 0002: real sign-ups from the live website (hi8ctane.com, served by GitHub Pages).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001_day_zero.sql. Safe to run again.
--
-- The website has no server of its own, so the browser calls the functions below directly with the
-- project's PUBLISHABLE key. That is safe because:
--   * the tables stay locked (row-level security on, no policies, no table rights for anon);
--   * the browser can only call the hi8_* functions, which check every value, never return anyone's
--     name or email, and are rate-limited per visitor;
--   * after signing up, the browser gets a random key that only lets it change its own sign-up.
-- The SECRET key never goes in the website.

-- ---------------------------------------------------------------------------------------------
-- 1. What the live screens collect on top of 0001
-- ---------------------------------------------------------------------------------------------

-- the rider name comes one screen after the email, so it starts empty
alter table public.signups     alter column first_name drop not null;
alter table public.night_rsvps alter column first_name drop not null;

alter table public.signups add column if not exists max_min int
  check (max_min is null or max_min in (30, 60, 90));
alter table public.signups add column if not exists getting_there text
  check (getting_there is null or getting_there in ('seat', 'drive', 'own'));
-- set when the rider opens the email link or signs in with Google (once those are switched on)
alter table public.signups add column if not exists email_verified_at timestamptz;

-- Browser keys. Signing up hands the browser a random key; with it, that browser can add its rider
-- name, sports and hub, RSVP and join other cities. One person can have a key per device.
create table if not exists public.rider_keys (
  key         uuid primary key default gen_random_uuid(),
  email       text not null,
  how         text not null default 'form' check (how in ('form', 'email-link', 'google')),
  created_at  timestamptz not null default now(),
  used_at     timestamptz not null default now()
);
create index if not exists rider_keys_email on public.rider_keys (lower(email));

-- Schools and rental shops that use the partner form (the form still opens an email as well).
create table if not exists public.partner_leads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  spot        text check (spot is null or char_length(spot) <= 80),
  offers      text[] not null default '{}' check (offers <@ array['lessons', 'rental', 'shop', 'camps']::text[]),
  contact     text not null check (char_length(contact) between 3 and 120),
  created_at  timestamptz not null default now()
);

-- Rate limiting. Visitors are counted by a salted hash of their IP address (never the address itself),
-- and the rows are deleted after a day.
create table if not exists public.rate_hits (
  bucket  text not null,
  who     text not null,
  at      timestamptz not null default now()
);
create index if not exists rate_hits_lookup on public.rate_hits (bucket, who, at);

create table if not exists public.app_secrets (
  name   text primary key,
  value  text not null
);
insert into public.app_secrets (name, value)
values ('ip_salt', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

alter table public.rider_keys    enable row level security;
alter table public.partner_leads enable row level security;
alter table public.rate_hits     enable row level security;
alter table public.app_secrets   enable row level security;
revoke all on public.rider_keys, public.partner_leads, public.rate_hits, public.app_secrets from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Helpers (not callable from the website)
-- ---------------------------------------------------------------------------------------------

-- who is calling: a salted hash of the visitor's IP, or null when there is no request (SQL editor)
create or replace function public.hi8_client() returns text
language sql stable security definer set search_path = public as $$
  with h as (select nullif(current_setting('request.headers', true), '')::json as j),
  ip as (
    select coalesce(
      nullif(trim(split_part(coalesce(j->>'x-forwarded-for', ''), ',', 1)), ''),
      nullif(j->>'cf-connecting-ip', ''),
      nullif(j->>'x-real-ip', '')) as v
    from h)
  select case when ip.v is null then null
    else encode(sha256(convert_to((select value from public.app_secrets where name = 'ip_salt') || ip.v, 'UTF8')), 'hex') end
  from ip;
$$;

-- at most p_max calls per p_window for this bucket and caller; past that, HTTP 429
create or replace function public.hi8_limit(p_bucket text, p_who text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_who is null then return; end if;
  if (select count(*) from public.rate_hits where bucket = p_bucket and who = p_who and at > now() - p_window) >= p_max then
    raise exception 'slow_down' using errcode = 'PT429', hint = 'Too many tries from here. Wait a few minutes.';
  end if;
  insert into public.rate_hits (bucket, who) values (p_bucket, p_who);
  if random() < 0.02 then delete from public.rate_hits where at < now() - interval '1 day'; end if;
end $$;

-- the email behind a browser key, or an error if the key is unknown
create or replace function public.hi8_email(p_key uuid) returns text
language plpgsql security definer set search_path = public as $$
declare em text;
begin
  update public.rider_keys set used_at = now() where key = p_key returning lower(email) into em;
  if em is null then raise exception 'unknown_key' using errcode = '28000', hint = 'Sign up again on this device.'; end if;
  return em;
end $$;

-- public numbers for one city (no names, no emails)
create or replace function public.hi8_city_counts(p_city text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'riders',        (select count(*) from public.signups s where s.city = c.slug),
    'captains',      (select count(*) from public.signups s where s.city = c.slug and s.captain),
    'riders_goal',   c.riders_goal,
    'captains_goal', c.captains_goal,
    'plates_left',   greatest(0, c.plates - (select count(*) from public.signups s where s.city = c.slug and s.plate is not null)),
    'next_plate',    (select case when coalesce(max(s.plate), 0) < c.plates then coalesce(max(s.plate), 0) + 1 end
                      from public.signups s where s.city = c.slug),
    'status',        c.status,
    'name',          c.name)
  from public.cities c where c.slug = p_city;
$$;

create or replace function public.hi8_night_counts(p_event text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'going', (select count(*) from public.night_rsvps r where r.event = p_event),
    'sessions', coalesce((select jsonb_object_agg(x.session, x.n)
                          from (select session, count(*) as n from public.night_rsvps r where r.event = p_event group by session) x), '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. What the website calls
-- ---------------------------------------------------------------------------------------------

-- hi8_counts: every number the website shows (riders and plates per city, Founding Night RSVPs)
create or replace function public.hi8_counts(p_event text default 'founding-night-bcn') returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'cities', coalesce((select jsonb_object_agg(c.slug, public.hi8_city_counts(c.slug)) from public.cities c), '{}'::jsonb),
    'night',  public.hi8_night_counts(p_event));
$$;

-- hi8_join: the Get In screen. Puts the email on a city's list, hands out the next founding plate
-- (or returns the one they already have) and gives this browser its key.
create or replace function public.hi8_join(
  p_email text, p_city text default 'amsterdam', p_source text default null, p_ref text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  em  text := lower(trim(coalesce(p_email, '')));
  r   json;
  k   uuid;
begin
  if char_length(em) > 254 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad_email' using errcode = '22023', hint = 'That email doesn''t look right.';
  end if;
  perform public.hi8_limit('join', public.hi8_client(), 20, interval '10 minutes');
  perform public.hi8_limit('join', 'everyone', 3000, interval '1 hour');

  r := public.join_waitlist(p_city => coalesce(nullif(lower(trim(p_city)), ''), 'amsterdam'), p_first_name => null, p_email => em,
                            p_source => left(nullif(trim(p_source), ''), 80), p_ref => left(nullif(trim(p_ref), ''), 40));
  insert into public.rider_keys (email, how) values (em, 'form') returning key into k;
  return (r::jsonb || jsonb_build_object('key', k))::json;
end $$;

-- hi8_profile: the onboarding screen (rider name, sports and levels, hub, how far, getting there)
create or replace function public.hi8_profile(
  p_key uuid, p_name text default null, p_sports text[] default null, p_levels jsonb default null,
  p_city text default null, p_hub text default null, p_max_min int default null, p_getting_there text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  em  text := public.hi8_email(p_key);
  nm  text := nullif(regexp_replace(trim(coalesce(p_name, '')), '[[:cntrl:]]', '', 'g'), '');
  sp  text[];
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  if nm is not null and char_length(nm) > 40 then raise exception 'bad_name' using errcode = '22023', hint = 'Rider names are 40 characters at most.'; end if;
  if p_sports is not null then
    sp := (select coalesce(array_agg(distinct s order by s), '{}') from unnest(p_sports) s);
    if not sp <@ array['kite', 'wing', 'surf', 'sup', 'mtb', 'mx']::text[] then raise exception 'bad_sport' using errcode = '22023'; end if;
  end if;
  if p_levels is not null and (jsonb_typeof(p_levels) <> 'object' or exists (
       select 1 from jsonb_each(p_levels) e
       where e.key not in ('kite', 'wing', 'surf', 'sup', 'mtb', 'mx') or e.value not in ('"rookie"', '"regular"', '"ripper"'))) then
    raise exception 'bad_level' using errcode = '22023';
  end if;
  if p_hub is not null and p_hub !~ '^[a-z0-9-]{1,20}$' then raise exception 'bad_hub' using errcode = '22023'; end if;

  update public.signups set
    first_name    = coalesce(nm, first_name),
    sports        = coalesce(sp, sports),
    levels        = levels || coalesce(p_levels, '{}'::jsonb),
    max_min       = coalesce(p_max_min, max_min),
    getting_there = coalesce(p_getting_there, getting_there),
    updated_at    = now()
  where lower(email) = em;
  -- hubs belong to one city (Sloterdijk is Amsterdam), so only that city's row gets it
  if p_hub is not null and p_city is not null then
    update public.signups set hub = p_hub where lower(email) = em and city = lower(trim(p_city));
  end if;
  return json_build_object('ok', true);
end $$;

-- hi8_rsvp: the Founding Night RSVP. Needs the waiver tick; can be sent again to change session or hub.
create or replace function public.hi8_rsvp(
  p_key uuid, p_session text, p_hub text, p_waiver boolean, p_photo boolean default false,
  p_event text default 'founding-night-bcn'
) returns json
language plpgsql security definer set search_path = public as $$
declare
  em   text := public.hi8_email(p_key);
  nm   text;
  r    json;
  n    int;
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  if p_event is distinct from 'founding-night-bcn' then raise exception 'unknown_event' using errcode = '22023'; end if;
  select first_name into nm from public.signups where lower(email) = em and first_name is not null order by created_at limit 1;
  r := public.rsvp_night(nm, em, p_session, p_hub, p_waiver, coalesce(p_photo, false), p_event);
  -- their number in the queue: the nth person to say yes
  select count(*) into n from public.night_rsvps
  where event = p_event and created_at <= (select created_at from public.night_rsvps where event = p_event and lower(email) = em);
  return (r::jsonb || jsonb_build_object('n', n) || public.hi8_night_counts(p_event))::json;
end $$;

-- hi8_city: "I'm in" and "I'll captain" for a city that isn't open yet. Joining gets that city's
-- founding plate; switching both off takes them off that city's list again.
create or replace function public.hi8_city(
  p_key uuid, p_city text, p_in boolean, p_captain boolean default false,
  p_captain_sport text default null, p_captain_days text[] default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  em    text := public.hi8_email(p_key);
  c     public.cities;
  me    public.signups;
  cap   boolean := coalesce(p_captain, false);
  days  text[];
  pl    int;
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  select * into c from public.cities where slug = lower(trim(coalesce(p_city, '')));
  if not found then raise exception 'unknown_city' using errcode = '22023'; end if;
  if c.status <> 'soon' then raise exception 'city_is_open' using errcode = '22023', hint = 'This city is already open: sign up on the Get In screen.'; end if;
  days := (select coalesce(array_agg(distinct d order by d), '{}') from unnest(coalesce(p_captain_days, '{}')) d);

  if coalesce(p_in, false) or cap then
    -- bring their rider name, sports and levels along from the list they're already on
    select * into me from public.signups where lower(email) = em order by created_at limit 1;
    perform public.join_waitlist(p_city => c.slug, p_first_name => me.first_name, p_email => em,
                                 p_sports => coalesce(me.sports, '{}'), p_levels => coalesce(me.levels, '{}'::jsonb), p_source => 'city-page');
    update public.signups set
      captain       = cap,
      captain_sport = case when cap then p_captain_sport end,
      captain_days  = case when cap then days else '{}' end,
      updated_at    = now()
    where city = c.slug and lower(email) = em
    returning plate into pl;
  else
    delete from public.signups where city = c.slug and lower(email) = em;
  end if;
  return (jsonb_build_object('city', c.slug, 'in', coalesce(p_in, false) or cap, 'captain', cap, 'plate', pl)
          || public.hi8_city_counts(c.slug))::json;
end $$;

-- hi8_partner: the schools + rental shops form
create or replace function public.hi8_partner(
  p_name text, p_contact text, p_spot text default null, p_offers text[] default '{}'
) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform public.hi8_limit('partner', public.hi8_client(), 10, interval '1 hour');
  if char_length(trim(coalesce(p_name, ''))) = 0 or char_length(trim(coalesce(p_contact, ''))) < 3 then
    raise exception 'missing_fields' using errcode = '22023', hint = 'Add your school or shop and a way to reach you.';
  end if;
  insert into public.partner_leads (name, spot, offers, contact)
  values (left(trim(p_name), 80), left(nullif(trim(p_spot), ''), 80),
          (select coalesce(array_agg(distinct o order by o), '{}') from unnest(coalesce(p_offers, '{}')) o),
          left(trim(p_contact), 120));
  return json_build_object('ok', true);
end $$;

-- hi8_claim: after the rider opens the email link or signs in with Google (Supabase Auth), the
-- browser swaps that sign-in for a key. Only for confirmed emails; only switched on once Auth is set up.
create or replace function public.hi8_claim(p_city text default 'amsterdam') returns json
language plpgsql security definer set search_path = public as $$
declare
  cl   jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  em   text;
  prov text;
  k    uuid;
  pl   int;
  cy   text;
begin
  if cl is null or cl->>'role' is distinct from 'authenticated' or coalesce((cl->>'is_anonymous')::boolean, false) then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select lower(u.email), coalesce(u.raw_app_meta_data->>'provider', 'email') into em, prov
  from auth.users u where u.id = (cl->>'sub')::uuid and u.email is not null and u.email_confirmed_at is not null;
  if em is null then raise exception 'email_not_confirmed' using errcode = '28000'; end if;

  if not exists (select 1 from public.signups where lower(email) = em) then
    perform public.join_waitlist(p_city => coalesce(nullif(lower(trim(p_city)), ''), 'amsterdam'), p_first_name => null, p_email => em,
                                 p_source => case when prov = 'google' then 'google' else 'email-link' end);
  end if;
  update public.signups set email_verified_at = coalesce(email_verified_at, now()) where lower(email) = em;
  insert into public.rider_keys (email, how) values (em, case when prov = 'google' then 'google' else 'email-link' end) returning key into k;
  select plate, city into pl, cy from public.signups where lower(email) = em
  order by (city = lower(trim(coalesce(p_city, '')))) desc, created_at limit 1;
  return json_build_object('key', k, 'plate', pl, 'city', cy, 'city_name', (select name from public.cities where slug = cy),
    'onboarded', exists (select 1 from public.signups where lower(email) = em and (first_name is not null or sports <> '{}')));
end $$;

-- erase_email (from 0001), now also removing the browser keys and partner leads for that email
create or replace function public.erase_email(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int;
begin
  delete from public.signups where lower(email) = lower(trim(p_email)); get diagnostics a = row_count;
  delete from public.night_rsvps where lower(email) = lower(trim(p_email)); get diagnostics b = row_count;
  delete from public.rider_keys where lower(email) = lower(trim(p_email)); get diagnostics c = row_count;
  delete from public.partner_leads where lower(contact) = lower(trim(p_email)); get diagnostics d = row_count;
  return json_build_object('signups_deleted', a, 'rsvps_deleted', b, 'keys_deleted', c, 'partner_leads_deleted', d);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Who may call what. Postgres and Supabase let everyone run new functions by default; undo that.
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.hi8_client() from public, anon, authenticated;
revoke execute on function public.hi8_limit(text, text, int, interval) from public, anon, authenticated;
revoke execute on function public.hi8_email(uuid) from public, anon, authenticated;
revoke execute on function public.hi8_city_counts(text) from public, anon, authenticated;
revoke execute on function public.hi8_night_counts(text) from public, anon, authenticated;
revoke execute on function public.erase_email(text) from public, anon, authenticated;
revoke execute on function public.hi8_counts(text) from public;
revoke execute on function public.hi8_join(text, text, text, text) from public;
revoke execute on function public.hi8_profile(uuid, text, text[], jsonb, text, text, int, text) from public;
revoke execute on function public.hi8_rsvp(uuid, text, text, boolean, boolean, text) from public;
revoke execute on function public.hi8_city(uuid, text, boolean, boolean, text, text[]) from public;
revoke execute on function public.hi8_partner(text, text, text, text[]) from public;
revoke execute on function public.hi8_claim(text) from public, anon;

grant execute on function public.hi8_counts(text) to anon, authenticated;
grant execute on function public.hi8_join(text, text, text, text) to anon, authenticated;
grant execute on function public.hi8_profile(uuid, text, text[], jsonb, text, text, int, text) to anon, authenticated;
grant execute on function public.hi8_rsvp(uuid, text, text, boolean, boolean, text) to anon, authenticated;
grant execute on function public.hi8_city(uuid, text, boolean, boolean, text, text[]) to anon, authenticated;
grant execute on function public.hi8_partner(text, text, text, text[]) to anon, authenticated;
grant execute on function public.hi8_claim(text) to authenticated;
grant execute on function public.erase_email(text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Handy queries for the SQL editor (read-only; uncomment to run)
-- ---------------------------------------------------------------------------------------------
-- select city, plate, first_name, email, sports, hub, captain, source, ref, created_at from public.signups order by created_at desc;
-- select first_name, email, session, hub, photo_ok, created_at from public.night_rsvps order by created_at;
-- select * from public.partner_leads order by created_at desc;
-- select public.hi8_counts();
-- select public.erase_email('someone@example.com');   -- a "delete my data" request
