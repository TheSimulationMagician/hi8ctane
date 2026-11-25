-- Hi8ctane 0029: the app takes the next step itself, and the rider confirms (PR #48).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0028. Safe to run again. Nothing here commits anyone:
-- every message ends in one tap that the rider or captain still has to make.
--
--   1. The proposal comes to you: the alert worker finds a good window on a day when 2 or more people in a crew
--      you kept said they're up for a ride, and tells the person who made that crew (one message a day at most,
--      never for a day the crew already has a session). Only counts go in the message, no names.
--   2. Lifts sort themselves: a rider who needs a seat gets the first free one as soon as a driver has room
--      (when a driver joins, adds seats, or a seat frees up), and both hear it. The day before, if someone still
--      has no seat, the riders going their own way are asked once whether they're driving anyway.
--   3. The forecast makes the call, the captain confirms: when a crew's own window drops to NO GO, the captain's
--      message is a question with a link that opens CALL IT OFF / KEEP IT ON and the Plan B. The others get the
--      same news as before.
--   4. The next one gets asked for you: after a session with 2 or more riders, the captain gets the next good
--      window at the same spot and a link that opens RUN IT AGAIN, filled in. Once per crew.

alter table public.squads add column if not exists nudged_at timestamptz;
alter table public.crews add column if not exists again_at timestamptz;
alter table public.crews add column if not exists lift_asked_at timestamptz;

-- 1. the proposal ----------------------------------------------------------------------------------------------
-- for the worker: every crew you kept that has run before, with how many of its people are up for each of the next
-- 5 days, its last set-up (spot, with what the forecast needs), and the days it already has a session
create or replace function public.hi8_worker_squads() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select jsonb_build_object('code', s.code, 'name', s.name, 'city', s.city, 'sport', s.sport, 'nudged_at', s.nudged_at,
      'today', public.hi8_today(s.city), 'now', to_char(public.hi8_city_now(s.city), 'YYYY-MM-DD"T"HH24:MI'),
      'up', coalesce((select jsonb_object_agg(u.day::text, u.n) from (
               select a.day, count(distinct lower(a.email)) as n from public.ride_asks a
               join public.squad_members m on m.squad_id = s.id and lower(m.email) = lower(a.email)
               where a.sport = s.sport and a.city = s.city and a.day between public.hi8_today(s.city) + 1 and public.hi8_today(s.city) + 5
               group by a.day) u), '{}'::jsonb),
      'busy', coalesce((select jsonb_agg(distinct c.day) from public.crews c where c.squad = s.id and c.status = 'on' and c.day >= public.hi8_today(s.city)), '[]'::jsonb),
      'last', (select jsonb_build_object('spot', c.spot, 'from', extract(hour from c.start_time)::int, 'to', extract(hour from coalesce(c.end_time, c.start_time + interval '3 hours'))::int)
               from public.crews c where c.squad = s.id and c.status = 'on' order by c.day desc, c.start_time desc limit 1),
      'spot', (select jsonb_build_object('slug', sp.slug, 'city', sp.city, 'name', sp.name, 'lat', sp.lat, 'lon', sp.lon, 'face', sp.face,
                 'good_from', sp.good_from, 'good_to', sp.good_to, 'lake', sp.lake, 'sports', sp.sports)
               from public.spots sp where sp.slug = (select c.spot from public.crews c where c.squad = s.id and c.status = 'on' order by c.day desc, c.start_time desc limit 1))) as x
    from public.squads s
    where exists (select 1 from public.crews c where c.squad = s.id and c.status = 'on')) q;
$$;

