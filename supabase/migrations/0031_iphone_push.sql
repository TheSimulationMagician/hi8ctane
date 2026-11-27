-- Hi8ctane 0031: notifications for the iPhone app, and answers straight from their buttons.
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0030. Safe to run again. No data is removed or rewritten.
--
--   1. The app gives its phone's notification token (hi8_push_native). It is kept with the rider's email, like a web
--      push subscription, and is forgotten when Apple says the app was removed. A rider can drop it (hi8_push_native_off).
--   2. Everything that already goes out as web push now also goes to the app: hi8_has_push counts app phones,
--      hi8_push_pending lists them per message, hi8_push_done records what Apple said. The worker sends them (apns.js)
--      once the APNs key is in the Edge Function's secrets; until then it skips them and nothing else changes.
--   3. The buttons on a notification answer here (hi8_push_answer), as the rider, with their key:
--        a crew that fits (ask:CODE)        I'M IN · A SEAT / I'M IN · MEETING THERE  -> joined, at their level; NOT NOW
--        the forecast dropped (fx:CODE)     STILL IN / I'M OUT                       -> hi8_still_in / hi8_leave_crew
--        how was it (rate:CODE)             ON / MEH / OFF                           -> hi8_report
--      Whatever can't be done from the lock screen (no seat left, the plan changed) answers with the link to open.

create table if not exists public.push_native (
  token      text primary key check (token ~ '^[0-9a-fA-F]{32,200}$'),
  email      text not null,
  platform   text not null default 'ios' check (platform in ('ios')),
  env        text not null default 'production' check (env in ('production', 'sandbox')),
  created_at timestamptz not null default now(),
  ok_at      timestamptz,
  fails      int not null default 0
);
create index if not exists push_native_email on public.push_native (email);
alter table public.push_native enable row level security;   -- no policies: only these functions read and write it

-- 1. the app's token
create or replace function public.hi8_push_native(p_key uuid, p_token text, p_platform text default 'ios', p_env text default 'production') returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); t text := lower(trim(coalesce(p_token, '')));
begin
  perform public.hi8_limit('pushsub', p_key::text, 20, interval '1 hour');
  if t !~ '^[0-9a-f]{32,200}$' then raise exception 'bad_token' using errcode = '22023'; end if;
  insert into public.push_native (token, email, platform, env) values (t, em, coalesce(nullif(p_platform, ''), 'ios'), case when p_env = 'sandbox' then 'sandbox' else 'production' end)
  on conflict (token) do update set email = excluded.email, env = excluded.env, fails = 0;
  -- a phone keeps at most 3 tokens per rider (reinstalls)
  delete from public.push_native where email = em and token not in (select token from public.push_native where email = em order by created_at desc limit 3);
  return json_build_object('ok', true);
end $$;

create or replace function public.hi8_push_native_off(p_key uuid, p_token text default null) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  delete from public.push_native where email = em and (p_token is null or token = lower(trim(p_token)));
  return json_build_object('ok', true);
end $$;

-- 2. the app counts as a phone that gets push
create or replace function public.hi8_has_push(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.push_subs where email = lower(p_email) and fails < 5)
      or exists (select 1 from public.push_native where email = lower(p_email) and fails < 5);
$$;

create or replace function public.hi8_push_pending(p_limit int default 200) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', q.id, 'title', q.title, 'body', q.body, 'url', q.url, 'tag', q.tag,
    'subs', (select coalesce(json_agg(json_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::json)
             from public.push_subs s where s.email = q.email and s.fails < 5),
    'native', (select coalesce(json_agg(json_build_object('token', n.token, 'env', n.env)), '[]'::json)
             from public.push_native n where n.email = q.email and n.fails < 5)) order by q.id), '[]'::json)
  from (select * from public.push_queue where sent_at is null and error is null and created_at > now() - interval '6 hours' order by id limit p_limit) q;
$$;

drop function if exists public.hi8_push_done(bigint[], text[], text[], text[]);
create or replace function public.hi8_push_done(p_sent bigint[], p_ok text[] default '{}', p_gone text[] default '{}', p_failed text[] default '{}',
  p_native_ok text[] default '{}', p_native_gone text[] default '{}', p_native_failed text[] default '{}') returns int
