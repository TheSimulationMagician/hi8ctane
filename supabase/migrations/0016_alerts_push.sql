-- Hi8ctane 0016: an alert when it's exactly right, on your phone; "I'm in if 2 more"; trust (2.23).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0015. Safe to run again.
--
--   * WIND ALERTS: each rider sets their own conditions per sport: which spots, wind from/to, max gusts,
--     which days and hours, how long the window has to be (wind_alerts). The direction is checked per spot
--     (no offshore, only the directions that spot works in). The alert worker (scripts/alerts.mjs, run by
--     .github/workflows/alerts.yml every 10 minutes) reads the forecast with the same engine as the site
--     and sends ONE alert per rider, sport and day: the evening before (18-22h) or that morning (from 7h).
--   * PUSH: phones that turned notifications on are kept in push_subs. Everything that goes to a phone
--     waits in push_queue until the worker sends it (web push needs a signature the database can't make).
--     Crew emails (a new crew at your spot, called off, the reminder, the chat...) also go to the phone.
--   * EMAIL: the same alert by email if the rider wants it, with a stop link (and a List-Unsubscribe header).
--   * I'M IN IF 2 MORE: a crew can need a minimum. When the minimum is reached everyone hears "it's on".
--   * FORECAST DROPPED: the worker checks every crew today and tomorrow; if its window goes bad, the crew
--     gets one message and the captain can move it to the next good window (hi8_move_crew).
--   * HOW WAS IT: the morning after a session, one message asks how it was (a report on the crew, the day
--     after is allowed now). It stamps the rider's card.
--   * TRUST: a light rider profile (years riding, home spot, Instagram), sessions ridden, and no-shows the
--     captain marks (only captains see those). A phone number a rider shares with their crew.
--   * hi8_watchers: how many riders watch each spot (counts only, never who).
--
-- The one secret the worker needs, in GitHub (Settings > Secrets and variables > Actions):
--   SUPABASE_SECRET_KEY   Supabase > Project Settings > API Keys > Secret key (sb_secret_...)
-- The web push keys (VAPID) are made by the worker on its first run and kept here: the private half in
-- app_secrets (never leaves the database and the worker), the public half in app_settings (the site reads it).

-- ---------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.wind_alerts (
  email      text not null,
  city       text not null references public.cities (slug),
  sport      text not null check (sport in ('kite', 'wing', 'windsurf', 'surf', 'sup', 'mtb', 'mx')),
  spots      text[] not null default '{}' check (cardinality(spots) <= 20),
  min_kt     int check (min_kt is null or min_kt between 5 and 50),
  max_kt     int check (max_kt is null or max_kt between 8 and 60),
  gust_max   int check (gust_max is null or gust_max between 10 and 70),
  days       text not null default 'any' check (days in ('any', 'weekend', 'weekday')),
  from_h     int not null default 8 check (from_h between 5 and 21),
  to_h       int not null default 20 check (to_h between 7 and 23),
  min_hours  int not null default 2 check (min_hours between 1 and 6),
  min_score  int not null default 6 check (min_score between 4 and 9),
  by_push    boolean not null default true,
  by_email   boolean not null default true,
  token      uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (email, city, sport),
  check (to_h > from_h),
  check (max_kt is null or min_kt is null or max_kt > min_kt)
);

create table if not exists public.push_subs (
  endpoint   text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 800),
  email      text not null,
  p256dh     text not null check (char_length(p256dh) between 80 and 100),
  auth       text not null check (char_length(auth) between 16 and 30),
  ua         text check (ua is null or char_length(ua) <= 40),
  created_at timestamptz not null default now(),
  ok_at      timestamptz,
  fails      int not null default 0
);
create index if not exists push_subs_email on public.push_subs (email);

create table if not exists public.push_queue (
  id         bigint generated always as identity primary key,
  email      text not null,
  title      text not null check (char_length(title) <= 120),
  body       text not null check (char_length(body) <= 300),
  url        text,
  tag        text,
  dedupe     text unique,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  error      text
);
create index if not exists push_queue_unsent on public.push_queue (created_at) where sent_at is null;

-- one alert per rider, sport and day (and one forecast-drop, one "how was it" per crew and rider)
create table if not exists public.alert_sent (
  key   text primary key,
  email text not null,
  kind  text not null,
  at    timestamptz not null default now()
);

alter table public.crews add column if not exists min_riders int check (min_riders is null or min_riders between 2 and 8);
alter table public.crews add column if not exists min_met_at timestamptz;
alter table public.crews add column if not exists fx_flag_at timestamptz;
alter table public.crew_members add column if not exists phone text check (phone is null or phone ~ '^\+[0-9]{8,15}$');
alter table public.crew_members add column if not exists no_show boolean not null default false;
alter table public.signups add column if not exists years_riding int check (years_riding is null or years_riding between 0 and 60);
alter table public.signups add column if not exists home_spot text check (home_spot is null or home_spot ~ '^[a-z0-9-]{2,40}$');
alter table public.signups add column if not exists insta text check (insta is null or insta ~ '^[A-Za-z0-9._]{1,30}$');
alter table public.outbox add column if not exists unsub text;