-- tell the person who made the crew; at most once a day per crew you kept, never for a day it already has
create or replace function public.hi8_squad_nudge(p_code text, p_day date, p_spot text, p_from int, p_to int, p_line text) returns int
language plpgsql security definer set search_path = public as $$
declare s public.squads; n int; url text; title text; body text; spn text;
begin
  select * into s from public.squads where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or (s.nudged_at is not null and s.nudged_at > now() - interval '20 hours') then return 0; end if;
  if p_day is null or p_day <= public.hi8_today(s.city) or p_day > public.hi8_today(s.city) + 5 then return 0; end if;
  if exists (select 1 from public.crews c where c.squad = s.id and c.status = 'on' and c.day = p_day) then return 0; end if;
  n := (select count(distinct lower(a.email)) from public.ride_asks a join public.squad_members m on m.squad_id = s.id and lower(m.email) = lower(a.email)
        where a.sport = s.sport and a.city = s.city and a.day = p_day);
  if n < 2 then return 0; end if;
  spn := coalesce((select name from public.spots where slug = p_spot), p_spot);
  url := coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com') || '/?propose=' || s.code || '&d=' || p_day || '&sp=' || p_spot
         || '&f=' || greatest(0, least(23, p_from)) || '&t=' || greatest(1, least(24, p_to));
  title := to_char(p_day, 'FMDay') || ' looks good · ' || s.name;
  body := spn || ' ' || lpad(p_from::text, 2, '0') || '–' || lpad(p_to::text, 2, '0') || ': ' || left(coalesce(p_line, ''), 100) || '. '
          || n || ' of ' || s.name || ' are up for it. Propose it in one tap.';
  if not public.hi8_push(s.created_by, title, body, url, 'nudge:' || s.id || ':' || p_day, 'nudge:' || s.code) then
    perform public.hi8_mail(s.created_by, 'plan', title, body || E'\n\nNobody is in until they say so themselves.\n\n' || url, null, 'nudge:' || s.id || ':' || p_day);
  end if;
  update public.squads set nudged_at = now() where id = s.id;
  return 1;
end $$;

