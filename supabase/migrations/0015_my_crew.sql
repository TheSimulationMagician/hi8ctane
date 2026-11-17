-- Hi8ctane 0015: crews that stay together, your session log, and a heads-up for your spots (2.22).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0014. Safe to run again.
--
--   * MY CREW: after (or during) a session, anyone in a crew can "keep this crew". That makes a lasting
--     group (squads) with everyone who was in it. Others join with its link (?s=CODE). When one of you
--     posts a crew, one tap tells the rest by email: "going Tue 10:00 at Wijk aan Zee?" (hi8_squad_call).
--   * YOUR LOG: every past crew you were in is a session. hi8_card() counts sessions, spots and drives
--     and lists the last ones with who came. No new table: it reads crews and crew_members.
--   * YOUR SPOTS: the star on a spot page. Signed in, it's kept here too (spot_watch), and when someone
--     posts a crew at that spot you get one email (not if crew alerts for that sport already sent you one).
--   * erase_email also removes squad memberships and spot stars.

-- ---------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.squads (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  name        text not null check (char_length(name) between 2 and 40),
  city        text not null references public.cities (slug),
  sport       text not null,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create table if not exists public.squad_members (
  squad_id    uuid not null references public.squads (id) on delete cascade,
  email       text not null,
  joined_at   timestamptz not null default now(),
  primary key (squad_id, email)
);
create index if not exists squad_members_email on public.squad_members (lower(email));
alter table public.crews add column if not exists squad uuid references public.squads (id) on delete set null;

create table if not exists public.spot_watch (
  email       text not null,
  spot        text not null references public.spots (slug) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (email, spot)
);

alter table public.squads enable row level security;
alter table public.squad_members enable row level security;
alter table public.spot_watch enable row level security;
revoke all on public.squads, public.squad_members, public.spot_watch from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. My crew
-- ---------------------------------------------------------------------------------------------
-- a squad as the page shows it: who's in it (rider names and plates, like a crew page), and its next crews
create or replace function public.hi8_squad_view(s public.squads, p_email text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', s.code, 'name', s.name, 'city', s.city, 'sport', s.sport,
    'mine', p_email is not null and exists (select 1 from public.squad_members m where m.squad_id = s.id and lower(m.email) = p_email),
    'size', (select count(*) from public.squad_members m where m.squad_id = s.id),
    'riders', coalesce((select jsonb_agg(jsonb_build_object('name', public.hi8_name(m.email, s.city), 'plate', public.hi8_plate(m.email, s.city),
                        'me', p_email is not null and lower(m.email) = p_email) order by m.joined_at)
                        from public.squad_members m where m.squad_id = s.id), '[]'::jsonb),
    'sessions', (select count(*) from public.crews c where c.squad = s.id and c.status = 'on' and public.hi8_crew_past(c)),
    'next', coalesce((select jsonb_agg(public.hi8_crew_card(c) order by c.day, c.start_time) from public.crews c
                      where c.squad = s.id and c.status = 'on' and not public.hi8_crew_past(c)), '[]'::jsonb),
    'url', coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com') || '/?s=' || s.code);
$$;

-- keep this crew: everyone who's in it now becomes a lasting group (or, if it already has one, you join it)
create or replace function public.hi8_squad_keep(p_key uuid, p_crew text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); c public.crews; s public.squads; nm text;
begin
  perform public.hi8_limit('squad', p_key::text, 30, interval '10 minutes');
  select * into c from public.crews where code = upper(trim(coalesce(p_crew, '')));
  if c.id is null then raise exception 'no_crew' using errcode = '22023'; end if;
  if not exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) then
    raise exception 'not_in_crew' using errcode = '42501', hint = 'Join the crew first.';
  end if;
  if c.squad is not null then
    select * into s from public.squads where id = c.squad;
  else
    select left(name || ' crew', 40) into nm from public.spots where slug = c.spot;
    insert into public.squads (name, city, sport, created_by) values (coalesce(nm, 'Our crew'), c.city, c.sport, em) returning * into s;
    update public.crews set squad = s.id where id = c.id;
  end if;
  insert into public.squad_members (squad_id, email)
    select s.id, lower(m.email) from public.crew_members m where m.crew_id = c.id and m.email <> 'erased'
    on conflict do nothing;
  return public.hi8_squad_view(s, em)::json;
end $$;

-- the squad's page (public, like a crew page): who's in it and what's next
create or replace function public.hi8_squad(p_code text, p_key uuid default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare s public.squads; em text;
begin
  select * into s from public.squads where code = upper(trim(coalesce(p_code, '')));
  if s.id is null then raise exception 'no_squad' using errcode = '22023', hint = 'That crew link is wrong or the crew was deleted.'; end if;
  if p_key is not null then select lower(email) into em from public.rider_keys where key = p_key; end if;
  return public.hi8_squad_view(s, em)::json;
end $$;

create or replace function public.hi8_squad_join(p_key uuid, p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); s public.squads;
begin
  perform public.hi8_limit('squad', p_key::text, 30, interval '10 minutes');
  select * into s from public.squads where code = upper(trim(coalesce(p_code, '')));
  if s.id is null then raise exception 'no_squad' using errcode = '22023'; end if;
  if (select count(*) from public.squad_members where squad_id = s.id) >= 30 then raise exception 'squad_full' using errcode = '22023', hint = 'A crew holds up to 30 riders.'; end if;
  insert into public.squad_members (squad_id, email) values (s.id, em) on conflict do nothing;
  return public.hi8_squad_view(s, em)::json;
end $$;

create or replace function public.hi8_squad_leave(p_key uuid, p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); s public.squads;
begin
  select * into s from public.squads where code = upper(trim(coalesce(p_code, '')));
  if s.id is null then raise exception 'no_squad' using errcode = '22023'; end if;
  delete from public.squad_members where squad_id = s.id and lower(email) = em;
  if not exists (select 1 from public.squad_members where squad_id = s.id) then delete from public.squads where id = s.id; end if;
  return json_build_object('left', true);
end $$;

create or replace function public.hi8_squads(p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  return (select coalesce(json_agg(public.hi8_squad_view(s, em) order by s.created_at desc), '[]'::json)
          from public.squads s where exists (select 1 from public.squad_members m where m.squad_id = s.id and lower(m.email) = em));
end $$;

-- "going Tue?": tie your crew to the squad and email the others who aren't in it yet (once per crew)
create or replace function public.hi8_squad_call(p_key uuid, p_code text, p_crew text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); s public.squads; c public.crews; m record; n int := 0; who text;
begin
  perform public.hi8_limit('squadcall', p_key::text, 10, interval '1 hour');
  select * into s from public.squads where code = upper(trim(coalesce(p_code, '')));
  select * into c from public.crews where code = upper(trim(coalesce(p_crew, '')));
  if s.id is null or c.id is null then raise exception 'no_squad' using errcode = '22023'; end if;
  if not exists (select 1 from public.squad_members where squad_id = s.id and lower(email) = em)
     or not exists (select 1 from public.crew_members where crew_id = c.id and lower(email) = em) then
    raise exception 'not_member' using errcode = '42501', hint = 'You need to be in both the crew and the group.';
  end if;
  if c.status <> 'on' or public.hi8_crew_past(c) then raise exception 'crew_over' using errcode = '22023'; end if;
  update public.crews set squad = s.id where id = c.id and squad is null;
  who := public.hi8_name(em, c.city);
  for m in select sm.email from public.squad_members sm where sm.squad_id = s.id and lower(sm.email) <> em
           and not exists (select 1 from public.crew_members x where x.crew_id = c.id and lower(x.email) = lower(sm.email)) loop
    perform public.hi8_mail(m.email, 'squad_call', who || ': going? ' || public.hi8_crew_line(c),
      who || ' is going: ' || public.hi8_crew_line(c) || E'.\nYour crew, ' || s.name || E', is invited.\n\nI''m going, in one tap: ' || public.hi8_crew_url(c),
      c.id, 'squadcall:' || c.id || ':' || lower(m.email));
    n := n + 1;
  end loop;
  return json_build_object('told', n, 'squad', s.code);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Your log and your card
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_card(p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  return (with mine as (
      select c.*, m.getting from public.crews c join public.crew_members m on m.crew_id = c.id
      where lower(m.email) = em and c.status = 'on' and public.hi8_crew_past(c))
    select json_build_object(
      'sessions', (select count(*) from mine),
      'spots', (select count(distinct spot) from mine),
      'drives', (select count(*) from mine where getting = 'drive'),
      'started', (select count(*) from mine where lower(host_email) = em),
      'squads', (select count(*) from public.squad_members where lower(email) = em),
      'first', (select min(day) from mine),
      'log', coalesce((select json_agg(x order by x.day desc) from (
          select mi.day, mi.sport, mi.spot, s.name as spot_name, mi.getting as role, mi.code, (select q.code from public.squads q where q.id = mi.squad) as squad,
                 (select count(*) from public.crew_members z where z.crew_id = mi.id) as size,
                 (select json_agg(public.hi8_name(z.email, mi.city) order by z.joined_at) from public.crew_members z where z.crew_id = mi.id and lower(z.email) <> em) as riders
          from mine mi join public.spots s on s.slug = mi.spot order by mi.day desc limit 12) x), '[]'::json)));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Your spots: a star, and one email when a crew is posted there
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_watch(p_key uuid, p_spot text default null, p_on boolean default true) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  if p_spot is not null then
    perform public.hi8_limit('watch', p_key::text, 60, interval '10 minutes');
    if not exists (select 1 from public.spots where slug = p_spot) then raise exception 'no_spot' using errcode = '22023'; end if;
    if p_on then insert into public.spot_watch (email, spot) values (em, p_spot) on conflict do nothing;
    else delete from public.spot_watch where email = em and spot = p_spot; end if;
  end if;
  return json_build_object('spots', coalesce((select json_agg(spot order by created_at) from public.spot_watch where email = em), '[]'::json));
end $$;

create or replace function public.hi8_on_new_crew_spot() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.crews; w record; card jsonb; site text := coalesce(public.hi8_secret('site_url'), 'https://hi8ctane.com');
begin
  select * into c from public.crews where id = new.id;
  if c.id is null or c.status <> 'on' then return null; end if;
  card := public.hi8_crew_card(c);
  for w in select sw.email from public.spot_watch sw where sw.spot = c.spot and sw.email <> lower(c.host_email)
           and not exists (select 1 from public.crew_alerts a where a.email = sw.email and a.city = c.city and a.sport = c.sport) loop
    perform public.hi8_mail(w.email, 'spot_crew', 'A crew is going to your spot · ' || public.hi8_crew_line(c),
      (card->>'host') || ' posted a crew at ' || (card->>'spot_name') || ': ' || public.hi8_crew_line(c) || '.'
      || case when (card->>'seats_free')::int > 0 then ' ' || (card->>'seats_free') || ' seat' || case when (card->>'seats_free')::int = 1 then '' else 's' end || ' free.' else '' end
      || E'\n\nJoin in one tap: ' || public.hi8_crew_url(c)
      || E'\n\nYou get this because you starred ' || (card->>'spot_name') || '. Untick the star on its page to stop: ' || site || '/#spot/' || c.spot,
      c.id, 'spot:' || c.id || ':' || w.email);
  end loop;
  return null;
end $$;
drop trigger if exists hi8_new_crew_spot_mail on public.crews;
create constraint trigger hi8_new_crew_spot_mail after insert on public.crews deferrable initially deferred
  for each row execute function public.hi8_on_new_crew_spot();

-- ---------------------------------------------------------------------------------------------
-- 5. Erasing a rider also removes their groups and stars
-- ---------------------------------------------------------------------------------------------
create or replace function public.hi8_erase_social(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(p_email));
begin
  delete from public.squad_members where lower(email) = em;
  delete from public.squads s where not exists (select 1 from public.squad_members m where m.squad_id = s.id);
  update public.squads set created_by = 'erased' where lower(created_by) = em;
  delete from public.spot_watch where email = em;
end $$;
do $$
declare src text;
begin
  -- add one line to erase_email (from 0008), once
  select pg_get_functiondef('public.erase_email(text)'::regprocedure) into src;
  if position('hi8_erase_social' in src) = 0 then
    src := replace(src, 'delete from public.outbox where to_email = em;', 'perform public.hi8_erase_social(em);' || chr(10) || '  delete from public.outbox where to_email = em;');
    execute src;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Who may call what
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.hi8_squad_view(public.squads, text) from public, anon, authenticated;
revoke execute on function public.hi8_on_new_crew_spot() from public, anon, authenticated;
revoke execute on function public.hi8_erase_social(text) from public, anon, authenticated;
revoke execute on function public.hi8_squad_keep(uuid, text) from public;
revoke execute on function public.hi8_squad(text, uuid) from public;
revoke execute on function public.hi8_squad_join(uuid, text) from public;
revoke execute on function public.hi8_squad_leave(uuid, text) from public;
revoke execute on function public.hi8_squads(uuid) from public;
revoke execute on function public.hi8_squad_call(uuid, text, text) from public;
revoke execute on function public.hi8_card(uuid) from public;
revoke execute on function public.hi8_watch(uuid, text, boolean) from public;
grant execute on function public.hi8_squad_keep(uuid, text) to anon, authenticated;
grant execute on function public.hi8_squad(text, uuid) to anon, authenticated;
grant execute on function public.hi8_squad_join(uuid, text) to anon, authenticated;
grant execute on function public.hi8_squad_leave(uuid, text) to anon, authenticated;
grant execute on function public.hi8_squads(uuid) to anon, authenticated;
grant execute on function public.hi8_squad_call(uuid, text, text) to anon, authenticated;
grant execute on function public.hi8_card(uuid) to anon, authenticated;
grant execute on function public.hi8_watch(uuid, text, boolean) to anon, authenticated;
