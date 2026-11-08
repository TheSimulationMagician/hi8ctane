-- Hi8ctane 0006: plans and the ride fee (2.9).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0005. Safe to run again.
--
-- What it adds:
--   * plans: days out you can book with others (an MX day at Martorelles, the cable parks). They live in
--     public.plans, so you add, edit or switch them off in Supabase > Table Editor, no code needed.
--     "I'm in" on a plan goes to public.plan_leads (and an email to the team once emails are on).
--   * the ride fee, shown in the savings maths: 15% on top of a rider's share of the car, free during
--     the pilot. Nothing is charged: fee_live stays false until payments run through Hi8ctane.
--       update public.app_settings set value = '12' where key = 'ride_fee_pct';
--   * a spot for Moto Club Martorelles (MX), 20 minutes from Barcelona

-- ---------------------------------------------------------------------------------------------
-- 1. The ride fee (shown, not charged)
-- ---------------------------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('ride_fee_pct', '15'),
  ('fee_live',     'false')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 2. Moto Club Martorelles
-- ---------------------------------------------------------------------------------------------
insert into public.spots (slug, city, name, lat, lon, sports, face, good_from, good_to, lake, note, sort, maps) values
  ('martorelles-mx', 'barcelona', 'MX Martorelles', 41.537, 2.231, '{mx}', null, null, null, false,
   'Moto Club Martorelles, Carrer Verneda. Open Saturday 9:00-14:00 and Wednesday 16:00-20:00 (check with the club). Licence or day insurance needed.', 9, 'Moto Club Martorelles')
on conflict (slug) do update set city = excluded.city, name = excluded.name, lat = excluded.lat, lon = excluded.lon, sports = excluded.sports,
  note = excluded.note, sort = excluded.sort, maps = excluded.maps, active = true;
update public.spots set sort = 10 where slug = 'roccos-ranch';
update public.spots set sort = 11 where slug = 'vallgorguina-mx';
update public.spots set sort = 12 where slug = 'bellpuig-mx';

