-- Hi8ctane day zero: founding plates, city waitlists and the Founding Night RSVP.
-- Run once in Supabase > SQL Editor (or `supabase db push`). Safe to run on an empty project.
-- The website talks to these tables only through the three functions at the bottom, called from
-- the server with the secret key. Row-level security is on and there are no policies, so the
-- public (anon) key can read or write nothing here.

create extension if not exists pgcrypto;

-- Cities: open ones take riders today; "soon" ones collect riders and captains until they hit the goal.
create table if not exists public.cities (
  slug           text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name           text not null,
  country        text not null,
  status         text not null default 'soon' check (status in ('open', 'soon')),
  riders_goal    int  not null default 25 check (riders_goal > 0),
  captains_goal  int  not null default 3  check (captains_goal > 0),
  plates         int  not null default 100 check (plates > 0),
  created_at     timestamptz not null default now()
);

insert into public.cities (slug, name, country, status) values
  ('amsterdam', 'Amsterdam', 'NL', 'open'),
  ('barcelona', 'Barcelona', 'ES', 'open'),
  ('lisbon',    'Lisbon',    'PT', 'soon'),
  ('tarifa',    'Tarifa',    'ES', 'soon'),
  ('berlin',    'Berlin',    'DE', 'soon')
on conflict (slug) do nothing;