alter table public.wind_alerts enable row level security;
alter table public.push_subs   enable row level security;
alter table public.push_queue  enable row level security;
alter table public.alert_sent  enable row level security;
revoke all on public.wind_alerts, public.push_subs, public.push_queue, public.alert_sent from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Push: what goes to a phone
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_has_push(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.push_subs where email = lower(p_email) and fails < 5);
$$;

create or replace function public.hi8_push(p_email text, p_title text, p_body text, p_url text default null, p_dedupe text default null, p_tag text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_email is null or not public.hi8_has_push(p_email) then return false; end if;
  insert into public.push_queue (email, title, body, url, tag, dedupe)
  values (lower(p_email), left(p_title, 120), left(p_body, 300), p_url, p_tag, p_dedupe)
  on conflict (dedupe) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- crew emails also reach the phone (first line of the email, the first link in it)
create or replace function public.hi8_outbox_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('new_crew', 'spot_crew', 'off', 'remind', 'squad_call', 'pay', 'in', 'chat', 'crew_on', 'moved') then
    perform public.hi8_push(new.to_email, new.subject, left(split_part(new.body, E'\n', 1), 300),
      substring(new.body from 'https?://[^[:space:]]+'), 'o:' || new.id, coalesce(new.kind || ':' || new.crew_id, new.kind));
  end if;
  return null;
end $$;
drop trigger if exists hi8_outbox_push on public.outbox;
create trigger hi8_outbox_push after insert on public.outbox for each row execute function public.hi8_outbox_push();

-- sends what's waiting, through Resend (from 0004) + a List-Unsubscribe header when the email has a stop link
create or replace function public.hi8_mail_flush() returns int
language plpgsql security definer set search_path = public as $$
declare
  k    text := public.hi8_secret('resend_api_key');
  frm  text := coalesce(public.hi8_secret('mail_from'), 'Hi8ctane <crews@hi8ctane.com>');
  o    public.outbox;
  rid  bigint;
  n    int := 0;
  msg  jsonb;
begin
  if k is null or k = '' then return 0; end if;
  for o in select * from public.outbox where sent_at is null and error is null and created_at > now() - interval '2 days'
           order by id limit 50 for update skip locked loop
    begin
      msg := jsonb_build_object('from', frm, 'to', jsonb_build_array(o.to_email), 'subject', o.subject, 'text', o.body, 'reply_to', 'hello@hi8ctane.com');
      if o.unsub is not null then msg := msg || jsonb_build_object('headers', jsonb_build_object('List-Unsubscribe', '<' || o.unsub || '>, <mailto:hello@hi8ctane.com?subject=stop>')); end if;
      execute 'select net.http_post(url := $1, body := $2, headers := $3)' into rid using
        'https://api.resend.com/emails', msg,
        jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json');
      update public.outbox set sent_at = now(), request_id = rid where id = o.id;
      n := n + 1;
    exception when others then
      update public.outbox set error = left(sqlerrm, 300) where id = o.id;
    end;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. What the website calls: alerts and push
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_wind_list(p_email text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('city', a.city, 'sport', a.sport, 'spots', a.spots, 'min_kt', a.min_kt, 'max_kt', a.max_kt,
    'gust_max', a.gust_max, 'days', a.days, 'from_h', a.from_h, 'to_h', a.to_h, 'min_hours', a.min_hours, 'min_score', a.min_score,
    'by_push', a.by_push, 'by_email', a.by_email) order by a.created_at), '[]'::json)
  from public.wind_alerts a where a.email = lower(p_email);
$$;

create or replace function public.hi8_wind_alert(p_key uuid, p_city text, p_sport text, p_rule jsonb default null, p_on boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare
  em text := public.hi8_email(p_key);
  sp text[];
  bad text;
begin
  perform public.hi8_limit('wind', p_key::text, 40, interval '10 minutes');
  if not exists (select 1 from public.cities where slug = p_city) then raise exception 'unknown_city' using errcode = '22023'; end if;
  if not p_on then
    delete from public.wind_alerts where email = em and city = p_city and sport = p_sport;
  else
    sp := coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p_rule->'spots', '[]'::jsonb)) x), '{}');
    select x into bad from unnest(sp) x where not exists (select 1 from public.spots s where s.slug = x and s.city = p_city and p_sport = any (s.sports)) limit 1;
    if bad is not null then raise exception 'no_spot' using errcode = '22023', hint = 'That spot isn''t in this region for this sport.'; end if;
    if cardinality(sp) = 0 then raise exception 'no_spots' using errcode = '22023', hint = 'Pick at least one spot.'; end if;
    if not coalesce((p_rule->>'by_push')::boolean, true) and not coalesce((p_rule->>'by_email')::boolean, true) then
      raise exception 'no_channel' using errcode = '22023', hint = 'Pick push, email or both.';
    end if;
    begin
      insert into public.wind_alerts (email, city, sport, spots, min_kt, max_kt, gust_max, days, from_h, to_h, min_hours, min_score, by_push, by_email)
      values (em, p_city, p_sport, sp, (p_rule->>'min_kt')::int, (p_rule->>'max_kt')::int, (p_rule->>'gust_max')::int,
              coalesce(p_rule->>'days', 'any'), coalesce((p_rule->>'from_h')::int, 8), coalesce((p_rule->>'to_h')::int, 20),
              coalesce((p_rule->>'min_hours')::int, 2), coalesce((p_rule->>'min_score')::int, 6),
              coalesce((p_rule->>'by_push')::boolean, true), coalesce((p_rule->>'by_email')::boolean, true))
      on conflict (email, city, sport) do update set spots = excluded.spots, min_kt = excluded.min_kt, max_kt = excluded.max_kt,
        gust_max = excluded.gust_max, days = excluded.days, from_h = excluded.from_h, to_h = excluded.to_h, min_hours = excluded.min_hours,
        min_score = excluded.min_score, by_push = excluded.by_push, by_email = excluded.by_email, updated_at = now();
    exception when check_violation then
      raise exception 'bad_rule' using errcode = '22023', hint = 'Those settings don''t fit together: check the wind and the hours.';
    end;
  end if;
  return json_build_object('alerts', public.hi8_wind_list(em), 'push', public.hi8_has_push(em));
