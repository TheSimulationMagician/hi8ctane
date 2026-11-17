-- Hi8ctane 0014: who's looking (2.20).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0013. Safe to run again.
--
--   * Every open page says "I'm here" once a minute with a random visitor id made in the browser
--     (not the rider key, no email, no IP stored). hi8_look() answers how many are looking now
--     (seen in the last 5 minutes) and how many looked today, in that region.
--   * The page shows "N looking now" from 2 people up and "N today" from 5 up, never fewer.
--   * Your numbers: Table Editor > looks_daily (visitors per day and region, kept), or run
--       select * from public.hi8_looks_report;
--     The per-visitor rows (looks) are deleted after 90 days.

create table if not exists public.looks (
  visitor     uuid not null,
  day         date not null,
  city        text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  pings       int not null default 1,
  primary key (visitor, day, city)
);
create index if not exists looks_recent on public.looks (city, last_seen);
create table if not exists public.looks_daily (
  day         date not null,
  city        text not null,
  visitors    int not null default 0,
  primary key (day, city)
);
alter table public.looks enable row level security;
alter table public.looks_daily enable row level security;
revoke all on public.looks, public.looks_daily from anon, authenticated;

create or replace function public.hi8_look(p_visitor uuid, p_city text) returns json
language plpgsql security definer set search_path = public as $$
declare c text; d date := (now() at time zone 'Europe/Amsterdam')::date; fresh boolean;
begin
  select slug into c from public.cities where slug = lower(trim(coalesce(p_city, '')));
  if c is null or p_visitor is null then raise exception 'bad_look' using errcode = '22023'; end if;
  perform public.hi8_limit('look', coalesce(public.hi8_client(), 'none'), 60, interval '10 minutes');
  insert into public.looks (visitor, day, city) values (p_visitor, d, c)
    on conflict (visitor, day, city) do update set last_seen = now(), pings = public.looks.pings + 1
    returning (xmax = 0) into fresh;
  if fresh then
    insert into public.looks_daily (day, city, visitors) values (d, c, 1)
      on conflict (day, city) do update set visitors = public.looks_daily.visitors + 1;
  end if;
  if random() < 0.01 then delete from public.looks where day < d - 90; end if;
  return json_build_object(
    'now',   (select count(distinct visitor) from public.looks where city = c and last_seen > now() - interval '5 minutes'),
    'today', (select coalesce(sum(visitors), 0) from public.looks_daily where city = c and day = d));
end $$;
revoke execute on function public.hi8_look(uuid, text) from public;
grant execute on function public.hi8_look(uuid, text) to anon, authenticated;

-- for you, in the SQL editor: visitors per day, per region, last 60 days
create or replace view public.hi8_looks_report as
  select day, city, visitors from public.looks_daily where day > (now() at time zone 'Europe/Amsterdam')::date - 60 order by day desc, city;
revoke all on public.hi8_looks_report from anon, authenticated;
