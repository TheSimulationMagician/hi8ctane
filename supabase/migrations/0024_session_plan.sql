-- Hi8ctane 0024: the session plan (2.30). Joining a crew and knowing what happens next, and the edge cases.
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0023. Safe to run again.
--
--   * Stages, never "confirmed" just because someone joined: proposed -> crew confirmed (the minimum is in) ->
--     conditions rechecked (the alert worker rechecks each crew's own window every 3 hours, the day before and the
--     day itself) -> done. Called off is its own state; "conditions doubtful" when the recheck says no go.
--   * The captain can drop an exact meeting pin (near the spot).
--   * Moved: every rider is asked "still in?" (unsure until they say so).
--   * The captain steps down: the crew goes to the next driver (or the most experienced rider), who keeps it on or
--     passes it on; anyone in the crew can take it. Nobody by the deadline: called off, and everyone is told.
--   * Someone drops out: their driver hears a seat is free; when a driver drops out, the riders in their car hear it.
--
-- hi8_crew and hi8_crew_card are long, so this keeps them as they are (renamed *_base) and adds the new fields
-- around them. If an older file (0019 or before) is ever run again, run this one again after it.

alter table public.crews add column if not exists checked_at     timestamptz;
alter table public.crews add column if not exists checked_ok     boolean;
alter table public.crews add column if not exists checked_kt     int;
alter table public.crews add column if not exists checked_note   text check (checked_note is null or char_length(checked_note) <= 140);
alter table public.crews add column if not exists meet_lat       double precision;
alter table public.crews add column if not exists meet_lon       double precision;
alter table public.crews add column if not exists captain_until  timestamptz;          -- set: the new captain hasn't said yes yet
alter table public.crews add column if not exists captain_left   text;                 -- the name of the captain who stepped down
alter table public.crews add column if not exists captain_passed text[] not null default '{}';
alter table public.crew_members add column if not exists unsure boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- 1. The new fields, around the existing crew card and crew page
-- ---------------------------------------------------------------------------------------------
do $$ begin
  if to_regprocedure('public.hi8_crew_card_base(public.crews)') is null then
    alter function public.hi8_crew_card(public.crews) rename to hi8_crew_card_base;
  end if;
  if to_regprocedure('public.hi8_crew_base(text, uuid)') is null then
    alter function public.hi8_crew(text, uuid) rename to hi8_crew_base;
  end if;
end $$;

create or replace function public.hi8_crew_card(c public.crews) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.hi8_crew_card_base(c) || jsonb_build_object(
    'checked_at', c.checked_at, 'checked_ok', c.checked_ok, 'checked_kt', c.checked_kt, 'checked_note', c.checked_note,
    'captain_until', c.captain_until, 'captain_left', c.captain_left,
    'unsure', (select count(*) from public.crew_members m where m.crew_id = c.id and m.unsure));
$$;

