-- Hi8ctane 0004: the core loop works for real (2.7.3).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001, 0002 and 0003. Safe to run again.
--
-- What it adds:
--   * captains: approve someone once and they can start crews in any city
--       select public.approve_captain('their@email.com');
--   * joining from a crew link in one go: email, rider name, level, seat (hi8_quick_join)
--   * settling up: the driver enters what the car cost and a payment link (Tikkie, Revolut, PayPal, bunq,
--     Wise, Monzo, Rabobank, ING); riders in that car see their share and tick "paid"
--   * emails: to the captain when someone joins or leaves, to the crew when it's called off, a chat
--     digest, the driver's payment request, a reminder the evening before, a welcome with the plate.
--     They wait in public.outbox until you connect Resend (section 6 at the bottom), then go out
--     every minute.
--   * client_errors: what breaks on riders' phones, so we can fix it

-- ---------------------------------------------------------------------------------------------
-- 1. Captains: approved once, any city
-- ---------------------------------------------------------------------------------------------
drop function if exists public.approve_captain(text, text, boolean);
create or replace function public.approve_captain(p_email text, p_city text default null, p_ok boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.signups set captain_approved = coalesce(p_ok, true), captain = captain or coalesce(p_ok, true)
  where lower(email) = lower(trim(p_email)) and (p_city is null or city = lower(trim(p_city)));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no_signup' using errcode = 'P0002', hint = 'No sign-up with that email yet: sign up on hi8ctane.com first.'; end if;
  return json_build_object('ok', true, 'email', lower(trim(p_email)), 'rows', n, 'captain_approved', coalesce(p_ok, true));
end $$;

create or replace function public.hi8_is_captain(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.signups where lower(email) = lower(p_email) and captain_approved);
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Settling up, emails, errors: tables
-- ---------------------------------------------------------------------------------------------
alter table public.crew_members add column if not exists pay_link text check (pay_link is null or char_length(pay_link) <= 300);
alter table public.crew_members add column if not exists trip_cost numeric(7,2) check (trip_cost is null or trip_cost between 0 and 500);
alter table public.crew_members add column if not exists paid_at timestamptz;

create table if not exists public.outbox (
  id          bigint generated always as identity primary key,
  to_email    text not null,
  kind        text not null,
  subject     text not null,
  body        text not null,
  crew_id     uuid,
  dedupe      text unique,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  request_id  bigint,
  error       text
);
create index if not exists outbox_unsent on public.outbox (created_at) where sent_at is null;

create table if not exists public.client_errors (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  screen   text,
  message  text,
  stack    text,
  ua       text,
  who      text
);

alter table public.outbox        enable row level security;
alter table public.client_errors enable row level security;
revoke all on public.outbox, public.client_errors from anon, authenticated;

insert into public.app_secrets (name, value) values
  ('mail_from', 'Hi8ctane <crews@hi8ctane.com>'),
  ('site_url', 'https://hi8ctane.com')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_secret(p_name text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using p_name;
  exception when others then v := null;   -- no Vault (local tests)
  end;
  return coalesce(v, (select value from public.app_secrets where name = p_name));
end $$;

-- "Kite · Wijk aan Zee · Wed 5 Nov, 13:30"
create or replace function public.hi8_crew_line(c public.crews) returns text
language sql stable security definer set search_path = public as $$
  select initcap(c.sport) || ' · ' || coalesce((select name from public.spots where slug = c.spot), c.spot) || ' · '
         || to_char(c.day, 'Dy FMDD Mon') || ', ' || to_char(c.start_time, 'HH24:MI');
$$;

create or replace function public.hi8_crew_url(c public.crews) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com') || '/B27-Crew.dc.html?c=' || c.code;
$$;

create or replace function public.hi8_mail(p_to text, p_kind text, p_subject text, p_body text, p_crew uuid default null, p_dedupe text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_to is null or p_to = 'erased' then return; end if;
  insert into public.outbox (to_email, kind, subject, body, crew_id, dedupe)
  values (lower(p_to), p_kind, left(p_subject, 200),
          p_body || E'\n\n-- \nHi8ctane · same-day crews · ' || coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com')
                 || E'\nEvery session is your own call. Reply to this email to reach us.',
          p_crew, p_dedupe)
  on conflict (dedupe) do nothing;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. What the website calls (new and changed)
-- ---------------------------------------------------------------------------------------------

-- hi8_crew (from 0003) + payment details for members
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
    out := out || jsonb_build_object('host_is_me', lower(c.host_email) = em, 'captain', public.hi8_is_captain(em));
    if mine.crew_id is not null then
      out := out || jsonb_build_object(
        'me', jsonb_build_object('member_id', mine.member_id, 'level', mine.level, 'getting', mine.getting, 'seats', mine.seats, 'car_with', mine.car_with,
                                 'trip_cost', mine.trip_cost, 'pay_link', mine.pay_link, 'paid', mine.paid_at is not null),
        'meet_note', c.meet_note,
        'members', (select coalesce(jsonb_agg(jsonb_build_object(
            'member_id', m.member_id, 'name', public.hi8_name(m.email, c.city), 'plate', public.hi8_plate(m.email, c.city),
            'level', m.level, 'getting', m.getting, 'seats', m.seats, 'car_with', m.car_with,
            'host', lower(m.email) = lower(c.host_email), 'me', lower(m.email) = em,
            'trip_cost', m.trip_cost, 'pay_link', m.pay_link, 'paid', m.paid_at is not null,
            'share', case when m.getting = 'drive' and m.trip_cost is not null then
                       round(m.trip_cost / (1 + (select count(*) from public.crew_members p where p.crew_id = c.id and p.car_with = m.member_id)), 2) end
          ) order by m.joined_at), '[]'::jsonb)
          from public.crew_members m where m.crew_id = c.id),
        'messages', (select count(*) from public.crew_messages x where x.crew_id = c.id));
    end if;
  end if;
  return out::json;
end $$;

-- hi8_start_crew (from 0003): any approved captain, in any city (they get that city's plate if they have none)
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
  me  public.signups;
begin
  perform public.hi8_limit('start', p_key::text, 10, interval '1 day');
  select * into s from public.spots where slug = p_spot and active;
  if not found then raise exception 'unknown_spot' using errcode = '22023'; end if;
  if not public.hi8_is_captain(em) then
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
  if not exists (select 1 from public.signups where lower(email) = em and city = s.city) then
    select * into me from public.signups where lower(email) = em order by created_at limit 1;
    perform public.join_waitlist(p_city => s.city, p_first_name => me.first_name, p_email => em,
                                 p_sports => coalesce(me.sports, '{}'), p_levels => coalesce(me.levels, '{}'::jsonb), p_source => 'captain');
  end if;

  insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, meet_note, note, host_email)
  values (s.city, p_sport, s.slug, p_day, st, en, coalesce(p_levels, 'all'), coalesce(p_max, 8), p_meet_hub, mt,
          nullif(left(trim(coalesce(p_meet_note, '')), 140), ''), nullif(left(trim(coalesce(p_note, '')), 280), ''), em)
  returning * into c;
  insert into public.crew_members (crew_id, email, level, getting, seats)
  values (c.id, em, coalesce(p_level, 'regular'), coalesce(p_getting, 'own'), case when p_getting = 'drive' then greatest(0, least(7, coalesce(p_seats, 0))) else 0 end);
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_quick_join: someone opens a crew link with no account: email, rider name, level, how they get there.
-- Signs them up (with that city's plate), names them and puts them in the crew, all at once.
create or replace function public.hi8_quick_join(
  p_email text, p_name text, p_code text, p_level text, p_getting text default 'own', p_seats int default 0,
  p_car_with uuid default null, p_source text default null, p_ref text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  c   public.crews;
  j   json;
  k   uuid;
  nm  text := nullif(regexp_replace(trim(coalesce(p_name, '')), '[[:cntrl:]]', '', 'g'), '');
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023', hint = 'This crew link doesn''t exist.'; end if;
  if nm is null then raise exception 'name_required' using errcode = '22023', hint = 'Add a rider name: it''s what the crew sees.'; end if;
  j := public.hi8_join(p_email, c.city, coalesce(p_source, 'crew-link'), p_ref);
  k := (j->>'key')::uuid;
  -- a returning rider keeps the name they already have
  if not exists (select 1 from public.signups where lower(email) = lower(trim(p_email)) and first_name is not null) then
    perform public.hi8_profile(k, nm);
  end if;
  return (public.hi8_join_crew(k, c.code, p_level, p_getting, p_seats, p_car_with)::jsonb
          || jsonb_build_object('key', k, 'plate', j->'plate', 'city', j->'city', 'existing', j->'existing'))::json;
end $$;

-- hi8_settle: a driver says what the car cost (fuel + parking) and where to pay
create or replace function public.hi8_settle(p_key uuid, p_code text, p_cost numeric, p_link text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  em   text := public.hi8_email(p_key);
  c    public.crews;
  d    public.crew_members;
  lk   text := nullif(trim(coalesce(p_link, '')), '');
  n    int;
  sh   numeric;
  p    record;
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  select * into d from public.crew_members where crew_id = c.id and lower(email) = em;
  if d.crew_id is null or d.getting <> 'drive' then raise exception 'not_driver' using errcode = '42501', hint = 'Only drivers add what their car cost.'; end if;
  if p_cost is null or p_cost < 0 or p_cost > 500 then raise exception 'bad_cost' using errcode = '22023', hint = 'Between €0 and €500 for the car.'; end if;
  if lk is not null and lk !~* '^https://(tikkie\.me|(www\.)?revolut\.me|(www\.)?paypal\.me|bunq\.me|(www\.)?wise\.com|monzo\.me|betaalverzoek\.rabobank\.nl|(www\.)?ing\.nl)/[^[:space:]<>"]+$' then
    raise exception 'bad_link' using errcode = '22023', hint = 'Paste a Tikkie, Revolut, PayPal, bunq, Wise, Monzo, Rabobank or ING payment link.';
  end if;
  update public.crew_members set trip_cost = round(p_cost, 2), pay_link = lk where crew_id = c.id and member_id = d.member_id;
  select count(*) into n from public.crew_members where crew_id = c.id and car_with = d.member_id;
  sh := round(p_cost / (1 + n), 2);
  insert into public.crew_messages (crew_id, email, kind, body)
  values (c.id, null, 'edit', public.hi8_name(em, c.city) || '''s car: €' || to_char(p_cost, 'FM9990.00') || ', €' || to_char(sh, 'FM9990.00') || ' each' || case when lk is not null then '. Pay link on the crew page.' else '.' end);
  for p in select m.email from public.crew_members m where m.crew_id = c.id and m.car_with = d.member_id and m.paid_at is null loop
    perform public.hi8_mail(p.email, 'pay', 'Pay ' || public.hi8_name(em, c.city) || ' €' || to_char(sh, 'FM9990.00') || ' for the ride',
      'Your share of ' || public.hi8_name(em, c.city) || '''s car (' || public.hi8_crew_line(c) || '): €' || to_char(sh, 'FM9990.00') || '.'
      || case when lk is not null then E'\n\nPay here: ' || lk else E'\n\nSettle it with the driver.' end
      || E'\n\nTick "paid" on the crew page when it''s done: ' || public.hi8_crew_url(c), c.id,
      'pay:' || c.id || ':' || lower(p.email) || ':' || to_char(p_cost, 'FM9990.00'));
  end loop;
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_paid: a rider ticks that they paid their driver (or unticks it)
create or replace function public.hi8_paid(p_key uuid, p_code text, p_paid boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare
  em text := public.hi8_email(p_key);
  c  public.crews;
  n  int;
begin
  perform public.hi8_limit('edit', p_key::text, 120, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  update public.crew_members set paid_at = case when coalesce(p_paid, true) then coalesce(paid_at, now()) end
  where crew_id = c.id and lower(email) = em and car_with is not null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no_ride' using errcode = '22023', hint = 'You''re not riding in anyone''s car in this crew.'; end if;
  return public.hi8_crew(c.code, p_key);
end $$;

-- hi8_log_error: the website reports what broke (no names, no emails; rate-limited)
create or replace function public.hi8_log_error(p_screen text, p_message text, p_stack text default null, p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.hi8_limit('error', coalesce(public.hi8_client(), 'none'), 20, interval '10 minutes');
  insert into public.client_errors (screen, message, stack, ua, who)
  values (left(p_screen, 60), left(p_message, 500), left(p_stack, 2000), left(p_ua, 300), left(public.hi8_client(), 12));
  if random() < 0.02 then delete from public.client_errors where at < now() - interval '30 days'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Emails: queued by what happens in the database
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_on_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c  public.crews;
  r  public.crew_members := case when tg_op = 'DELETE' then old else new end;
  n  int;
begin
  select * into c from public.crews where id = r.crew_id;
  if c.id is null or lower(r.email) = lower(c.host_email) then return null; end if;
  select count(*) into n from public.crew_members where crew_id = c.id;
  if tg_op = 'INSERT' then
    perform public.hi8_mail(c.host_email, 'joined', public.hi8_name(r.email, c.city) || ' joined your crew · ' || public.hi8_crew_line(c),
      public.hi8_name(r.email, c.city) || ' (' || r.level || ', ' || case r.getting when 'seat' then 'needs a seat' when 'drive' then 'drives, ' || r.seats || ' free seats' else 'own way' end
      || ') joined ' || public.hi8_crew_line(c) || '. ' || n || ' of ' || c.max_riders || E' going.\n\nThe crew: ' || public.hi8_crew_url(c),
      c.id, 'joined:' || c.id || ':' || lower(r.email));
    perform public.hi8_mail(r.email, 'in', 'You''re in · ' || public.hi8_crew_line(c),
      'You''re in: ' || public.hi8_crew_line(c) || ', with captain ' || public.hi8_name(c.host_email, c.city) || '.'
      || coalesce(E'\nMeet: ' || c.meet_note, '')
      || E'\n\nThe meeting point, who''s in, the cars and the chat: ' || public.hi8_crew_url(c)
      || E'\n\nPlans change: leave the crew from that page any time.',
      c.id, 'in:' || c.id || ':' || lower(r.email));
  elsif tg_op = 'DELETE' and c.status = 'on' then
    perform public.hi8_mail(c.host_email, 'left', public.hi8_name(r.email, c.city) || ' left your crew · ' || public.hi8_crew_line(c),
      public.hi8_name(r.email, c.city) || ' left ' || public.hi8_crew_line(c) || '. ' || n || ' of ' || c.max_riders || E' going now.\n\n' || public.hi8_crew_url(c),
      c.id, null);
  end if;
  return null;
end $$;
drop trigger if exists hi8_member_mail on public.crew_members;
create trigger hi8_member_mail after insert or delete on public.crew_members for each row execute function public.hi8_on_member();

create or replace function public.hi8_on_crew() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if old.status = 'on' and new.status = 'off' then
    for m in select email from public.crew_members where crew_id = new.id and lower(email) <> lower(new.host_email) loop
      perform public.hi8_mail(m.email, 'off', 'Called off · ' || public.hi8_crew_line(new),
        public.hi8_crew_line(new) || E' is called off.\n\nWhy: ' || coalesce(new.off_reason, 'the captain called it off')
        || E'\n\nOther crews coming up: ' || coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com') || '/B27-Home.dc.html',
        new.id, 'off:' || new.id || ':' || lower(m.email));
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists hi8_crew_mail on public.crews;
create trigger hi8_crew_mail after update of status on public.crews for each row execute function public.hi8_on_crew();

-- chat: one email per rider per crew at most every 2 hours, so a busy chat doesn't flood anyone
create or replace function public.hi8_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.crews; m record;
begin
  if new.kind <> 'msg' or new.email is null then return null; end if;
  select * into c from public.crews where id = new.crew_id;
  for m in select email from public.crew_members where crew_id = new.crew_id and lower(email) <> lower(new.email) loop
    if not exists (select 1 from public.outbox o where o.kind = 'chat' and o.crew_id = new.crew_id and o.to_email = lower(m.email)
                   and o.created_at > now() - interval '2 hours') then
      perform public.hi8_mail(m.email, 'chat', public.hi8_name(new.email, c.city) || ' in the crew chat · ' || public.hi8_crew_line(c),
        public.hi8_name(new.email, c.city) || ': ' || new.body || E'\n\nReply in the chat: ' || coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com')
        || '/B27-Chat.dc.html?c=' || c.code, c.id, null);
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists hi8_message_mail on public.crew_messages;
create trigger hi8_message_mail after insert on public.crew_messages for each row execute function public.hi8_on_message();

-- welcome: the first sign-up with an email gets its plate by email
create or replace function public.hi8_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.signups where lower(email) = lower(new.email) and id <> new.id) then return null; end if;
  perform public.hi8_mail(new.email, 'welcome',
    case when new.plate is not null then 'Your founding plate: #' || lpad(new.plate::text, 3, '0') || ' in ' || (select name from public.cities where slug = new.city)
         else 'You''re on the Hi8ctane list in ' || (select name from public.cities where slug = new.city) end,
    E'Welcome to Hi8ctane.\n\n'
    || case when new.plate is not null then 'You''re founding rider #' || new.plate || ' in ' || (select name from public.cities where slug = new.city) || E'. The plate is yours for good.\n\n' else '' end
    || E'What happens next: on good days, captains post crews for your sport. Join one, sort a seat in a car, ride, split the fuel.\n\n'
    || 'The crews coming up: ' || coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com') || '/B27-Home.dc.html',
    null, 'welcome:' || lower(new.email));
  return null;
end $$;
drop trigger if exists hi8_signup_mail on public.signups;
create trigger hi8_signup_mail after insert on public.signups for each row execute function public.hi8_on_signup();

-- the evening before: a reminder to everyone in tomorrow's crews (runs daily at 18:00 Amsterdam time)
create or replace function public.hi8_queue_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare c public.crews; m record; n int := 0; hub text;
begin
  for c in select * from public.crews where status = 'on' and day = public.hi8_today(city) + 1 loop
    select name into hub from public.hubs where city = c.city and slug = c.meet_hub;
    for m in select email from public.crew_members where crew_id = c.id loop
      perform public.hi8_mail(m.email, 'remind', 'Tomorrow · ' || public.hi8_crew_line(c),
        'Tomorrow: ' || public.hi8_crew_line(c) || '.'
        || case when hub is not null then E'\nCars leave ' || initcap(hub) || coalesce(' at ' || to_char(c.meet_time, 'HH24:MI'), '') || '.' else '' end
        || coalesce(E'\nMeet: ' || c.meet_note, '')
        || E'\n\nCheck the forecast in the morning. If you can''t make it, leave the crew so your seat goes to someone else: ' || public.hi8_crew_url(c),
        c.id, 'remind:' || c.id || ':' || lower(m.email));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- sends what's waiting, through Resend (needs the pg_net extension and a Resend API key, section 6)
create or replace function public.hi8_mail_flush() returns int
language plpgsql security definer set search_path = public as $$
declare
  k    text := public.hi8_secret('resend_api_key');
  frm  text := coalesce(public.hi8_secret('mail_from'), 'Hi8ctane <crews@hi8ctane.com>');
  o    public.outbox;
  rid  bigint;
  n    int := 0;
begin
  if k is null or k = '' then return 0; end if;
  for o in select * from public.outbox where sent_at is null and error is null and created_at > now() - interval '2 days'
           order by id limit 50 for update skip locked loop
    begin
      execute 'select net.http_post(url := $1, body := $2, headers := $3)' into rid using
        'https://api.resend.com/emails',
        jsonb_build_object('from', frm, 'to', jsonb_build_array(o.to_email), 'subject', o.subject, 'text', o.body, 'reply_to', 'hello@hi8ctane.com'),
        jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json');
      update public.outbox set sent_at = now(), request_id = rid where id = o.id;
      n := n + 1;
    exception when others then
      update public.outbox set error = left(sqlerrm, 300) where id = o.id;
    end;
  end loop;
  return n;
end $$;

-- erase_email (from 0003) + the outbox
create or replace function public.erase_email(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; em text := lower(trim(p_email));
begin
  update public.crews set status = 'off', off_reason = 'The captain left Hi8ctane', host_email = 'erased' where lower(host_email) = em;
  delete from public.crew_members where lower(email) = em; get diagnostics e = row_count;
  update public.crew_messages set email = null, kind = 'edit', body = '(message removed)' where lower(email) = em;
  delete from public.city_requests where lower(email) = em; get diagnostics f = row_count;
  delete from public.signups where lower(email) = em; get diagnostics a = row_count;
  delete from public.night_rsvps where lower(email) = em; get diagnostics b = row_count;
  delete from public.rider_keys where lower(email) = em; get diagnostics c = row_count;
  delete from public.partner_leads where lower(contact) = em; get diagnostics d = row_count;
  delete from public.outbox where to_email = em; get diagnostics g = row_count;
  return json_build_object('signups_deleted', a, 'rsvps_deleted', b, 'keys_deleted', c, 'partner_leads_deleted', d,
                           'crew_memberships_deleted', e, 'city_requests_deleted', f, 'emails_deleted', g);
end $$;

-- who may call what
revoke execute on function public.approve_captain(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.hi8_is_captain(text) from public, anon, authenticated;
revoke execute on function public.hi8_secret(text) from public, anon, authenticated;
revoke execute on function public.hi8_crew_line(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_crew_url(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_mail(text, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.hi8_queue_reminders() from public, anon, authenticated;
revoke execute on function public.hi8_mail_flush() from public, anon, authenticated;
revoke execute on function public.erase_email(text) from public, anon, authenticated;
revoke execute on function public.hi8_on_member() from public, anon, authenticated;
revoke execute on function public.hi8_on_crew() from public, anon, authenticated;
revoke execute on function public.hi8_on_message() from public, anon, authenticated;
revoke execute on function public.hi8_on_signup() from public, anon, authenticated;
revoke execute on function public.hi8_crew(text, uuid) from public;
revoke execute on function public.hi8_start_crew(uuid, text, text, date, text, text, text, int, text, text, text, text, text, text, int) from public;
revoke execute on function public.hi8_quick_join(text, text, text, text, text, int, uuid, text, text) from public;
revoke execute on function public.hi8_settle(uuid, text, numeric, text) from public;
revoke execute on function public.hi8_paid(uuid, text, boolean) from public;
revoke execute on function public.hi8_log_error(text, text, text, text) from public;
grant execute on function public.hi8_crew(text, uuid) to anon, authenticated;
grant execute on function public.hi8_start_crew(uuid, text, text, date, text, text, text, int, text, text, text, text, text, text, int) to anon, authenticated;
grant execute on function public.hi8_quick_join(text, text, text, text, text, int, uuid, text, text) to anon, authenticated;
grant execute on function public.hi8_settle(uuid, text, numeric, text) to anon, authenticated;
grant execute on function public.hi8_paid(uuid, text, boolean) to anon, authenticated;
grant execute on function public.hi8_log_error(text, text, text, text) to anon, authenticated;
grant execute on function public.approve_captain(text, text, boolean) to service_role;
grant execute on function public.erase_email(text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Switch the emails on (Supabase only; skipped on a database without these extensions)
-- ---------------------------------------------------------------------------------------------
do $$ begin
  begin create extension if not exists pg_net; exception when others then raise notice 'pg_net is not available here: %', sqlerrm; end;
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron is not available here: %', sqlerrm; end;
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hi8-mail', '* * * * *', 'select public.hi8_mail_flush()');
    perform cron.schedule('hi8-remind', '0 17 * * *', 'select public.hi8_queue_reminders()');   -- 17:00 UTC = 18:00 in Amsterdam (19:00 in summer)
  end if;
end $$;

-- Then, once Resend has verified hi8ctane.com, store its API key (once) and the emails start going out:
--   select vault.create_secret('re_your_key_here', 'resend_api_key');
-- See what's waiting / what went out:
--   select kind, to_email, subject, created_at, sent_at, error from public.outbox order by id desc limit 50;
-- What broke on riders' phones:
--   select at, screen, message from public.client_errors order by at desc limit 50;

-- the API picks up the new functions straight away
notify pgrst, 'reload schema';