-- One row per person per city. The first 100 in a city get a founding plate number, theirs for good.
create table if not exists public.signups (
  id               uuid primary key default gen_random_uuid(),
  city             text not null references public.cities (slug),
  first_name       text not null check (char_length(first_name) between 1 and 40),
  email            text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  hub              text check (hub is null or char_length(hub) <= 40),
  sports           text[] not null default '{}' check (sports <@ array['kite', 'wing', 'surf', 'sup', 'mtb', 'mx']::text[]),
  levels           jsonb not null default '{}'::jsonb check (jsonb_typeof(levels) = 'object'),
  captain          boolean not null default false,
  captain_sport    text check (captain_sport is null or captain_sport in ('kite', 'wing', 'surf', 'sup', 'mtb', 'mx')),
  captain_days     text[] not null default '{}' check (captain_days <@ array['weekdays', 'fri', 'sat', 'sun']::text[]),
  plate            int check (plate between 1 and 999),
  consent_updates  boolean not null default false,
  source           text check (source is null or char_length(source) <= 80),
  ref              text check (ref is null or char_length(ref) <= 40),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists signups_city_email on public.signups (city, lower(email));
create unique index if not exists signups_city_plate on public.signups (city, plate) where plate is not null;

-- Founding Night RSVPs. The waiver tick is required; the time it was given is kept.
create table if not exists public.night_rsvps (
  id          uuid primary key default gen_random_uuid(),
  event       text not null default 'founding-night-bcn' check (char_length(event) <= 60),
  first_name  text not null check (char_length(first_name) between 1 and 40),
  email       text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  session     text not null check (session in ('kite-wing', 'sup-surf', 'mtb', 'night-only')),
  hub         text not null check (hub in ('sants', 'gracia', 'sagrera', 'own')),
  waiver_at   timestamptz not null,
  photo_ok    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists night_rsvps_event_email on public.night_rsvps (event, lower(email));

alter table public.cities      enable row level security;
alter table public.signups     enable row level security;
alter table public.night_rsvps enable row level security;
revoke all on public.cities, public.signups, public.night_rsvps from anon, authenticated;

-- join_waitlist: add someone to a city (or update them if they're already in), hand out the next plate.
create or replace function public.join_waitlist(
  p_city text, p_first_name text, p_email text,
  p_hub text default null, p_sports text[] default '{}', p_levels jsonb default '{}'::jsonb,
  p_captain boolean default false, p_captain_sport text default null, p_captain_days text[] default '{}',
  p_consent boolean default false, p_source text default null, p_ref text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  c        public.cities;
  existing public.signups;
  next_plate int;
  out_plate  int;
  was_there  boolean := false;
begin
  select * into c from public.cities where slug = lower(trim(p_city));
  if not found then raise exception 'unknown_city' using errcode = 'P0002'; end if;

  -- one writer per city at a time, so two people can't get the same plate
  perform pg_advisory_xact_lock(hashtext('hi8-plates-' || c.slug));

  select * into existing from public.signups where city = c.slug and lower(email) = lower(trim(p_email));
  if found then
    was_there := true;
    update public.signups set
      first_name      = coalesce(nullif(trim(p_first_name), ''), first_name),
      hub             = coalesce(p_hub, hub),
      sports          = (select coalesce(array_agg(distinct s order by s), '{}') from unnest(sports || coalesce(p_sports, '{}')) s),
      levels          = levels || coalesce(p_levels, '{}'::jsonb),
      captain         = captain or coalesce(p_captain, false),
      captain_sport   = coalesce(p_captain_sport, captain_sport),
      captain_days    = (select coalesce(array_agg(distinct d order by d), '{}') from unnest(captain_days || coalesce(p_captain_days, '{}')) d),
      consent_updates = consent_updates or coalesce(p_consent, false),
      updated_at      = now()
    where id = existing.id
    returning plate into out_plate;
  else
    select coalesce(max(plate), 0) + 1 into next_plate from public.signups where city = c.slug;
    insert into public.signups (city, first_name, email, hub, sports, levels, captain, captain_sport, captain_days, plate, consent_updates, source, ref)
    values (c.slug, trim(p_first_name), lower(trim(p_email)), p_hub,
            (select coalesce(array_agg(distinct s order by s), '{}') from unnest(coalesce(p_sports, '{}')) s),
            coalesce(p_levels, '{}'::jsonb), coalesce(p_captain, false), p_captain_sport,
            (select coalesce(array_agg(distinct d order by d), '{}') from unnest(coalesce(p_captain_days, '{}')) d),
            case when next_plate <= c.plates then next_plate end,
            coalesce(p_consent, false), p_source, p_ref)
    returning plate into out_plate;
  end if;

  return json_build_object(
    'city', c.slug, 'city_name', c.name, 'status', c.status,
    'plate', out_plate, 'existing', was_there,
    'riders', (select count(*) from public.signups where city = c.slug),
    'captains', (select count(*) from public.signups where city = c.slug and captain),
    'riders_goal', c.riders_goal, 'captains_goal', c.captains_goal);
end $$;

-- rsvp_night: the Founding Night RSVP. No waiver tick, no RSVP.
create or replace function public.rsvp_night(
  p_first_name text, p_email text, p_session text, p_hub text,
  p_waiver boolean, p_photo boolean default false, p_event text default 'founding-night-bcn'
) returns json
language plpgsql security definer set search_path = public as $$
declare
  was_there boolean;
begin
  if coalesce(p_waiver, false) is not true then raise exception 'waiver_required' using errcode = '22023'; end if;
  select exists (select 1 from public.night_rsvps where event = p_event and lower(email) = lower(trim(p_email))) into was_there;
  insert into public.night_rsvps (event, first_name, email, session, hub, waiver_at, photo_ok)
  values (p_event, trim(p_first_name), lower(trim(p_email)), p_session, p_hub, now(), coalesce(p_photo, false))
  on conflict (event, lower(email)) do update set
    first_name = excluded.first_name, session = excluded.session, hub = excluded.hub,
    photo_ok = excluded.photo_ok, waiver_at = excluded.waiver_at, updated_at = now();
  return json_build_object('existing', was_there, 'going', (select count(*) from public.night_rsvps where event = p_event));
end $$;

-- public_counts: the only numbers the website shows. No names, no emails.
create or replace function public.public_counts(p_event text default 'founding-night-bcn') returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'cities', coalesce((select json_agg(json_build_object(
        'slug', c.slug, 'name', c.name, 'status', c.status,
        'riders', (select count(*) from public.signups s where s.city = c.slug),
        'captains', (select count(*) from public.signups s where s.city = c.slug and s.captain),
        'riders_goal', c.riders_goal, 'captains_goal', c.captains_goal,
        'plates_left', greatest(0, c.plates - (select count(*) from public.signups s where s.city = c.slug and s.plate is not null)))
      order by c.status, c.slug) from public.cities c), '[]'::json),
    'night', json_build_object('going', (select count(*) from public.night_rsvps r where r.event = p_event)));
$$;

-- erase_email: for a "delete my data" request (GDPR). Run it yourself from the SQL editor; the site never calls it.
create or replace function public.erase_email(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare a int; b int;
begin
  delete from public.signups where lower(email) = lower(trim(p_email)); get diagnostics a = row_count;
  delete from public.night_rsvps where lower(email) = lower(trim(p_email)); get diagnostics b = row_count;
  return json_build_object('signups_deleted', a, 'rsvps_deleted', b);
end $$;

-- Only the server (secret key = service_role) may call these. Supabase grants execute to the API roles by default.
revoke execute on function public.join_waitlist(text, text, text, text, text[], jsonb, boolean, text, text[], boolean, text, text) from public, anon, authenticated;
revoke execute on function public.rsvp_night(text, text, text, text, boolean, boolean, text) from public, anon, authenticated;
revoke execute on function public.public_counts(text) from public, anon, authenticated;
revoke execute on function public.erase_email(text) from public, anon, authenticated;
grant execute on function public.join_waitlist(text, text, text, text, text[], jsonb, boolean, text, text[], boolean, text, text) to service_role;
grant execute on function public.rsvp_night(text, text, text, text, boolean, boolean, text) to service_role;
grant execute on function public.public_counts(text) to service_role;
grant execute on function public.erase_email(text) to service_role;