create or replace function public.hi8_crew(p_code text, p_key uuid default null) returns json
language plpgsql security definer set search_path = public as $$
declare out jsonb := public.hi8_crew_base(p_code, p_key)::jsonb; c public.crews; mid uuid;
begin
  if out is null or jsonb_typeof(out -> 'me') is distinct from 'object' then return out::json; end if;
  select * into c from public.crews where code = out ->> 'code';
  mid := (out -> 'me' ->> 'member_id')::uuid;
  return (out || jsonb_build_object(
    'meet_lat', c.meet_lat, 'meet_lon', c.meet_lon,
    'unsure_ids', (select coalesce(jsonb_agg(m.member_id), '[]'::jsonb) from public.crew_members m where m.crew_id = c.id and m.unsure),
    'captain_ask', lower(c.host_email) = (select lower(email) from public.crew_members where member_id = mid) and c.captain_until is not null,
    'me', (out -> 'me') || jsonb_build_object('unsure', (select unsure from public.crew_members where member_id = mid))))::json;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Telling people (push, or email when they have no phone set up)
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_tell(p_email text, p_title text, p_body text, c public.crews, p_dedupe text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.hi8_push(p_email, p_title, p_body, public.hi8_crew_url(c), p_dedupe, 'crew:' || c.code) then
    perform public.hi8_mail(p_email, 'plan', p_title, p_body || E'\n\n' || public.hi8_crew_url(c), c.id, p_dedupe);
  end if;
end $$;

-- who takes over: a driver first (most seats), then the most experienced, then who joined first
create or replace function public.hi8_next_captain(c public.crews) returns text
language sql stable security definer set search_path = public as $$
  select m.email from public.crew_members m
  where m.crew_id = c.id and lower(m.email) <> lower(c.host_email) and not (lower(m.email) = any (c.captain_passed))
  order by (m.getting = 'drive') desc, m.seats desc, case m.level when 'ripper' then 0 when 'regular' then 1 else 2 end, m.joined_at
  limit 1;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. What riders and captains do
-- ---------------------------------------------------------------------------------------------
-- after a move: "still in"
create or replace function public.hi8_still_in(p_key uuid, p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews;
begin
  select * into c from public.crews where code = upper(trim(p_code));
  if not found then raise exception 'no_crew' using errcode = 'P0002'; end if;
  update public.crew_members set unsure = false where crew_id = c.id and lower(email) = em;
  if not found then raise exception 'not_in_crew' using errcode = '42501'; end if;
  return public.hi8_crew(c.code, p_key);
end $$;

-- the captain's exact meeting pin (within 3 km of the spot); null clears it
create or replace function public.hi8_set_pin(p_key uuid, p_code text, p_lat double precision, p_lon double precision) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; s public.spots; km double precision;
begin
  perform public.hi8_limit('pin', p_key::text, 20, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(p_code));
  if not found or lower(c.host_email) <> em then raise exception 'captain_only' using errcode = '42501'; end if;
  if p_lat is not null then
    select * into s from public.spots where slug = c.spot;
    km := 111.32 * sqrt(power(p_lat - s.lat, 2) + power((p_lon - s.lon) * cos(radians(s.lat)), 2));
    if km > 3 then raise exception 'too_far' using errcode = '22023', hint = 'The pin has to be near ' || s.name || ' (you''re ' || round(km::numeric, 1) || ' km away).'; end if;
  end if;
  update public.crews set meet_lat = p_lat, meet_lon = case when p_lat is null then null else p_lon end, updated_at = now() where id = c.id;
  if p_lat is not null then insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'edit', 'The captain dropped the exact meeting pin.'); end if;
  return public.hi8_crew(c.code, p_key);
end $$;

-- the captain steps down: the crew goes to the next driver or most experienced rider, who has until the deadline to say yes
create or replace function public.hi8_step_down(p_key uuid, p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; nxt text; starts timestamptz; until timestamptz; who text; m record;
begin
  select * into c from public.crews where code = upper(trim(p_code)) for update;
  if not found or lower(c.host_email) <> em or c.status <> 'on' then raise exception 'captain_only' using errcode = '42501'; end if;
  starts := ((c.day + c.start_time) at time zone coalesce((select tz from public.cities where slug = c.city), 'Europe/Amsterdam'));
  until := least(now() + interval '3 hours', starts - interval '1 hour');
  who := public.hi8_name(em, c.city);
  c.captain_passed := array_append(c.captain_passed, em);
  nxt := public.hi8_next_captain(c);
  if nxt is null or until < now() + interval '20 minutes' then
    return public.hi8_leave_crew(p_key, p_code, case when nxt is null then 'The captain stepped down and nobody else is in' else 'The captain stepped down too close to the start' end);
  end if;
  delete from public.crew_members where crew_id = c.id and lower(email) = em;
  update public.crews set host_email = nxt, captain_until = until, captain_left = who, captain_passed = c.captain_passed, updated_at = now() where id = c.id;
  select * into c from public.crews where id = c.id;
  insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'edit',
    who || ' stepped down as captain. ' || public.hi8_name(nxt, c.city) || ' is asked to take over (or anyone in the crew can). Nobody by '
    || to_char(until at time zone coalesce((select tz from public.cities where slug = c.city), 'Europe/Amsterdam'), 'HH24:MI') || ': it''s called off.');
  perform public.hi8_tell(nxt, 'Captain needed · ' || public.hi8_crew_line(c), who || ' stepped down. You''re next in line to captain this crew: keep it on, or pass it on.', c, 'captain:' || c.code || ':' || nxt);
  for m in select email from public.crew_members where crew_id = c.id and lower(email) <> lower(nxt) loop
    perform public.hi8_tell(m.email, 'New captain needed · ' || public.hi8_crew_line(c), who || ' stepped down. ' || public.hi8_name(nxt, c.city) || ' is asked first; anyone in the crew can take it.', c, 'captain:' || c.code || ':' || m.email || ':' || array_length(c.captain_passed, 1));
  end loop;
  return public.hi8_crew_base(c.code, null);
end $$;

-- yes (the one asked, or anyone in the crew taking it) or no (the one asked passes it on)
create or replace function public.hi8_captain(p_key uuid, p_code text, p_yes boolean) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; nxt text; who text; m record;
begin
  select * into c from public.crews where code = upper(trim(p_code)) for update;
  if not found or c.captain_until is null or c.status <> 'on' then raise exception 'no_captain_needed' using errcode = '22023'; end if;
  if not exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) then raise exception 'not_in_crew' using errcode = '42501'; end if;
  who := public.hi8_name(em, c.city);
  if p_yes then
    update public.crews set host_email = em, captain_until = null, updated_at = now() where id = c.id;
    insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'edit', who || ' is the captain now. It''s on.');
    for m in select email from public.crew_members where crew_id = c.id and lower(email) <> em loop
      perform public.hi8_tell(m.email, 'It''s still on · ' || public.hi8_crew_line(c), who || ' is your captain now.', c, 'captain-yes:' || c.code || ':' || m.email);
    end loop;
  else
    if lower(c.host_email) <> em then raise exception 'not_asked' using errcode = '42501'; end if;
    c.captain_passed := array_append(c.captain_passed, em);
    nxt := public.hi8_next_captain(c);
    if nxt is null then
      update public.crews set status = 'off', off_reason = 'Nobody could take over as captain', captain_until = null, captain_passed = c.captain_passed, updated_at = now() where id = c.id;
    else
      update public.crews set host_email = nxt, captain_passed = c.captain_passed, updated_at = now() where id = c.id;
      insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'edit', who || ' can''t captain. ' || public.hi8_name(nxt, c.city) || ' is asked next (anyone in the crew can still take it).');
      perform public.hi8_tell(nxt, 'Captain needed · ' || public.hi8_crew_line(c), 'You''re next in line to captain this crew: keep it on, or pass it on.', c, 'captain:' || c.code || ':' || nxt);
    end if;
  end if;
  return public.hi8_crew(c.code, p_key);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Automatic: a move makes everyone unsure; a drop-out tells the car
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_on_crew_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.day, new.start_time) is distinct from (old.day, old.start_time) then
    new.checked_at := null; new.checked_ok := null; new.checked_kt := null; new.checked_note := null;   -- the new time hasn't been rechecked
    update public.crew_members set unsure = true where crew_id = new.id and lower(email) <> lower(new.host_email);
  end if;
  if new.status = 'off' then new.captain_until := null; end if;
  return new;