-- 2. lifts --------------------------------------------------------------------------------------------------------
-- a rider who needs a seat gets the car with the most room, first come first served; both are told
create or replace function public.hi8_fill_seats(p_crew uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c public.crews; r record; d record; n int := 0;
begin
  select * into c from public.crews where id = p_crew;
  if not found or c.status <> 'on' or public.hi8_crew_past(c) then return 0; end if;
  for r in select m.member_id, m.email from public.crew_members m where m.crew_id = c.id and m.getting = 'seat' and m.car_with is null order by m.joined_at, m.member_id loop
    select x.member_id, x.email into d from public.crew_members x
    where x.crew_id = c.id and x.getting = 'drive' and lower(x.email) <> lower(r.email)
      and x.seats > (select count(*) from public.crew_members y where y.crew_id = c.id and y.car_with = x.member_id)
    order by x.seats - (select count(*) from public.crew_members y where y.crew_id = c.id and y.car_with = x.member_id) desc, x.joined_at
    limit 1;
    exit when not found;
    update public.crew_members set car_with = d.member_id where member_id = r.member_id;
    perform public.hi8_tell(r.email, 'You have a seat · ' || public.hi8_crew_line(c),
      public.hi8_name(d.email, c.city) || ' has room, so you''re in their car now. The pick-up is on your pass.', c, 'seatfill:' || r.member_id || ':' || d.member_id);
    perform public.hi8_tell(d.email, public.hi8_name(r.email, c.city) || ' is in your car · ' || public.hi8_crew_line(c),
      'They needed a seat and you had room. Your pick-ups are on your pass.', c, 'seatfill-d:' || r.member_id || ':' || d.member_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.hi8_fill_seats(uuid) from public, anon, authenticated;

-- every join or change fills free seats straight away (the crew row is already locked there)
do $$
declare d text; anchor text := 'return public.hi8_crew(c.code, p_key);';
begin
  d := pg_get_functiondef('public.hi8_join_crew'::regproc);
  if position('0029: lifts' in d) = 0 then
    if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then raise exception 'hi8_join_crew changed shape (lifts)'; end if;
    execute replace(d, anchor, 'perform public.hi8_fill_seats(c.id);   -- 0029: lifts
  ' || anchor);
  end if;
end $$;

-- the worker, every run: fill free seats; the day before, ask the riders going their own way once
create or replace function public.hi8_lifts() returns json
language plpgsql security definer set search_path = public as $$
declare c public.crews; m record; filled int := 0; asked int := 0; names text; hubn text; k int;
begin
  for c in select * from public.crews x where x.status = 'on' and x.day between public.hi8_today(x.city) and public.hi8_today(x.city) + 1
             and exists (select 1 from public.crew_members y where y.crew_id = x.id and y.getting = 'seat' and y.car_with is null) for update loop
    if public.hi8_crew_past(c) then continue; end if;
    filled := filled + public.hi8_fill_seats(c.id);
    if c.lift_asked_at is not null then continue; end if;
    select string_agg(public.hi8_name(y.email, c.city), ', ' order by y.joined_at), count(*) into names, k
      from public.crew_members y where y.crew_id = c.id and y.getting = 'seat' and y.car_with is null;
    if coalesce(k, 0) = 0 then continue; end if;
    hubn := (select h.name from public.hubs h where h.city = c.city and h.slug = c.meet_hub);
    for m in select y.email from public.crew_members y where y.crew_id = c.id and y.getting = 'own' loop
      perform public.hi8_tell(m.email, 'Driving anyway? · ' || public.hi8_crew_line(c),
        names || case when k = 1 then ' still needs' else ' still need' end || ' a lift' || coalesce(' from ' || hubn, '') || coalesce(' at ' || to_char(c.meet_time, 'HH24:MI'), '')
        || '. If you''re driving anyway, switch to I''LL DRIVE on the crew page and the seat' || case when k = 1 then ' is theirs' else 's are theirs' end || '.', c, 'liftask:' || c.id || ':' || lower(m.email));
      asked := asked + 1;
    end loop;
    for m in select y.email from public.crew_members y where y.crew_id = c.id and y.getting = 'seat' and y.car_with is null loop
      perform public.hi8_tell(m.email, 'Still finding you a seat · ' || public.hi8_crew_line(c),
        'No car has room yet. We asked the riders going their own way; you hear it the moment a seat is yours.', c, 'liftwait:' || c.id || ':' || lower(m.email));
    end loop;
    update public.crews set lift_asked_at = now() where id = c.id;
  end loop;
  return json_build_object('filled', filled, 'asked', asked);
end $$;

-- 3. the forecast makes the call, the captain confirms ------------------------------------------------------------
create or replace function public.hi8_fx_drop(p_code text, p_line text, p_next text default null) returns int
language plpgsql security definer set search_path = public as $$
declare c public.crews; m record; n int := 0; url text; spn text; cap boolean;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found or c.status <> 'on' or c.fx_flag_at is not null then return 0; end if;
  update public.crews set fx_flag_at = now() where id = c.id;
  url := public.hi8_crew_url(c);
  spn := coalesce((select name from public.spots where slug = c.spot), c.spot);
  insert into public.crew_messages (crew_id, email, kind, body) values (c.id, null, 'edit', 'Forecast dropped: ' || left(p_line, 120) || coalesce('. Next good window: ' || left(p_next, 80), ''));
  for m in select email from public.crew_members where crew_id = c.id loop
    cap := lower(m.email) = lower(c.host_email) and c.captain_until is null;   -- 0029: the captain gets the question
    if cap then
      if public.hi8_push(m.email, 'Your call · ' || spn, left(p_line, 110) || '. Call it off with a Plan B, or keep it on?', url || '&call=1', 'fx:' || c.id || ':' || lower(m.email), 'fx:' || c.code) then n := n + 1;
      else
        perform public.hi8_mail(m.email, 'fx', 'Your call: the forecast dropped · ' || public.hi8_crew_line(c),
          'The forecast for your crew dropped: ' || p_line || '.' || coalesce(E'\nNext good window: ' || p_next || '.', '')
          || E'\nOne tap: call it off and pick a Plan B, or keep it on. The crew hears what you decide.' || E'\n\n' || url || '&call=1', c.id, 'fx:' || c.id || ':' || lower(m.email));
        n := n + 1;
      end if;
    elsif public.hi8_push(m.email, 'Forecast dropped · ' || spn, left(p_line, 140) || '. Still on?', url, 'fx:' || c.id || ':' || lower(m.email), 'fx:' || c.code) then n := n + 1;
    else
      perform public.hi8_mail(m.email, 'fx', 'Forecast dropped · ' || public.hi8_crew_line(c),
        'The forecast for your crew dropped: ' || p_line || '.' || coalesce(E'\nNext good window: ' || p_next || '.', '')
        || E'\nThe captain can move the crew or call it off. Your call too: leave on the crew page if you''re out.' || E'\n\n' || url, c.id, 'fx:' || c.id || ':' || lower(m.email));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 4. the next one -------------------------------------------------------------------------------------------------
create or replace function public.hi8_again_nudge(p_code text, p_day date, p_from int, p_to int, p_line text) returns int
language plpgsql security definer set search_path = public as $$
declare c public.crews; going int; url text; spn text; body text;
begin
  select * into c from public.crews where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or c.status <> 'on' or c.again_at is not null or not public.hi8_crew_past(c) or c.day < public.hi8_today(c.city) - 1 then return 0; end if;
  going := (select count(*) from public.crew_members where crew_id = c.id and not no_show);
  update public.crews set again_at = now() where id = c.id;   -- asked once, whatever happens next
  if going < 2 or p_day is null or p_day <= public.hi8_today(c.city) then return 0; end if;
  -- already planned the next one (same spot and sport, the captain is in it): no need to ask
  if exists (select 1 from public.crews x join public.crew_members y on y.crew_id = x.id and lower(y.email) = lower(c.host_email)
             where x.status = 'on' and x.sport = c.sport and x.spot = c.spot and x.day >= public.hi8_today(c.city) and x.id <> c.id) then return 0; end if;
  spn := coalesce((select name from public.spots where slug = c.spot), c.spot);
  url := public.hi8_crew_url(c) || '&again=' || p_day || '&f=' || greatest(0, least(23, p_from)) || '&t=' || greatest(1, least(24, p_to));
  body := 'Next good window at ' || spn || ': ' || to_char(p_day, 'FMDy DD') || ' ' || lpad(p_from::text, 2, '0') || '–' || lpad(p_to::text, 2, '0') || ', ' || left(coalesce(p_line, ''), 80)
    || '. Run it again in one tap: same set-up, everyone says yes fresh.';
  if not public.hi8_push(c.host_email, 'Same crew again? · ' || spn, body, url, 'again:' || c.id, 'again:' || c.code) then
    perform public.hi8_mail(c.host_email, 'plan', 'Same crew again? · ' || spn, body || E'\n\n' || url, c.id, 'again:' || c.id);
  end if;
  return 1;
end $$;

revoke execute on function public.hi8_worker_squads() from public, anon, authenticated;
revoke execute on function public.hi8_squad_nudge(text, date, text, int, int, text) from public, anon, authenticated;
revoke execute on function public.hi8_lifts() from public, anon, authenticated;
revoke execute on function public.hi8_fx_drop(text, text, text) from public, anon, authenticated;
revoke execute on function public.hi8_again_nudge(text, date, int, int, text) from public, anon, authenticated;
grant execute on function public.hi8_worker_squads() to service_role;
grant execute on function public.hi8_squad_nudge(text, date, text, int, int, text) to service_role;
grant execute on function public.hi8_lifts() to service_role;
grant execute on function public.hi8_fx_drop(text, text, text) to service_role;
grant execute on function public.hi8_again_nudge(text, date, int, int, text) to service_role;

-- check: should print t | t | t | t
select to_regprocedure('public.hi8_worker_squads()') is not null and to_regprocedure('public.hi8_squad_nudge(text, date, text, integer, integer, text)') is not null as proposal,
       position('0029: lifts' in pg_get_functiondef('public.hi8_join_crew'::regproc)) > 0 and to_regprocedure('public.hi8_lifts()') is not null as lifts,
       position('&call=1' in pg_get_functiondef('public.hi8_fx_drop'::regproc)) > 0 as call,
       to_regprocedure('public.hi8_again_nudge(text, date, integer, integer, text)') is not null as again;

notify pgrst, 'reload schema';