language plpgsql security definer set search_path = public as $$
begin
  update public.push_queue set sent_at = now() where id = any (coalesce(p_sent, '{}'));
  update public.push_subs set ok_at = now(), fails = 0 where endpoint = any (coalesce(p_ok, '{}'));
  update public.push_subs set fails = fails + 1 where endpoint = any (coalesce(p_failed, '{}'));
  delete from public.push_subs where endpoint = any (coalesce(p_gone, '{}'));
  update public.push_native set ok_at = now(), fails = 0 where token = any (coalesce(p_native_ok, '{}'));
  update public.push_native set fails = fails + 1 where token = any (coalesce(p_native_failed, '{}'));
  delete from public.push_native where token = any (coalesce(p_native_gone, '{}'));
  delete from public.push_queue where created_at < now() - interval '14 days';
  delete from public.alert_sent where at < now() - interval '30 days';
  return coalesce(cardinality(p_sent), 0);
end $$;

-- 3. an answer from a notification's button
create or replace function public.hi8_push_answer(p_key uuid, p_ref text, p_answer text) returns json
language plpgsql security definer set search_path = public as $$
declare
  em   text := public.hi8_email(p_key);
  kind text := split_part(coalesce(p_ref, ''), ':', 1);
  cd   text := upper(split_part(coalesce(p_ref, ''), ':', 2));
  c    public.crews;
  lvl  text;
  site text := coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com');
  url  text;
begin
  perform public.hi8_limit('pushans', p_key::text, 30, interval '10 minutes');
  select * into c from public.crews x where x.code = cd;
  if not found then return json_build_object('ok', false, 'why', 'no_crew', 'url', site); end if;
  url := site || '/?c=' || c.code;
  begin
    if kind = 'ask' and p_answer in ('in_seat', 'in_own') then
      lvl := coalesce((select a.level from public.ride_asks a where a.email = em and a.sport = c.sport order by a.day desc limit 1),
                      (select m.level from public.crew_members m join public.crews x on x.id = m.crew_id where lower(m.email) = em and x.sport = c.sport order by x.day desc limit 1), 'regular');
      perform public.hi8_join_crew(p_key, c.code, lvl, case when p_answer = 'in_seat' then 'seat' else 'own' end, 0, null);
      return json_build_object('ok', true, 'did', 'joined', 'url', url);
    elsif kind = 'ask' and p_answer = 'not_now' then
      insert into public.alert_sent (key, email, kind) values ('notnow:' || c.code || ':' || em, em, 'notnow') on conflict do nothing;
      return json_build_object('ok', true, 'did', 'not_now');
    elsif kind = 'fx' and p_answer = 'still_in' then
      perform public.hi8_still_in(p_key, c.code, null);
      return json_build_object('ok', true, 'did', 'still_in', 'url', url);
    elsif kind = 'fx' and p_answer = 'out' then
      perform public.hi8_leave_crew(p_key, c.code, 'out from the notification');
      return json_build_object('ok', true, 'did', 'out');
    elsif kind = 'rate' and p_answer in ('on', 'meh', 'off') then
      perform public.hi8_report(p_key, c.code, p_answer, null, null, null);
      return json_build_object('ok', true, 'did', 'rated');
    end if;
  exception when others then
    -- not possible from the lock screen (no seat left, the plan changed, the session is over): open it instead
    return json_build_object('ok', false, 'why', sqlerrm, 'url', url);
  end;
  return json_build_object('ok', false, 'why', 'unknown_answer', 'url', url);
end $$;

revoke execute on function public.hi8_push_native(uuid, text, text, text) from public;
revoke execute on function public.hi8_push_native_off(uuid, text) from public;
revoke execute on function public.hi8_push_answer(uuid, text, text) from public;
revoke execute on function public.hi8_has_push(text) from public, anon, authenticated;
revoke execute on function public.hi8_push_pending(int) from public, anon, authenticated;
revoke execute on function public.hi8_push_done(bigint[], text[], text[], text[], text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.hi8_push_native(uuid, text, text, text) to anon, authenticated;
grant execute on function public.hi8_push_native_off(uuid, text) to anon, authenticated;
grant execute on function public.hi8_push_answer(uuid, text, text) to anon, authenticated;
grant execute on function public.hi8_push_pending(int) to service_role;
grant execute on function public.hi8_push_done(bigint[], text[], text[], text[], text[], text[], text[]) to service_role;
revoke all on public.push_native from anon, authenticated;

-- check: should print t | t | t
select to_regclass('public.push_native') is not null as tokens,
       to_regprocedure('public.hi8_push_answer(uuid, text, text)') is not null as answers,
       to_regprocedure('public.hi8_push_done(bigint[], text[], text[], text[], text[], text[], text[])') is not null
         and to_regprocedure('public.hi8_push_done(bigint[], text[], text[], text[])') is null as worker;

notify pgrst, 'reload schema';