end $$;
drop trigger if exists hi8_crew_plan on public.crews;
create trigger hi8_crew_plan before update on public.crews for each row execute function public.hi8_on_crew_plan();

create or replace function public.hi8_on_member_gone() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.crews; m record; who text; left_seats int;
begin
  select * into c from public.crews where id = old.crew_id;
  if not found or c.status <> 'on' or public.hi8_crew_past(c) then return old; end if;
  who := public.hi8_name(old.email, c.city);
  if old.getting = 'seat' then
    for m in select email from public.crew_members where crew_id = c.id and getting = 'drive' and (old.car_with is null or member_id = old.car_with) loop
      perform public.hi8_tell(m.email, 'A seat is free · ' || public.hi8_crew_line(c), who || ' dropped out, so there''s a free seat in your car. Riders who are looking hear about it.', c, 'seat:' || old.member_id || ':' || m.email);
    end loop;
  elsif old.getting = 'drive' and old.seats > 0 then
    left_seats := (select coalesce(sum(seats), 0) from public.crew_members where crew_id = c.id and getting = 'drive')
                - (select count(*) from public.crew_members where crew_id = c.id and getting = 'seat');
    for m in select email from public.crew_members where crew_id = c.id and getting = 'seat' and (car_with is null or car_with = old.member_id) loop
      perform public.hi8_tell(m.email, 'Your lift dropped out · ' || public.hi8_crew_line(c), who || ' isn''t driving any more. '
        || case when left_seats >= 0 then 'There are still seats in the other cars: open the crew to switch.' else 'Ask in the crew chat, or go your own way.' end, c, 'lift:' || old.member_id || ':' || m.email);
    end loop;
    update public.crew_members set car_with = null where crew_id = c.id and car_with = old.member_id;
  end if;
  return old;
