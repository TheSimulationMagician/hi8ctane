-- Hi8ctane 0027: release guards for the session plan (UX review of PR #45, P0).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0026. Safe to run again.
--
--   1. A finished session can't be called off or left any more. Until now a captain could tap CALL IT OFF on
--      yesterday's crew: the crew turned 'off' and dropped out of the completed-session count.
--   2. Every material change to the plan (day, start, pick-up, meeting time, spot) bumps crews.plan_v.
--      STILL IN only counts for the version the rider saw: if it moved again since, they're asked again.
--      The day and start before the last move are kept (prev_day, prev_start), so "moved" can say from what.
--   3. A rider who says STILL IN on a called-off or finished crew gets a clear refusal, not a silent yes.
--
-- Way back (keeps every security fix): drop function public.hi8_still_in(uuid, text, integer); then run the
-- hi8_still_in and hi8_on_crew_plan sections of 0024 again, and the original hi8_leave_crew from 0003. The plan_v
-- column can stay; nothing else reads it.

alter table public.crews add column if not exists plan_v integer not null default 1;
alter table public.crews add column if not exists prev_day date, add column if not exists prev_start time;   -- what it was before the last move

-- has this session ended? (the day is over, or today and past its end; no end time = start + 3 hours)
create or replace function public.hi8_crew_ended(c public.crews) returns boolean
language sql stable security definer set search_path = public as $$
  select c.day < public.hi8_today(c.city)
      or (c.day = public.hi8_today(c.city)
          and (now() at time zone (select tz from public.cities where slug = c.city))::time
              > coalesce(c.end_time, least(c.start_time + interval '3 hours', time '23:59')));
$$;
revoke execute on function public.hi8_crew_ended(public.crews) from public, anon, authenticated;

-- 2. a material change bumps the version (and, as in 0024, makes everyone but the captain unsure)
create or replace function public.hi8_on_crew_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.day, new.start_time) is distinct from (old.day, old.start_time) then
    new.checked_at := null; new.checked_ok := null; new.checked_kt := null; new.checked_note := null;   -- the new time hasn't been rechecked
    new.prev_day := old.day; new.prev_start := old.start_time;
    update public.crew_members set unsure = true where crew_id = new.id and lower(email) <> lower(new.host_email);
  end if;
  if (new.day, new.start_time, new.meet_hub, new.meet_time, new.spot) is distinct from (old.day, old.start_time, old.meet_hub, old.meet_time, old.spot) then
    new.plan_v := coalesce(old.plan_v, 1) + 1;
  end if;
  if new.status = 'off' then new.captain_until := null; end if;
  return new;
end $$;

-- the version travels with every crew card
create or replace function public.hi8_crew_card(c public.crews) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.hi8_crew_card_base(c) || jsonb_build_object(
    'checked_at', c.checked_at, 'checked_ok', c.checked_ok, 'checked_kt', c.checked_kt, 'checked_note', c.checked_note,
    'captain_until', c.captain_until, 'captain_left', c.captain_left,
    'unsure', (select count(*) from public.crew_members m where m.crew_id = c.id and m.unsure),
    'plan_v', c.plan_v, 'ended', public.hi8_crew_ended(c), 'prev_day', c.prev_day, 'prev_start', c.prev_start);
$$;
revoke execute on function public.hi8_crew_card(public.crews) from public, anon, authenticated;

-- 1. no leaving or calling off a session that has ended (guard added in front of the existing body)
do $$
declare d text := pg_get_functiondef('public.hi8_leave_crew(uuid, text, text)'::regprocedure);
begin
  if position('crew_done' in d) = 0 then
    d := replace(d, 'if not found then raise exception ''no_crew'' using errcode = ''22023''; end if;',
      'if not found then raise exception ''no_crew'' using errcode = ''22023''; end if;' || chr(10) ||
      '  if public.hi8_crew_ended(c) then raise exception ''crew_done'' using errcode = ''22023'', hint = ''This session has finished: there is nothing to call off.''; end if;');
    if position('crew_done' in d) = 0 then raise exception 'hi8_leave_crew changed shape: guard not added'; end if;
    execute d;
  end if;
end $$;

-- 2 + 3. STILL IN for the version the rider saw, on a crew that is still on
drop function if exists public.hi8_still_in(uuid, text);
create or replace function public.hi8_still_in(p_key uuid, p_code text, p_v integer default null) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews;
begin
  select * into c from public.crews where code = upper(trim(p_code));
  if not found then raise exception 'no_crew' using errcode = 'P0002'; end if;
  if c.status <> 'on' then raise exception 'crew_off' using errcode = '22023', hint = 'This session was called off.'; end if;
  if public.hi8_crew_ended(c) then raise exception 'crew_done' using errcode = '22023', hint = 'This session has finished.'; end if;
  if p_v is not null and p_v <> c.plan_v then raise exception 'plan_changed' using errcode = '40001', hint = 'The plan changed again. Check the new time before you say yes.'; end if;
  update public.crew_members set unsure = false where crew_id = c.id and lower(email) = em;
  if not found then raise exception 'not_in_crew' using errcode = '42501'; end if;
  return public.hi8_crew(c.code, p_key);
end $$;
revoke execute on function public.hi8_still_in(uuid, text, integer) from public;
grant execute on function public.hi8_still_in(uuid, text, integer) to anon, authenticated;

-- check: should print plan_v | t | t
select 'plan_v' as col,
       position('crew_done' in pg_get_functiondef('public.hi8_leave_crew(uuid, text, text)'::regprocedure)) > 0 as leave_guarded,
       to_regprocedure('public.hi8_still_in(uuid, text, integer)') is not null as still_in_versioned;
