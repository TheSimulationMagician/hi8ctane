-- Hi8ctane 0028: captain only after a yes, spot closures on every path, running late, the weekend proposal.
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0027. Safe to run again. Nothing here is switched on for
-- riders by data you haven't entered: spot notes stay empty until you add them (see the bottom of this file).
--
--   1. H19: while a handover is open (captain_until set), nobody has captain powers. The rider who is asked can say
--      KEEP IT ON or PASS IT ON, nothing else: no moving, no pin, no no-shows, no calling it off, no stepping down.
--   2. Spot notes: closures, warnings and local info (parking, access, facilities), each with a source and the date
--      it was checked. A closure is enforced in the database on every way in: joining (all join forms go through
--      hi8_join_crew), starting (hi8_start_crew) and moving a crew onto a closed day (hi8_move_crew).
--   3. I'm running late: one tap on the day tells the crew chat, your driver and the captain. Rate-limited, deduped.
--   4. The weekend proposal: for each crew you kept, who is up for a ride on which day, how many have driven before
--      and the last set-up. Read-only: nobody is committed until they tap I'M GOING themselves.
--
-- Way back (keeps every security fix): drop function public.hi8_late(uuid, text, integer), public.hi8_weekend(uuid),
-- public.hi8_spot_notes(text), public.hi8_spot_open(text, text, date); drop table public.spot_notes; then re-run
-- 0027 (it restores hi8_crew_card) and the 0024/0003 versions of the guarded functions. Do not drop the captain guard
-- without a replacement: without it, an asked rider can call off a crew before saying yes.