end $$;
drop trigger if exists hi8_member_gone on public.crew_members;
create trigger hi8_member_gone after delete on public.crew_members for each row execute function public.hi8_on_member_gone();

-- ---------------------------------------------------------------------------------------------
-- 5. The worker: rechecks, and a captain nobody took
-- ---------------------------------------------------------------------------------------------
-- record a recheck of the crew's own window. Going doubtful is told by "forecast dropped" (0019, with the next good
-- window); coming back is told here.
create or replace function public.hi8_recheck(p_code text, p_ok boolean, p_kt int default null, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare c public.crews; was boolean; m record; n int := 0;
begin
  select * into c from public.crews where code = p_code;
  if not found or c.status <> 'on' then return 0; end if;
  was := c.checked_ok;
  update public.crews set checked_at = now(), checked_ok = p_ok, checked_kt = p_kt, checked_note = left(p_note, 140) where id = c.id;
  if p_ok and was = false then
    for m in select email from public.crew_members where crew_id = c.id loop
      perform public.hi8_tell(m.email, 'Back on · ' || public.hi8_crew_line(c), coalesce(p_note, 'The forecast came back') || '.', c, 'backon:' || c.code || ':' || c.day || ':' || m.email);
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

create or replace function public.hi8_captain_expire() returns int
language sql security definer set search_path = public as $$
  with x as (
    update public.crews set status = 'off', off_reason = 'Nobody took over as captain in time', updated_at = now()
    where status = 'on' and captain_until is not null and captain_until < now() returning 1)
  select count(*)::int from x;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Reliability on the rider card: how often they showed up (no-shows as marked by captains)
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_rider_stats(p_email text) returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.*, m.getting from public.crews c join public.crew_members m on m.crew_id = c.id
    where lower(m.email) = lower(p_email) and c.status = 'on' and public.hi8_crew_past(c) and not m.no_show)
  select jsonb_build_object(
    'sessions', (select count(*) from mine),
    'spots', (select count(distinct spot) from mine),
    'drives', (select count(*) from mine where getting = 'drive'),
    'started', (select count(*) from mine where lower(host_email) = lower(p_email)),
    'no_shows', (select count(*) from public.crews c join public.crew_members m on m.crew_id = c.id
                 where lower(m.email) = lower(p_email) and c.status = 'on' and public.hi8_crew_past(c) and m.no_show),
    'since', (select to_char(min(created_at), 'YYYY-MM') from public.signups where lower(email) = lower(p_email)),
    'top_spot', (select s.name from mine x join public.spots s on s.slug = x.spot group by s.name order by count(*) desc, s.name limit 1));
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Who may call what
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.hi8_crew_card_base(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_crew_base(text, uuid) from public, anon, authenticated;
revoke execute on function public.hi8_crew_card(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_tell(text, text, text, public.crews, text) from public, anon, authenticated;
revoke execute on function public.hi8_next_captain(public.crews) from public, anon, authenticated;
revoke execute on function public.hi8_recheck(text, boolean, int, text) from public, anon, authenticated;
revoke execute on function public.hi8_captain_expire() from public, anon, authenticated;
revoke execute on function public.hi8_rider_stats(text) from public, anon, authenticated;
revoke execute on function public.hi8_crew(text, uuid) from public;
revoke execute on function public.hi8_still_in(uuid, text) from public;
revoke execute on function public.hi8_set_pin(uuid, text, double precision, double precision) from public;
revoke execute on function public.hi8_step_down(uuid, text) from public;
revoke execute on function public.hi8_captain(uuid, text, boolean) from public;
grant execute on function public.hi8_crew(text, uuid) to anon, authenticated;
grant execute on function public.hi8_still_in(uuid, text) to anon, authenticated;
grant execute on function public.hi8_set_pin(uuid, text, double precision, double precision) to anon, authenticated;
grant execute on function public.hi8_step_down(uuid, text) to anon, authenticated;
grant execute on function public.hi8_captain(uuid, text, boolean) to anon, authenticated;
grant execute on function public.hi8_recheck(text, boolean, int, text) to service_role;
grant execute on function public.hi8_captain_expire() to service_role;

notify pgrst, 'reload schema';
