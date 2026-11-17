-- 0017 (2.18, written as 0014): cartoon avatars. A rider takes a selfie, an image AI draws it as a surf-mag cartoon, and the
-- cartoon (never the selfie) is kept in Supabase Storage, bucket "avatars" (public files, random names).
--
-- Who sees it: the rider on their own plate (Me), and the riders of a crew they're in (WHO'S GOING). Public crew
-- cards keep initials, like names: "Names, cars and the chat are for the crew".
-- Cost control: 3 cartoons per rider per day, and at most cartoon_daily_max (100) for everyone per day.
-- The drawing is done by supabase/functions/cartoon (OPENAI_API_KEY). Erasing a rider queues their file for deletion.
--
-- Safe to run more than once. Needs 0001 to 0016.

create table if not exists public.rider_avatars (
  email      text primary key,          -- lower(email)
  path       text not null,             -- file name in the avatars bucket, e.g. 3f2a…e1.webp
  created_at timestamptz not null default now()
);
create table if not exists public.avatar_trash (   -- files to delete from Storage (the cartoon function empties it)
  path text primary key,
  at   timestamptz not null default now()
);
create table if not exists public.cartoon_log (    -- one row per drawing asked for, for the daily cap (no email)
  at timestamptz not null default now(),
  ok boolean
);
alter table public.rider_avatars enable row level security;
alter table public.avatar_trash enable row level security;
alter table public.cartoon_log enable row level security;
revoke all on public.rider_avatars, public.avatar_trash, public.cartoon_log from anon, authenticated;

insert into public.app_settings (key, value) values ('cartoon_daily_max', '100'), ('cartoons_on', 'true')
on conflict (key) do nothing;

-- the Storage bucket (only on Supabase, where the storage schema exists)
do $do$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/png'])
    on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/webp', 'image/png'];
  end if;
end $do$;

create or replace function public.hi8_avatar(p_email text) returns text
language sql stable security definer set search_path = public as $$
  select path from public.rider_avatars where email = lower(trim(p_email));
$$;

-- the rider's own cartoon (the website, with the browser key)
create or replace function public.hi8_my_avatar(p_key uuid) returns json
language sql security definer set search_path = public as $$
  select json_build_object('path', public.hi8_avatar(public.hi8_email(p_key)),
    'on', coalesce((select value = 'true'::jsonb from public.app_settings where key = 'cartoons_on'), false));
$$;

-- the cartoon function, before it asks for a drawing: who, and are they allowed one now
create or replace function public.hi8_cartoon_start(p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key);
begin
  if not coalesce((select value = 'true'::jsonb from public.app_settings where key = 'cartoons_on'), false) then
    raise exception 'cartoons_off' using errcode = '22023', hint = 'Cartoons are switched off for now.';
  end if;
  if not exists (select 1 from public.signups where lower(email) = em) then
    raise exception 'no_plate' using errcode = '22023', hint = 'Get your founding plate first.';
  end if;
  if (select count(*) from public.cartoon_log where at > now() - interval '1 day') >= public.hi8_int('cartoon_daily_max', 100) then
    raise exception 'busy' using errcode = 'PT429', hint = 'Lots of cartoons today: try again tomorrow.';
  end if;
  perform public.hi8_limit('cartoon', em, 3, interval '1 day');
  insert into public.cartoon_log (ok) values (null);
  return json_build_object('email', em, 'old', public.hi8_avatar(em));
end $$;

-- the drawing is stored: it becomes the rider's cartoon, the old file goes to the trash
create or replace function public.hi8_cartoon_done(p_email text, p_path text) returns json
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(p_email)); old text;
begin
  if p_path !~ '^[0-9a-f-]{36}\.(webp|png)$' then raise exception 'bad_path' using errcode = '22023'; end if;
  old := public.hi8_avatar(em);
  insert into public.rider_avatars (email, path) values (em, p_path)
  on conflict (email) do update set path = excluded.path, created_at = now();
  if old is not null and old <> p_path then insert into public.avatar_trash (path) values (old) on conflict do nothing; end if;
  update public.cartoon_log set ok = true where ctid = (select ctid from public.cartoon_log where ok is null order by at desc limit 1);
  return json_build_object('path', p_path);
end $$;

-- the rider takes their cartoon off
create or replace function public.hi8_avatar_remove(p_key uuid) returns json
language plpgsql security definer set search_path = public as $$
declare em text := public.hi8_email(p_key); old text;
begin
  delete from public.rider_avatars where email = em returning path into old;
  if old is not null then insert into public.avatar_trash (path) values (old) on conflict do nothing; end if;
  return json_build_object('removed', old is not null);
end $$;

-- the cartoon function empties the trash a few files at a time
create or replace function public.hi8_avatar_trash_take(p_n int default 20) returns json
language sql security definer set search_path = public as $$
  with t as (delete from public.avatar_trash where path in (select path from public.avatar_trash order by at limit least(p_n, 50)) returning path)
  select coalesce(json_agg(path), '[]'::json) from t;