-- ---------------------------------------------------------------------------------------------
-- 3. Plans
-- ---------------------------------------------------------------------------------------------
create table if not exists public.plans (
  slug        text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  city        text not null references public.cities (slug),
  kind        text not null check (kind in ('mx', 'mtb', 'kite', 'wing', 'surf', 'sup', 'wake', 'other')),
  title       text not null check (char_length(title) between 2 and 60),
  place       text not null check (char_length(place) between 2 and 80),
  blurb       text not null check (char_length(blurb) <= 400),
  price_from  numeric(7, 2) check (price_from is null or price_from >= 0),
  price_note  text check (price_note is null or char_length(price_note) <= 160),
  includes    text[] not null default '{}',
  hours       text check (hours is null or char_length(hours) <= 120),
  spot        text references public.spots (slug),     -- set it and the plan gets "start a crew for it"
  maps        text check (maps is null or char_length(maps) <= 120),
  url         text check (url is null or url ~ '^https://'),
  badge       text check (badge is null or char_length(badge) <= 24),
  sort        int not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
create table if not exists public.plan_leads (
  id          bigint generated always as identity primary key,
  plan        text not null references public.plans (slug) on delete cascade,
  email       text not null,
  day         date,
  people      int not null default 1 check (people between 1 and 12),
  note        text check (note is null or char_length(note) <= 280),
  created_at  timestamptz not null default now(),
  unique (plan, email)
);
alter table public.plans enable row level security;
alter table public.plan_leads enable row level security;
revoke all on public.plans, public.plan_leads from anon, authenticated;

-- What's checked: Moto Club Martorelles' own listing (adult practice €25, day insurance €30, open Saturday
-- mornings and Wednesday afternoons). Bike and gear hire is not something the club lists: we line it up
-- with a local shop for the riders who ask, so the plan says so. The cable parks don't publish prices.
insert into public.plans (slug, city, kind, title, place, blurb, price_from, price_note, includes, hours, spot, maps, url, badge, sort) values
  ('mx-day-martorelles', 'barcelona', 'mx', 'MX day, bike + gear', 'Moto Club Martorelles',
   'Never ridden a motocross bike, or yours is in pieces? A morning on the Martorelles track, 20 minutes from Barcelona. Bring a mate or join others going the same day: the car and the day cost less shared.',
   25, 'Track €25 + day insurance €30 (club prices, pay there). Bike + gear hire: we line it up with a local shop, priced when you ask.',
   '{"Track practice","Day insurance","Bike + gear hire on request"}', 'Saturday 9:00-14:00 · Wednesday 16:00-20:00',
   'martorelles-mx', 'Moto Club Martorelles', 'https://www.mxcircuit.es/en/tracks/moto-club-martorelles', 'NEW', 1),
  ('bcp-cable', 'barcelona', 'wake', 'Wakeboard cable session', 'BCP Barcelona Cable Park · Fòrum',
   'Two cables in the city at Parc del Fòrum: a 130 m one for first-timers and a 160 m one with kickers and boxes. A 60-minute pass is shared by up to four, so it''s made for a crew.',
   null, 'Passes of 15, 30 and 60 minutes: ask the park for prices. Board and wetsuit hire there.',
   '{"Beginner cable","Kickers + boxes","60-minute pass for up to 4"}', 'Every day, 10:00 to 20:00 (21:00 in summer)',
   null, 'BCP Barcelona Cable Park, Parc del Fòrum', 'https://www.yumping.com/en/water-sports/bcp-barcelona-cable-park--e19732731', 'IN TOWN', 2),
  ('olimpic-cable', 'barcelona', 'wake', 'First time on a cable', 'Olimpic Cable Park · Castelldefels',
   'On the Canal Olímpic in Castelldefels. "Little Bro" is a 110 m beginner cable that starts slow, stops when you fall, with an instructor watching just you. Kite crews: it''s next to the beach for no-wind days.',
   null, 'Ask the park for prices. Bring your own board, or hire there.',
   '{"110 m beginner cable","Instructor on the dock","Next to Castelldefels beach"}', null,
   null, 'Olimpic Cable Park, Castelldefels', 'https://www.yumping.com/en/water-sports/olimpic-cable-park--e19724997', 'NO-WIND DAY', 3)
on conflict (slug) do update set city = excluded.city, kind = excluded.kind, title = excluded.title, place = excluded.place, blurb = excluded.blurb,
  price_from = excluded.price_from, price_note = excluded.price_note, includes = excluded.includes, hours = excluded.hours, spot = excluded.spot,
  maps = excluded.maps, url = excluded.url, badge = excluded.badge, sort = excluded.sort, updated_at = now();

-- hi8_plans: the plans in a city, how many are in for each (no names), and whether you are
create or replace function public.hi8_plans(p_city text default null, p_key uuid default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare em text;
begin
  if p_key is not null then select lower(email) into em from public.rider_keys where key = p_key; end if;
  return (select coalesce(json_agg(json_build_object(
      'slug', p.slug, 'city', p.city, 'kind', p.kind, 'title', p.title, 'place', p.place, 'blurb', p.blurb,
      'price_from', p.price_from, 'price_note', p.price_note, 'includes', p.includes, 'hours', p.hours,
      'spot', p.spot, 'maps', p.maps, 'url', p.url, 'badge', p.badge,
      'interested', (select count(*) from public.plan_leads l where l.plan = p.slug and l.created_at > now() - interval '60 days'),
      'mine', (select json_build_object('day', l.day, 'people', l.people) from public.plan_leads l where l.plan = p.slug and l.email = em))
    order by p.sort, p.slug), '[]'::json)
    from public.plans p where p.active and (p_city is null or p.city = p_city));
end $$;

-- hi8_plan_interest: "I'm in" on a plan. With a browser key, as that rider; with an email, it signs you up
-- too (founding plate), like alerts do. Again on the same plan updates the day and the number of people.
create or replace function public.hi8_plan_interest(
  p_plan text, p_key uuid default null, p_email text default null, p_day date default null,
  p_people int default 1, p_note text default null, p_source text default null, p_ref text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare p public.plans; em text; j json := null; first boolean;
begin
  select * into p from public.plans where slug = p_plan and active;
  if p.slug is null then raise exception 'no_plan' using errcode = '22023', hint = 'That plan isn''t on any more.'; end if;
  perform public.hi8_limit('plan', coalesce(public.hi8_client(), 'none'), 20, interval '10 minutes');
  if p_day is not null and (p_day < public.hi8_today(p.city) or p_day > public.hi8_today(p.city) + 90) then
    raise exception 'bad_day' using errcode = '22023', hint = 'Pick a day in the next three months.';
  end if;
  if p_people is null or p_people < 1 or p_people > 12 then raise exception 'bad_people' using errcode = '22023', hint = 'Between 1 and 12 people.'; end if;
  if p_key is not null then em := public.hi8_email(p_key);
  else
    j := public.hi8_join(p_email, p.city, coalesce(p_source, 'plan'), p_ref);
    em := lower(trim(p_email));
  end if;
  first := not exists (select 1 from public.plan_leads where plan = p.slug and email = em);
  insert into public.plan_leads (plan, email, day, people, note) values (p.slug, em, p_day, p_people, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (plan, email) do update set day = excluded.day, people = excluded.people, note = excluded.note, created_at = now();
  if first then
    perform public.hi8_mail(coalesce(public.hi8_secret('team_email'), 'hello@hi8ctane.com'), 'plan_lead',
      'Plan: ' || p.title || ' · ' || p_people || ' going' || coalesce(' · ' || to_char(p_day, 'Dy FMDD Mon'), ''),
      public.hi8_name(em, p.city) || ' (' || em || ') is in for "' || p.title || '" at ' || p.place
        || coalesce(E'\nDay: ' || to_char(p_day, 'Day FMDD Month'), E'\nDay: any') || E'\nPeople: ' || p_people
        || coalesce(E'\nNote: ' || nullif(trim(coalesce(p_note, '')), ''), ''),
      null, 'plan:' || p.slug || ':' || em);
  end if;
  return (coalesce(j::jsonb, '{}'::jsonb) || jsonb_build_object('ok', true, 'plan', p.slug,
    'interested', (select count(*) from public.plan_leads l where l.plan = p.slug and l.created_at > now() - interval '60 days')))::json;
end $$;

-- hi8_plan_leave: not going after all
create or replace function public.hi8_plan_leave(p_key uuid, p_plan text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  delete from public.plan_leads where plan = p_plan and email = em;
  return json_build_object('ok', true, 'plan', p_plan,
    'interested', (select count(*) from public.plan_leads l where l.plan = p_plan and l.created_at > now() - interval '60 days'));
end $$;

-- erase_email (from 0005) + plan leads
create or replace function public.erase_email(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; em text := lower(trim(p_email));
begin
  update public.crews set status = 'off', off_reason = 'The captain left Hi8ctane', host_email = 'erased' where lower(host_email) = em;
  delete from public.crew_members where lower(email) = em; get diagnostics e = row_count;
  update public.crew_messages set email = null, kind = 'edit', body = '(message removed)' where lower(email) = em;
  update public.spot_reports set email = null, note = null where lower(email) = em;
  delete from public.crew_alerts where email = em; get diagnostics h = row_count;
  delete from public.plan_leads where email = em; get diagnostics i = row_count;
  delete from public.city_requests where lower(email) = em; get diagnostics f = row_count;
  delete from public.signups where lower(email) = em; get diagnostics a = row_count;
  delete from public.night_rsvps where lower(email) = em; get diagnostics b = row_count;
  delete from public.rider_keys where lower(email) = em; get diagnostics c = row_count;
  delete from public.partner_leads where lower(contact) = em; get diagnostics d = row_count;
  delete from public.outbox where to_email = em; get diagnostics g = row_count;
  return json_build_object('signups_deleted', a, 'rsvps_deleted', b, 'keys_deleted', c, 'partner_leads_deleted', d,
                           'crew_memberships_deleted', e, 'city_requests_deleted', f, 'emails_deleted', g, 'alerts_deleted', h,
                           'plan_leads_deleted', i);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Who may call what
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.erase_email(text) from public, anon, authenticated;
revoke execute on function public.hi8_plans(text, uuid) from public;
revoke execute on function public.hi8_plan_interest(text, uuid, text, date, int, text, text, text) from public;
revoke execute on function public.hi8_plan_leave(uuid, text) from public;
grant execute on function public.hi8_plans(text, uuid) to anon, authenticated;
grant execute on function public.hi8_plan_interest(text, uuid, text, date, int, text, text, text) to anon, authenticated;
grant execute on function public.hi8_plan_leave(uuid, text) to anon, authenticated;
grant execute on function public.erase_email(text) to service_role;

-- Who's in for what, from the SQL editor:
--   select l.created_at, l.plan, l.email, l.day, l.people, l.note from public.plan_leads l order by l.created_at desc;
-- Add a plan: Table Editor > plans > Insert row (slug, city, kind, title, place, blurb; the rest is optional).

notify pgrst, 'reload schema';