end $$;

create or replace function public.hi8_wind_alerts(p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  return json_build_object('alerts', public.hi8_wind_list(em), 'push', public.hi8_has_push(em));
end $$;

create or replace function public.hi8_push_sub(p_key uuid, p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  perform public.hi8_limit('pushsub', p_key::text, 20, interval '10 minutes');
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 800 or p_p256dh !~ '^[A-Za-z0-9_-]{80,100}$' or p_auth !~ '^[A-Za-z0-9_-]{16,30}$' then
    raise exception 'bad_sub' using errcode = '22023', hint = 'This browser gave an odd push address. Try again.';
  end if;
  insert into public.push_subs (endpoint, email, p256dh, auth, ua) values (p_endpoint, em, p_p256dh, p_auth, left(p_ua, 40))
  on conflict (endpoint) do update set email = excluded.email, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fails = 0;
  return json_build_object('ok', true, 'push', true);
end $$;

create or replace function public.hi8_push_unsub(p_key uuid, p_endpoint text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  delete from public.push_subs where endpoint = p_endpoint and email = em;
  return json_build_object('ok', true, 'push', public.hi8_has_push(em));
end $$;

-- the stop link (from 0005) also stops wind alert emails (push stays, it's switched off on the phone)
create or replace function public.hi8_unsubscribe(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare a public.crew_alerts; w public.wind_alerts;
begin
  perform public.hi8_limit('unsub', coalesce(public.hi8_client(), 'none'), 30, interval '10 minutes');
  delete from public.crew_alerts where token = p_token returning * into a;
  if a.email is not null then return json_build_object('ok', true, 'stopped', true, 'sport', a.sport, 'city', a.city, 'kind', 'crews'); end if;
  select * into w from public.wind_alerts where token = p_token;
  if w.email is null then return json_build_object('ok', true, 'stopped', false); end if;
  if w.by_push and public.hi8_has_push(w.email) then update public.wind_alerts set by_email = false, updated_at = now() where token = p_token;
  else delete from public.wind_alerts where token = p_token; end if;
  return json_build_object('ok', true, 'stopped', w.by_email, 'sport', w.sport, 'city', w.city, 'kind', 'wind');
end $$;

-- how many riders watch each spot: an alert on it or a star. Counts only.
create or replace function public.hi8_watchers(p_city text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(spot, n), '{}'::json) from (
    select spot, count(distinct email) as n from (
      select unnest(a.spots) as spot, a.email from public.wind_alerts a where a.city = p_city
      union all
      select w.spot, w.email from public.spot_watch w join public.spots s on s.slug = w.spot and s.city = p_city
    ) x group by spot) y;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Crews: a minimum, moving a crew, the crew card
-- ---------------------------------------------------------------------------------------------
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
    'past', public.hi8_crew_past(c),
    'min', c.min_riders, 'min_met', c.min_riders is null or c.min_met_at is not null,
    'fx_flag', c.fx_flag_at is not null)
  from public.spots s where s.slug = c.spot;
$$;

-- the captain sets "only if N of us" (2-8 riders including them), or clears it
create or replace function public.hi8_crew_min(p_key uuid, p_code text, p_min int) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; n int;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if lower(c.host_email) <> em then raise exception 'not_host' using errcode = '42501', hint = 'Only the captain sets that.'; end if;
  if p_min is not null and (p_min < 2 or p_min > least(8, c.max_riders)) then raise exception 'bad_min' using errcode = '22023', hint = 'Between 2 and the crew size.'; end if;
  select count(*) into n from public.crew_members where crew_id = c.id;
  update public.crews set min_riders = p_min, min_met_at = case when p_min is not null and n >= p_min then coalesce(min_met_at, now()) else null end where id = c.id;
  return public.hi8_crew(c.code, p_key);
end $$;

-- the minimum is reached: everyone in the crew hears it's on (email, and the phone through the outbox)
create or replace function public.hi8_on_member_min() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.crews; n int; m record;
begin
  select * into c from public.crews where id = new.crew_id;
  if c.min_riders is null or c.min_met_at is not null or c.status <> 'on' then return null; end if;
  select count(*) into n from public.crew_members where crew_id = c.id;
  if n < c.min_riders then return null; end if;
  update public.crews set min_met_at = now() where id = c.id;
  insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'edit', 'It''s on: ' || n || ' going.');
  for m in select email from public.crew_members where crew_id = c.id loop
    perform public.hi8_mail(m.email, 'crew_on', 'It''s on · ' || public.hi8_crew_line(c),
      n || ' riders are in, so the crew is going: ' || public.hi8_crew_line(c) || '.' || E'\n\nThe crew, the cars and the chat: ' || public.hi8_crew_url(c),
      c.id, 'on:' || c.id || ':' || lower(m.email));
  end loop;
  return null;
end $$;
drop trigger if exists hi8_member_min on public.crew_members;
create trigger hi8_member_min after insert on public.crew_members for each row execute function public.hi8_on_member_min();

-- a crew is posted where you already had a wind alert today: you hear about the crew too (push, else email).
-- Not if a star or "new crews" email already tells you (that one reaches the phone through the outbox).
create or replace function public.hi8_on_new_crew_alerted() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.crews; a record; card jsonb; spn text;
begin
  select * into c from public.crews where id = new.id;
  if c.id is null or c.status <> 'on' then return null; end if;
  card := public.hi8_crew_card(c); spn := card->>'spot_name';
  for a in select w.email from public.wind_alerts w
           where w.city = c.city and w.sport = c.sport and c.spot = any (w.spots) and w.email <> lower(c.host_email)
             and exists (select 1 from public.alert_sent x where x.key = 'wind:' || w.email || ':' || c.sport || ':' || c.day)
             and not exists (select 1 from public.spot_watch sw where sw.email = w.email and sw.spot = c.spot)
             and not exists (select 1 from public.crew_alerts ca where ca.email = w.email and ca.city = c.city and ca.sport = c.sport) loop
    if not public.hi8_push(a.email, 'A crew is going · ' || spn, public.hi8_crew_line(c) || '. ' || (card->>'going') || ' going'
         || case when (card->>'seats_free')::int > 0 then ', ' || (card->>'seats_free') || ' seat' || case when (card->>'seats_free')::int = 1 then '' else 's' end || ' free' else '' end || '.',
         public.hi8_crew_url(c), 'ac:' || c.id || ':' || a.email, 'crew:' || c.code) then
      perform public.hi8_mail(a.email, 'alert_crew', 'A crew is going · ' || public.hi8_crew_line(c),
        (card->>'host') || ' posted a crew at ' || spn || ', where your alert said it''s on: ' || public.hi8_crew_line(c) || '.'
        || E'\n\nJoin in one tap: ' || public.hi8_crew_url(c), c.id, 'ac:' || c.id || ':' || a.email);
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists hi8_new_crew_alerted on public.crews;
create constraint trigger hi8_new_crew_alerted after insert on public.crews deferrable initially deferred
  for each row execute function public.hi8_on_new_crew_alerted();

-- the captain moves the crew (the forecast changed): new day and hours, everyone hears it
create or replace function public.hi8_move_crew(p_key uuid, p_code text, p_day date, p_start text, p_end text default null) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; st time; en time; m record;
begin
  perform public.hi8_limit('move', p_key::text, 10, interval '1 hour');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if lower(c.host_email) <> em then raise exception 'not_host' using errcode = '42501', hint = 'Only the captain moves the crew.'; end if;
  if c.status <> 'on' then raise exception 'crew_off' using errcode = '22023', hint = 'This crew is called off.'; end if;
  begin st := p_start::time; en := nullif(p_end, '')::time; exception when others then raise exception 'bad_time' using errcode = '22023'; end;
  if p_day < public.hi8_today(c.city) or p_day > public.hi8_today(c.city) + 13 then raise exception 'bad_day' using errcode = '22023', hint = 'Today or the next two weeks.'; end if;
  if en is not null and en <= st then raise exception 'bad_time' using errcode = '22023', hint = 'The end is before the start.'; end if;
  if p_day = public.hi8_today(c.city) and st < (public.hi8_city_now(c.city))::time - interval '30 minutes' then raise exception 'bad_time' using errcode = '22023', hint = 'That time has passed.'; end if;
  update public.crews set day = p_day, start_time = st, end_time = en, fx_flag_at = null,
    meet_time = case when meet_time is null then null else greatest(time '00:00', st - (c.start_time - c.meet_time)) end
  where id = c.id returning * into c;
  insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'edit', 'Moved to ' || to_char(c.day, 'Dy FMDD Mon') || ', ' || to_char(st, 'HH24:MI') || coalesce('–' || to_char(en, 'HH24:MI'), '') || ' by the captain');
  for m in select email from public.crew_members where crew_id = c.id and lower(email) <> em loop
    perform public.hi8_mail(m.email, 'moved', 'Moved · ' || public.hi8_crew_line(c),
      'The captain moved the crew to ' || public.hi8_crew_line(c) || '. Still in? Nothing to do. Can''t make it? Leave on the crew page.'
      || E'\n\n' || public.hi8_crew_url(c), c.id, 'moved:' || c.id || ':' || c.day || st || ':' || lower(m.email));
  end loop;
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_report (from 0005): also the day after, for "how was it"
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
  td  date;
begin
  perform public.hi8_limit('report', p_key::text, 12, interval '1 hour');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  select * into m from public.crew_members where crew_id = c.id and lower(email) = em;
  if m.crew_id is null then raise exception 'not_in_crew' using errcode = '42501', hint = 'Join the crew first.'; end if;
  td := public.hi8_today(c.city);
  if c.day <> td and c.day <> td - 1 then raise exception 'not_today' using errcode = '22023', hint = 'Reports are for the day of the crew (or the day after).'; end if;
  if p_verdict not in ('on', 'meh', 'off') then raise exception 'bad_verdict' using errcode = '22023'; end if;
  if kt is not null and (c.sport not in ('kite', 'wing') or kt < 3 or kt > 21) then raise exception 'bad_kite' using errcode = '22023'; end if;
  if p_ground is not null and (c.sport not in ('mtb', 'mx') or p_ground not in ('dry', 'tacky', 'muddy', 'wet')) then
    raise exception 'bad_ground' using errcode = '22023';
  end if;
  if c.day = td - 1 and exists (select 1 from public.spot_reports r where r.crew_id = c.id and r.email = em and r.at >= (c.day::timestamp at time zone (select tz from public.cities where slug = c.city))) then
    update public.spot_reports set verdict = p_verdict, kite = coalesce(kt, kite), ground = coalesce(p_ground, ground), note = coalesce(nt, note)
    where id = (select max(id) from public.spot_reports r where r.crew_id = c.id and r.email = em);
    return public.hi8_crew(c.code, p_key);
  end if;
  insert into public.spot_reports (crew_id, spot, sport, email, at, verdict, kite, ground, note)
  values (c.id, c.spot, c.sport, em, case when c.day = td then now() else coalesce((c.day + coalesce(c.end_time, c.start_time + interval '3 hours')::time)::timestamp at time zone (select tz from public.cities where slug = c.city), now()) end,
          p_verdict, kt, p_ground, nt);
  if c.day = td and not public.hi8_is_here(m, c) then
    update public.crew_members set here_at = now(), gone_at = null where crew_id = c.id and member_id = m.member_id;
  end if;
  insert into public.crew_messages (crew_id, email, kind, body)
  values (c.id, null, 'report', public.hi8_name(em, c.city) || case when c.day = td then ' at the spot: ' else ' says it was: ' end || upper(p_verdict)
          || coalesce(' · ' || rtrim(rtrim(to_char(kt, 'FM990.0'), '0'), '.') || ' m', '') || coalesce(' · ' || p_ground, '') || coalesce(' · ' || nt, ''));
  return public.hi8_crew(c.code, p_key);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Trust: profile, phone for the crew, sessions ridden, no-shows
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_rode(p_email text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.crews c join public.crew_members m on m.crew_id = c.id
  where lower(m.email) = lower(p_email) and c.status = 'on' and public.hi8_crew_past(c) and not m.no_show;
$$;

drop function if exists public.hi8_profile(uuid, boolean, int, text, text);
create or replace function public.hi8_rider_profile(p_key uuid, p_save boolean default false, p_years int default null, p_home_spot text default null, p_insta text default null) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); ig text := nullif(regexp_replace(trim(coalesce(p_insta, '')), '^@|^https?://(www\.)?instagram\.com/|/$', '', 'g'), '');
begin
  if p_save then
    perform public.hi8_limit('profile', p_key::text, 20, interval '10 minutes');
    if p_years is not null and (p_years < 0 or p_years > 60) then raise exception 'bad_years' using errcode = '22023', hint = 'Years riding: 0 to 60.'; end if;
    if p_home_spot is not null and not exists (select 1 from public.spots where slug = p_home_spot) then raise exception 'no_spot' using errcode = '22023'; end if;
    if ig is not null and ig !~ '^[A-Za-z0-9._]{1,30}$' then raise exception 'bad_insta' using errcode = '22023', hint = 'Just the Instagram name, like hi8ctane.'; end if;
    update public.signups set years_riding = p_years, home_spot = p_home_spot, insta = ig where lower(email) = em;
  end if;
  return (select json_build_object('years', s.years_riding, 'home_spot', s.home_spot, 'insta', s.insta, 'rode', public.hi8_rode(em))
          from public.signups s where lower(s.email) = em order by s.created_at limit 1);
end $$;

-- for crew members only: each rider's profile line, sessions ridden, the phone they shared; no-shows for the captain
create or replace function public.hi8_crew_people(p_key uuid, p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; boss boolean;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if not exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) then raise exception 'not_in_crew' using errcode = '42501'; end if;
  boss := lower(c.host_email) = em or public.hi8_is_captain(em);
  return (select coalesce(json_agg(json_build_object('member_id', m.member_id,
      'years', p.years_riding, 'home_spot', p.home_spot, 'home_spot_name', (select name from public.spots where slug = p.home_spot), 'insta', p.insta,
      'rode', public.hi8_rode(m.email), 'phone', m.phone, 'no_show', case when boss then m.no_show end,
      'no_shows', case when boss then (select count(*) from public.crew_members z where lower(z.email) = lower(m.email) and z.no_show) end)
      order by m.joined_at), '[]'::json)
    from public.crew_members m
    left join lateral (select * from public.signups s where lower(s.email) = lower(m.email) order by (s.city = c.city) desc, s.created_at limit 1) p on true
    where m.crew_id = c.id);
end $$;

create or replace function public.hi8_set_phone(p_key uuid, p_code text, p_phone text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  perform public.hi8_limit('phone', p_key::text, 20, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if ph = '' then ph := null;
  else
    if ph ~ '^00' then ph := '+' || substr(ph, 3); end if;
    if ph ~ '^06[0-9]{8}$' then ph := '+31' || substr(ph, 2); end if;      -- Dutch mobile
    if ph ~ '^[67][0-9]{8}$' then ph := '+34' || ph; end if;               -- Spanish mobile
    if ph !~ '^\+[0-9]{8,15}$' then raise exception 'bad_phone' using errcode = '22023', hint = 'A mobile number with the country code, like +31 6 1234 5678.'; end if;
  end if;
  update public.crew_members set phone = ph where crew_id = c.id and lower(email) = em;
  if not found then raise exception 'not_in_crew' using errcode = '42501'; end if;
  return public.hi8_crew_people(p_key, p_code);
end $$;

create or replace function public.hi8_no_show(p_key uuid, p_code text, p_member uuid, p_on boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  if lower(c.host_email) <> em then raise exception 'not_host' using errcode = '42501', hint = 'Only the captain marks no-shows.'; end if;
  if public.hi8_city_now(c.city) < c.day + c.start_time then raise exception 'too_early' using errcode = '22023', hint = 'After the session starts.'; end if;
  if c.day < public.hi8_today(c.city) - 3 then raise exception 'too_late' using errcode = '22023', hint = 'Up to 3 days after.'; end if;
  update public.crew_members set no_show = coalesce(p_on, true) where crew_id = c.id and member_id = p_member and lower(email) <> em;
  return public.hi8_crew_people(p_key, p_code);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. The worker (service role only): what to check, what to send, and what got sent
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_worker_jobs() returns json
language sql stable security definer set search_path = public as $$
  with r as (select a.*, public.hi8_has_push(a.email) as has_push from public.wind_alerts a),
  cr as (select c.* from public.crews c where c.status = 'on' and c.day between public.hi8_today(c.city) - 1 and public.hi8_today(c.city) + 2),
  sp as (select distinct s.* from public.spots s where s.active and (s.slug in (select unnest(spots) from r) or s.slug in (select spot from cr)))
  select json_build_object(
    'now', now(),
    'cities', (select coalesce(json_agg(json_build_object('slug', ci.slug, 'tz', ci.tz, 'today', public.hi8_today(ci.slug),
                 'now', to_char(public.hi8_city_now(ci.slug), 'YYYY-MM-DD"T"HH24:MI'))), '[]'::json) from public.cities ci where ci.slug in (select city from sp)),
    'spots', (select coalesce(json_agg(json_build_object('slug', s.slug, 'city', s.city, 'name', s.name, 'lat', s.lat, 'lon', s.lon, 'face', s.face,
                 'good_from', s.good_from, 'good_to', s.good_to, 'lake', s.lake, 'sports', s.sports)), '[]'::json) from sp s),
    'rules', (select coalesce(json_agg(json_build_object('email', r.email, 'city', r.city, 'sport', r.sport, 'spots', r.spots, 'min_kt', r.min_kt, 'max_kt', r.max_kt,
                 'gust_max', r.gust_max, 'days', r.days, 'from_h', r.from_h, 'to_h', r.to_h, 'min_hours', r.min_hours, 'min_score', r.min_score,
                 'push', r.by_push and r.has_push, 'mail', r.by_email or (r.by_push and not r.has_push), 'token', r.token,
                 'kg', 75)), '[]'::json) from r),
    'crews', (select coalesce(json_agg(public.hi8_crew_card(c) || jsonb_build_object('hub_name', (select h.name from public.hubs h where h.city = c.city and h.slug = c.meet_hub),
                 'rated', (select count(*) from public.alert_sent x where x.key like 'rate:' || c.code || ':%'))), '[]'::json) from cr c));
$$;

-- p_items: [{key, email, kind: 'wind', title, body, url, push, mail, subject, mailbody, token}]. Each key once, ever.
create or replace function public.hi8_alert_enqueue(p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0; k int; site text := coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com');
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.alert_sent (key, email, kind) values (it->>'key', lower(it->>'email'), coalesce(it->>'kind', 'wind')) on conflict do nothing;
    get diagnostics k = row_count;
    continue when k = 0;
    n := n + 1;
    if coalesce((it->>'push')::boolean, false) then
      perform public.hi8_push(it->>'email', it->>'title', it->>'body', it->>'url', 'a:' || (it->>'key'), it->>'kind');
    end if;
    if coalesce((it->>'mail')::boolean, false) then
      perform public.hi8_mail(it->>'email', coalesce(it->>'kind', 'wind'), coalesce(it->>'subject', it->>'title'),
        coalesce(it->>'mailbody', it->>'body') || E'\n\n' || coalesce(it->>'url', site)
        || case when it->>'token' is not null then E'\n\nStop these alert emails: ' || site || '/?stop=' || (it->>'token') || E'\nChange what you get alerts for: ' || site || '/#alerts' else '' end,
        null, 'a:' || (it->>'key'));
      if it->>'token' is not null then update public.outbox set unsub = site || '/?stop=' || (it->>'token') where dedupe = 'a:' || (it->>'key'); end if;
    end if;
  end loop;
  return n;
end $$;

-- the forecast went bad for a crew: one message in the crew, one to each rider (phone if they have it, else email)
create or replace function public.hi8_fx_drop(p_code text, p_line text, p_next text default null) returns int
language plpgsql security definer set search_path = public as $$
declare c public.crews; m record; n int := 0; url text;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found or c.status <> 'on' or c.fx_flag_at is not null then return 0; end if;
  update public.crews set fx_flag_at = now() where id = c.id;
  url := public.hi8_crew_url(c);
  insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'edit', 'Forecast dropped: ' || left(p_line, 120) || coalesce('. Next good window: ' || left(p_next, 80), ''));
  for m in select email from public.crew_members where crew_id = c.id loop
    if public.hi8_push(m.email, 'Forecast dropped · ' || coalesce((select name from public.spots where slug = c.spot), c.spot), left(p_line, 140) || '. Still on?', url, 'fx:' || c.id || ':' || lower(m.email), 'fx:' || c.code) then n := n + 1;
    else
      perform public.hi8_mail(m.email, 'fx', 'Forecast dropped · ' || public.hi8_crew_line(c),
        'The forecast for your crew dropped: ' || p_line || '.' || coalesce(E'\nNext good window: ' || p_next || '.', '')
        || E'\nThe captain can move the crew or call it off. Your call too: leave on the crew page if you''re out.' || E'\n\n' || url, c.id, 'fx:' || c.id || ':' || lower(m.email));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- the morning after: "how was it?" to each rider (phone if they have it, else email), once
create or replace function public.hi8_rate_prompt(p_code text) returns int
language plpgsql security definer set search_path = public as $$
declare c public.crews; m record; n int := 0; url text; spn text; k int;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found or c.status <> 'on' then return 0; end if;
  url := public.hi8_crew_url(c) || '#rate';
  spn := coalesce((select name from public.spots where slug = c.spot), c.spot);
  for m in select email from public.crew_members where crew_id = c.id and not no_show
           and not exists (select 1 from public.spot_reports r where r.crew_id = crew_members.crew_id and r.email = lower(crew_members.email)) loop
    insert into public.alert_sent (key, email, kind) values ('rate:' || c.code || ':' || lower(m.email), lower(m.email), 'rate') on conflict do nothing;
    get diagnostics k = row_count;
    continue when k = 0;
    n := n + 1;
    if not public.hi8_push(m.email, 'How was ' || spn || '?', 'One tap: ON, MEH or OFF. It goes on your rider card and helps the next crew.', url, 'rate:' || c.id || ':' || lower(m.email), 'rate:' || c.code) then
      perform public.hi8_mail(m.email, 'rate', 'How was ' || spn || '?',
        'One tap: ON, MEH or OFF. It goes on your rider card, and the next crew at ' || spn || ' sees it.' || E'\n\n' || url, c.id, 'rate:' || c.id || ':' || lower(m.email));
    end if;
  end loop;
  return n;
end $$;

-- what's waiting for phones, with where to send it
create or replace function public.hi8_push_pending(p_limit int default 200) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', q.id, 'title', q.title, 'body', q.body, 'url', q.url, 'tag', q.tag,
    'subs', (select coalesce(json_agg(json_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::json)
             from public.push_subs s where s.email = q.email and s.fails < 5)) order by q.id), '[]'::json)
  from (select * from public.push_queue where sent_at is null and error is null and created_at > now() - interval '6 hours' order by id limit p_limit) q;
$$;

create or replace function public.hi8_push_done(p_sent bigint[], p_ok text[] default '{}', p_gone text[] default '{}', p_failed text[] default '{}') returns int
language plpgsql security definer set search_path = public as $$
begin
  update public.push_queue set sent_at = now() where id = any (coalesce(p_sent, '{}'));
  update public.push_subs set ok_at = now(), fails = 0 where endpoint = any (coalesce(p_ok, '{}'));
  update public.push_subs set fails = fails + 1 where endpoint = any (coalesce(p_failed, '{}'));
  delete from public.push_subs where endpoint = any (coalesce(p_gone, '{}'));
  delete from public.push_queue where created_at < now() - interval '14 days';
  delete from public.alert_sent where at < now() - interval '30 days';
  return coalesce(cardinality(p_sent), 0);
end $$;

-- the web push key pair: made once by the worker, kept here. Returns the pair (service role only).
create or replace function public.hi8_vapid(p_public text default null, p_private text default null) returns json
language plpgsql security definer set search_path = public as $$
begin
  if p_public is not null and p_private is not null and p_public ~ '^[A-Za-z0-9_-]{80,90}$' and p_private ~ '^[A-Za-z0-9_-]{40,45}$' then
    insert into public.app_secrets (name, value) values ('vapid_private', p_private) on conflict (name) do nothing;
    if (select value from public.app_secrets where name = 'vapid_private') = p_private then
      insert into public.app_settings (key, value, public) values ('vapid_key', to_jsonb(p_public), true)
      on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
  end if;
  return json_build_object('public', (select value #>> '{}' from public.app_settings where key = 'vapid_key'),
                           'private', (select value from public.app_secrets where name = 'vapid_private'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Erasing a rider also removes their alerts and phones
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_erase_social(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(p_email));
begin
  delete from public.squad_members where lower(email) = em;
  delete from public.squads s where not exists (select 1 from public.squad_members m where m.squad_id = s.id);
  update public.squads set created_by = 'erased' where lower(created_by) = em;
  delete from public.spot_watch where email = em;
  delete from public.wind_alerts where email = em;
  delete from public.push_subs where email = em;
  delete from public.push_queue where email = em;
  delete from public.alert_sent where email = em;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. Who may call what
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.hi8_has_push(text) from public, anon, authenticated;
revoke execute on function public.hi8_push(text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.hi8_outbox_push() from public, anon, authenticated;
revoke execute on function public.hi8_mail_flush() from public, anon, authenticated;
revoke execute on function public.hi8_wind_list(text) from public, anon, authenticated;
revoke execute on function public.hi8_on_member_min() from public, anon, authenticated;
revoke execute on function public.hi8_on_new_crew_alerted() from public, anon, authenticated;
revoke execute on function public.hi8_rode(text) from public, anon, authenticated;
revoke execute on function public.hi8_erase_social(text) from public, anon, authenticated;
revoke execute on function public.hi8_crew_card(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_worker_jobs() from public, anon, authenticated;
revoke execute on function public.hi8_alert_enqueue(jsonb) from public, anon, authenticated;
revoke execute on function public.hi8_fx_drop(text, text, text) from public, anon, authenticated;
revoke execute on function public.hi8_rate_prompt(text) from public, anon, authenticated;
revoke execute on function public.hi8_push_pending(int) from public, anon, authenticated;
revoke execute on function public.hi8_push_done(bigint[], text[], text[], text[]) from public, anon, authenticated;
revoke execute on function public.hi8_vapid(text, text) from public, anon, authenticated;
grant execute on function public.hi8_vapid(text, text) to service_role;
grant execute on function public.hi8_worker_jobs() to service_role;
grant execute on function public.hi8_alert_enqueue(jsonb) to service_role;
grant execute on function public.hi8_fx_drop(text, text, text) to service_role;
grant execute on function public.hi8_rate_prompt(text) to service_role;
grant execute on function public.hi8_push_pending(int) to service_role;
grant execute on function public.hi8_push_done(bigint[], text[], text[], text[]) to service_role;

revoke execute on function public.hi8_wind_alert(uuid, text, text, jsonb, boolean) from public;
revoke execute on function public.hi8_wind_alerts(uuid) from public;
revoke execute on function public.hi8_push_sub(uuid, text, text, text, text) from public;
revoke execute on function public.hi8_push_unsub(uuid, text) from public;
revoke execute on function public.hi8_unsubscribe(uuid) from public;
revoke execute on function public.hi8_watchers(text) from public;
revoke execute on function public.hi8_crew_min(uuid, text, int) from public;
revoke execute on function public.hi8_move_crew(uuid, text, date, text, text) from public;
revoke execute on function public.hi8_report(uuid, text, text, numeric, text, text) from public;
revoke execute on function public.hi8_rider_profile(uuid, boolean, int, text, text) from public;
revoke execute on function public.hi8_crew_people(uuid, text) from public;
revoke execute on function public.hi8_set_phone(uuid, text, text) from public;
revoke execute on function public.hi8_no_show(uuid, text, uuid, boolean) from public;
grant execute on function public.hi8_wind_alert(uuid, text, text, jsonb, boolean) to anon, authenticated;
grant execute on function public.hi8_wind_alerts(uuid) to anon, authenticated;
grant execute on function public.hi8_push_sub(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.hi8_push_unsub(uuid, text) to anon, authenticated;
grant execute on function public.hi8_unsubscribe(uuid) to anon, authenticated;
grant execute on function public.hi8_watchers(text) to anon, authenticated;
grant execute on function public.hi8_crew_min(uuid, text, int) to anon, authenticated;
grant execute on function public.hi8_move_crew(uuid, text, date, text, text) to anon, authenticated;
grant execute on function public.hi8_report(uuid, text, text, numeric, text, text) to anon, authenticated;
grant execute on function public.hi8_rider_profile(uuid, boolean, int, text, text) to anon, authenticated;
grant execute on function public.hi8_crew_people(uuid, text) to anon, authenticated;
grant execute on function public.hi8_set_phone(uuid, text, text) to anon, authenticated;
grant execute on function public.hi8_no_show(uuid, text, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