$$;

-- erasing a rider (erase_email deletes their keys last): the cartoon goes, and so does the Pass list entry (0016)
create or replace function public.hi8_on_key_gone() returns trigger
language plpgsql security definer set search_path = public as $$
declare em text := lower(old.email); p text;
begin
  if exists (select 1 from public.rider_keys where lower(email) = em) then return null; end if;
  delete from public.rider_avatars where email = em returning path into p;
  if p is not null then insert into public.avatar_trash (path) values (p) on conflict do nothing; end if;
  delete from public.pass_interest where email = em;
  return null;
end $$;
drop trigger if exists hi8_key_gone on public.rider_keys;
create trigger hi8_key_gone after delete on public.rider_keys for each row execute function public.hi8_on_key_gone();

-- the crew page: each member's cartoon, for the riders of that crew only (hi8_crew from 0005 + 'avatar')
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
  out := public.hi8_crew_card(c) || jsonb_build_object('note', c.note,
    'maps', (select maps from public.spots where slug = c.spot),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('at', r.at, 'verdict', r.verdict, 'kite', r.kite, 'ground', r.ground) order by r.at desc), '[]'::jsonb)
                from public.spot_reports r where r.crew_id = c.id));
  if p_key is not null then
    em := public.hi8_email(p_key);
    select * into mine from public.crew_members where crew_id = c.id and lower(email) = em;
    out := out || jsonb_build_object('host_is_me', lower(c.host_email) = em, 'captain', public.hi8_is_captain(em));
    if mine.crew_id is not null then
      out := out || jsonb_build_object(
        'me', jsonb_build_object('member_id', mine.member_id, 'level', mine.level, 'getting', mine.getting, 'seats', mine.seats, 'car_with', mine.car_with,
                                 'trip_cost', mine.trip_cost, 'pay_link', mine.pay_link, 'bizum', mine.bizum, 'paid', mine.paid_at is not null,
                                 'here', public.hi8_is_here(mine, c)),
        'meet_note', c.meet_note,
        'members', (select coalesce(jsonb_agg(jsonb_build_object(
            'member_id', m.member_id, 'name', public.hi8_name(m.email, c.city), 'plate', public.hi8_plate(m.email, c.city),
            'avatar', public.hi8_avatar(m.email),
            'level', m.level, 'getting', m.getting, 'seats', m.seats, 'car_with', m.car_with,
            'host', lower(m.email) = lower(c.host_email), 'me', lower(m.email) = em,
            'trip_cost', m.trip_cost, 'pay_link', m.pay_link, 'paid', m.paid_at is not null,
            'bizum', case when m.member_id = mine.car_with or m.member_id = mine.member_id then m.bizum end,
            'here', public.hi8_is_here(m, c),
            'share', case when m.getting = 'drive' and m.trip_cost is not null then
                       round(m.trip_cost / (1 + (select count(*) from public.crew_members p where p.crew_id = c.id and p.car_with = m.member_id)), 2) end
          ) order by m.joined_at), '[]'::jsonb)
          from public.crew_members m where m.crew_id = c.id),
        'reports', (select coalesce(jsonb_agg(jsonb_build_object('at', r.at, 'verdict', r.verdict, 'kite', r.kite, 'ground', r.ground,
                       'note', r.note, 'name', case when r.email is null then null else public.hi8_name(r.email, c.city) end) order by r.at desc), '[]'::jsonb)
                    from public.spot_reports r where r.crew_id = c.id),
        'messages', (select count(*) from public.crew_messages x where x.crew_id = c.id));
    end if;
  end if;
  return out::json;
end $$;

revoke execute on function public.hi8_avatar(text) from public, anon, authenticated;
revoke execute on function public.hi8_cartoon_start(uuid) from public, anon, authenticated;
revoke execute on function public.hi8_cartoon_done(text, text) from public, anon, authenticated;
revoke execute on function public.hi8_avatar_trash_take(int) from public, anon, authenticated;
revoke execute on function public.hi8_on_key_gone() from public, anon, authenticated;
revoke execute on function public.hi8_my_avatar(uuid) from public;
revoke execute on function public.hi8_avatar_remove(uuid) from public;
grant execute on function public.hi8_my_avatar(uuid) to anon, authenticated;
grant execute on function public.hi8_avatar_remove(uuid) to anon, authenticated;
grant execute on function public.hi8_cartoon_start(uuid), public.hi8_cartoon_done(text, text), public.hi8_avatar_trash_take(int) to service_role;
grant execute on function public.hi8_crew(text, uuid) to anon, authenticated;

-- Switch cartoons off: update public.app_settings set value = 'false' where key = 'cartoons_on';
-- Today's drawings:   select count(*), count(*) filter (where ok) from public.cartoon_log where at > now() - interval '1 day';
