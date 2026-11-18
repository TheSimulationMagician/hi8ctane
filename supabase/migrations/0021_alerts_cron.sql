-- Hi8ctane 0021: the alert worker runs inside Supabase, and one shared forecast for every visitor (2.27).
--
-- Run it once in Supabase > SQL Editor, AFTER 0001 to 0020. Safe to run again.
--
--   * Every 10 minutes pg_cron starts the Edge Function "alerts" (supabase/functions/alerts): wind alerts, "forecast
--     dropped", "how was it?", push to phones. GitHub's timer ran it far too rarely; this one is on time.
--     The function only runs for a caller with the secret below (pg_cron has it; nobody else does).
--   * Every 30 minutes the worker fetches each region's forecast (all its spots, and the map's wind grid) ONCE and
--     publishes it in Storage (bucket fx). Pages read that file first: faster, far fewer calls to Open-Meteo,
--     and the site and the alerts see the same forecast. fx_cache says when each region was last published.
--
-- Needs: the "alerts" function deployed (the functions workflow does it with SUPABASE_ACCESS_TOKEN).
-- If your project's functions live elsewhere: insert into app_secrets (name, value) values ('functions_url', 'https://<ref>.supabase.co/functions/v1');

-- the secret pg_cron sends to the function
insert into public.app_secrets (name, value) values ('alerts_cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

create or replace function public.hi8_worker_secret() returns text
language sql stable security definer set search_path = public as $$
  select public.hi8_secret('alerts_cron');
$$;

-- start one run of the worker (pg_cron calls this every 10 minutes)
create or replace function public.hi8_alerts_tick() returns bigint
language plpgsql security definer set search_path = public as $$
declare u text := coalesce(nullif(public.hi8_secret('functions_url'), ''), 'https://ttpryqrjkhlthftdkhju.supabase.co/functions/v1');
begin
  if public.hi8_worker_secret() is null then return null; end if;
  return net.http_post(url := rtrim(u, '/') || '/alerts', body := '{}'::jsonb,
    headers := jsonb_build_object('x-hi8-cron', public.hi8_worker_secret(), 'Content-Type', 'application/json'),
    timeout_milliseconds := 120000);
end $$;

-- the shared forecast: which regions are due (never published, or over 25 minutes ago), with all their spots
create table if not exists public.fx_cache (
  city   text primary key references public.cities (slug),
  at     timestamptz not null default now(),
  spots  int not null default 0,
  grid   boolean not null default false
);
alter table public.fx_cache enable row level security;
revoke all on public.fx_cache from anon, authenticated;

create or replace function public.hi8_fx_due() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('city', ci.slug, 'spots',
    (select json_agg(json_build_object('slug', s.slug, 'city', s.city, 'name', s.name, 'lat', s.lat, 'lon', s.lon, 'face', s.face,
       'good_from', s.good_from, 'good_to', s.good_to, 'lake', s.lake, 'sports', s.sports) order by s.slug)
     from public.spots s where s.city = ci.slug and s.active))), '[]'::json)
  from public.cities ci
  where exists (select 1 from public.spots s where s.city = ci.slug and s.active)
    and not exists (select 1 from public.fx_cache f where f.city = ci.slug and f.at > now() - interval '25 minutes');
$$;

create or replace function public.hi8_fx_cached(p_city text, p_spots int default 0, p_grid boolean default false) returns void
language sql security definer set search_path = public as $$
  insert into public.fx_cache (city, at, spots, grid) values (p_city, now(), coalesce(p_spots, 0), coalesce(p_grid, false))
  on conflict (city) do update set at = now(), spots = excluded.spots, grid = excluded.grid;
$$;

-- the bucket the shared forecast goes in: public to read, only the worker (service role) writes
do $do$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fx', 'fx', true, 8388608, array['application/json'])
    on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = array['application/json'];
  end if;
end $do$;

-- every 10 minutes (Supabase only; skipped on a database without pg_cron)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('hi8-alerts'); exception when others then null; end;
    perform cron.schedule('hi8-alerts', '*/10 * * * *', 'select public.hi8_alerts_tick()');
  end if;
end $$;

revoke execute on function public.hi8_worker_secret() from public, anon, authenticated;
revoke execute on function public.hi8_alerts_tick() from public, anon, authenticated;
revoke execute on function public.hi8_fx_due() from public, anon, authenticated;
revoke execute on function public.hi8_fx_cached(text, int, boolean) from public, anon, authenticated;
grant execute on function public.hi8_worker_secret() to service_role;
grant execute on function public.hi8_fx_due() to service_role;
grant execute on function public.hi8_fx_cached(text, int, boolean) to service_role;

notify pgrst, 'reload schema';