-- 1. captain powers only when nobody is being asked -------------------------------------------------------------
do $$
declare f text; d text; anchor text; guard text := chr(10) || '  if c.captain_until is not null then raise exception ''captain_pending'' using errcode = ''42501'', hint = ''A new captain is being asked: KEEP IT ON or PASS IT ON first.''; end if;';
begin
  foreach f in array array[
    'hi8_move_crew|if lower(c.host_email) <> em then raise exception ''not_host'' using errcode = ''42501'', hint = ''Only the captain moves the crew.''; end if;',
    'hi8_set_pin|if not found or lower(c.host_email) <> em then raise exception ''captain_only'' using errcode = ''42501''; end if;',
    'hi8_no_show|if lower(c.host_email) <> em then raise exception ''not_host'' using errcode = ''42501'', hint = ''Only the captain marks no-shows.''; end if;',
    'hi8_step_down|if not found or lower(c.host_email) <> em or c.status <> ''on'' then raise exception ''captain_only'' using errcode = ''42501''; end if;'] loop
    d := pg_get_functiondef(('public.' || split_part(f, '|', 1))::regproc); anchor := substr(f, position('|' in f) + 1);
    if position('captain_pending' in d) = 0 then
      if position(anchor in d) = 0 then raise exception '% changed shape: guard not added', split_part(f, '|', 1); end if;
      execute replace(d, anchor, anchor || guard);
    end if;
  end loop;
  -- calling it off is a captain power too; an asked rider who can't make it says PASS IT ON, then CAN'T MAKE IT
  d := pg_get_functiondef('public.hi8_leave_crew(uuid, text, text)'::regprocedure);
  if position('captain_pending' in d) = 0 then
    anchor := '  if lower(c.host_email) = em then' || chr(10) || '    update public.crews set status = ''off''';
    if position(anchor in d) = 0 then raise exception 'hi8_leave_crew changed shape: guard not added'; end if;
    execute replace(d, anchor, '  if lower(c.host_email) = em and c.captain_until is not null then raise exception ''captain_pending'' using errcode = ''42501'', hint = ''Say PASS IT ON first, then CAN''''T MAKE IT.''; end if;' || chr(10) || anchor);
  end if;
end $$;

-- 2. spot notes ----------------------------------------------------------------------------------------------------
create table if not exists public.spot_notes (
  id         uuid primary key default gen_random_uuid(),
  city       text not null,
  spot       text not null,                     -- spots.slug
  kind       text not null check (kind in ('closed', 'warning', 'parking', 'access', 'facilities', 'local')),
  body       text not null check (length(body) between 3 and 280),
  from_day   date,                              -- null = no start
  to_day     date,                              -- null = until removed
  lat        double precision,                  -- e.g. the car park or the entrance (optional)
  lon        double precision,
  source     text not null,                     -- who says so: the municipality page, the club, "checked on site"
  checked_on date not null,                     -- when someone last checked it
  created_at timestamptz not null default now()
);
alter table public.spot_notes enable row level security;   -- no policies: only the functions below read it
revoke all on public.spot_notes from anon, authenticated;
create index if not exists spot_notes_spot on public.spot_notes (city, spot);

-- a closure for that spot on that day, or nothing
create or replace function public.hi8_spot_closed(p_city text, p_spot text, p_day date) returns text
language sql stable security definer set search_path = public as $$
  select body from public.spot_notes where kind = 'closed' and city = p_city and spot = p_spot
    and p_day between coalesce(from_day, '-infinity'::date) and coalesce(to_day, 'infinity'::date)
  order by created_at desc limit 1;
$$;
create or replace function public.hi8_spot_open(p_city text, p_spot text, p_day date) returns void
language plpgsql stable security definer set search_path = public as $$
declare why text := public.hi8_spot_closed(p_city, p_spot, p_day);
begin
  if why is not null then raise exception 'spot_closed' using errcode = '22023', hint = 'Closed that day: ' || why; end if;
end $$;
revoke execute on function public.hi8_spot_closed(text, text, date) from public, anon, authenticated;
revoke execute on function public.hi8_spot_open(text, text, date) from public, anon, authenticated;

-- the closure is checked where crews are started, moved and joined
do $$
declare d text; anchor text;
begin
  d := pg_get_functiondef('public.hi8_start_crew'::regproc);
  if position('hi8_spot_open' in d) = 0 then
    anchor := 'if not (p_sport = any (s.sports)) then raise exception ''wrong_sport_for_spot'' using errcode = ''22023''; end if;';
    if position(anchor in d) = 0 then raise exception 'hi8_start_crew changed shape'; end if;
    execute replace(d, anchor, anchor || chr(10) || '  perform public.hi8_spot_open(s.city, s.slug, p_day);');
  end if;
  d := pg_get_functiondef('public.hi8_move_crew'::regproc);
  if position('hi8_spot_open' in d) = 0 then
    anchor := 'if c.status <> ''on'' then raise exception ''crew_off'' using errcode = ''22023'', hint = ''This crew is called off.''; end if;';
    if position(anchor in d) = 0 then raise exception 'hi8_move_crew changed shape'; end if;
    execute replace(d, anchor, anchor || chr(10) || '  perform public.hi8_spot_open(c.city, c.spot, p_day);');
  end if;
  d := pg_get_functiondef('public.hi8_join_crew'::regproc);
  if position('hi8_spot_open' in d) = 0 then
    anchor := 'select exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) into was;';
    if position(anchor in d) = 0 then raise exception 'hi8_join_crew changed shape'; end if;
    execute replace(d, anchor, anchor || chr(10) || '  if not was then perform public.hi8_spot_open(c.city, c.spot, c.day); end if;   -- 0028: closures');
  end if;
end $$;

-- what the app shows: notes that still apply, per city (anyone can read them: they are public spot information)
create or replace function public.hi8_spot_notes(p_city text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('spot', n.spot, 'kind', n.kind, 'body', n.body, 'from', n.from_day, 'to', n.to_day,
           'lat', n.lat, 'lon', n.lon, 'source', n.source, 'checked', n.checked_on) order by n.spot, n.kind), '[]'::json)
  from public.spot_notes n where n.city = p_city and (n.to_day is null or n.to_day >= public.hi8_today(p_city));
$$;
grant execute on function public.hi8_spot_notes(text) to anon, authenticated;

-- the crew card says when its spot is closed that day (and keeps everything 0027 added)
create or replace function public.hi8_crew_card(c public.crews) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.hi8_crew_card_base(c) || jsonb_build_object(
    'checked_at', c.checked_at, 'checked_ok', c.checked_ok, 'checked_kt', c.checked_kt, 'checked_note', c.checked_note,
    'captain_until', c.captain_until, 'captain_left', c.captain_left,
    'unsure', (select count(*) from public.crew_members m where m.crew_id = c.id and m.unsure),
    'plan_v', c.plan_v, 'ended', public.hi8_crew_ended(c), 'prev_day', c.prev_day, 'prev_start', c.prev_start,
    'reconfirm_by', case when exists (select 1 from public.crew_members m where m.crew_id = c.id and m.unsure) then c.reconfirm_by end,
    'closed', public.hi8_spot_closed(c.city, c.spot, c.day));
$$;
revoke execute on function public.hi8_crew_card(public.crews) from public, anon, authenticated;

-- 3. I'm running late ----------------------------------------------------------------------------------------------
-- the chat gets a new kind of line for it (the other kinds stay as they were)
do $$
begin
  if position('''late''' in coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname = 'crew_messages_kind_check'), '')) = 0 then
    alter table public.crew_messages drop constraint if exists crew_messages_kind_check;
    alter table public.crew_messages add constraint crew_messages_kind_check
      check (kind = any (array['msg', 'join', 'leave', 'off', 'edit', 'here', 'report', 'late']));
  end if;
end $$;
create or replace function public.hi8_late(p_key uuid, p_code text, p_min integer) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; me public.crew_members; who text; drv text; told int := 0; tag text;
begin
  perform public.hi8_limit('late', p_key::text, 4, interval '1 hour');
  if p_min not in (5, 10, 15, 20, 30) then raise exception 'bad_minutes' using errcode = '22023'; end if;
  select * into c from public.crews where code = upper(trim(coalesce(p_code, '')));
  if not found then raise exception 'no_crew' using errcode = '22023'; end if;
  select * into me from public.crew_members where crew_id = c.id and lower(email) = em;
  if not found then raise exception 'not_in_crew' using errcode = '42501'; end if;
  if c.status <> 'on' then raise exception 'crew_off' using errcode = '22023'; end if;
  if c.day <> public.hi8_today(c.city) or public.hi8_crew_ended(c) then raise exception 'not_today' using errcode = '22023', hint = 'Only on the day of the session.'; end if;
  who := public.hi8_name(em, c.city);
  insert into public.crew_messages (crew_id, email, kind, body) values (c.id, em, 'late', who || ' is running about ' || p_min || ' min late');
  tag := 'late:' || me.member_id || ':' || to_char(date_trunc('hour', now()) + interval '15 min' * floor(extract(minute from now()) / 15), 'YYYYMMDDHH24MI');
  if me.car_with is not null then   -- the driver who picks you up
    select d.email into drv from public.crew_members d where d.member_id = me.car_with;
    if drv is not null then perform public.hi8_tell(drv, who || ' is running ' || p_min || ' min late', who || ' is in your car and running about ' || p_min || ' minutes late.', c, tag || ':drv'); told := told + 1; end if;
  end if;
  if lower(c.host_email) <> em and lower(c.host_email) is distinct from lower(drv) then
    perform public.hi8_tell(c.host_email, who || ' is running ' || p_min || ' min late', who || ' is running about ' || p_min || ' minutes late for ' || public.hi8_crew_line(c) || '.', c, tag || ':cap'); told := told + 1;
  end if;
  return json_build_object('told', told, 'crew', public.hi8_crew(c.code, p_key));
end $$;
revoke execute on function public.hi8_late(uuid, text, integer) from public;
grant execute on function public.hi8_late(uuid, text, integer) to anon, authenticated;

-- 4. the weekend proposal: your kept crews, who is up for which day, and the last set-up ---------------------------
create or replace function public.hi8_weekend(p_key uuid) returns json
language plpgsql volatile security definer set search_path = public as $$   -- volatile: hi8_email notes when the key was last used
declare em text := public.hi8_email(p_key);
begin
  if em is null then raise exception 'unknown_key' using errcode = '28000'; end if;
  return (select coalesce(json_agg(x order by x->>'name'), '[]'::json) from (
    select jsonb_build_object('code', s.code, 'name', s.name, 'sport', s.sport, 'city', s.city,
      'riders', (select jsonb_agg(jsonb_build_object('name', public.hi8_name(m.email, s.city), 'me', lower(m.email) = em,
                   'up', coalesce((select jsonb_agg(distinct a.day order by a.day) from public.ride_asks a
                                   where lower(a.email) = lower(m.email) and a.sport = s.sport and a.city = s.city
                                     and a.day between public.hi8_today(s.city) and public.hi8_today(s.city) + 7), '[]'::jsonb)) order by m.joined_at)
                 from public.squad_members m where m.squad_id = s.id),
      'drivers', (select count(distinct lower(cm.email)) from public.crew_members cm join public.crews c on c.id = cm.crew_id
                  where c.squad = s.id and cm.getting = 'drive'
                    and exists (select 1 from public.squad_members m where m.squad_id = s.id and lower(m.email) = lower(cm.email))),
      'last', (select jsonb_build_object('spot', c.spot, 'hub', c.meet_hub, 'meet', to_char(c.meet_time, 'HH24:MI'), 'from', to_char(c.start_time, 'HH24:MI'),
                 'to', to_char(c.end_time, 'HH24:MI'), 'levels', c.levels, 'max', c.max_riders, 'min', c.min_riders, 'day', c.day)
               from public.crews c where c.squad = s.id and c.status = 'on' order by c.day desc, c.start_time desc limit 1),
      'next', (select count(*) from public.crews c where c.squad = s.id and c.status = 'on' and not public.hi8_crew_past(c))) as x
    from public.squads s where exists (select 1 from public.squad_members m where m.squad_id = s.id and lower(m.email) = em)) q);
end $$;
revoke execute on function public.hi8_weekend(uuid) from public;
grant execute on function public.hi8_weekend(uuid) to anon, authenticated;

-- 5. three new anonymous counts (0026): Plan B opened, a weekend proposal opened, running late sent ---------------
do $$
begin
  if position('''propose''' in coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname = 'events_name_check'), '')) = 0 then
    alter table public.events drop constraint if exists events_name_check;
    alter table public.events add constraint events_name_check
      check (name in ('start_open', 'publish', 'share', 'link_open', 'join', 'nav', 'ics', 'again', 'looking', 'planb', 'propose', 'late'));
  end if;
end $$;

-- check: should print t | t | t | t
select position('captain_pending' in pg_get_functiondef('public.hi8_move_crew'::regproc)) > 0 as captain_guard,
       position('hi8_spot_open' in pg_get_functiondef('public.hi8_join_crew'::regproc)) > 0 as join_checks_closures,
       to_regclass('public.spot_notes') is not null as spot_notes,
       to_regprocedure('public.hi8_weekend(uuid)') is not null as weekend;

-- Adding a spot note (in the SQL editor; examples, not real data):
--   insert into public.spot_notes (city, spot, kind, body, from_day, to_day, source, checked_on)
--   values ('amsterdam', 'ijmuiden', 'closed', 'Beach closed for an event', '2027-06-12', '2027-06-13', 'Municipality notice', current_date);
--   insert into public.spot_notes (city, spot, kind, body, lat, lon, source, checked_on)
--   values ('amsterdam', 'wijk-aan-zee', 'parking', 'Paid car park behind the dunes', 52.49, 4.59, 'Checked on site', current_date);
